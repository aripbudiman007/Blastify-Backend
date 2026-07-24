import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi';
import { config } from './config';
import { logger } from './config/logger';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
import { rootRouter } from './routes';
import { setSocketIO, getAllSessions } from './baileys/session';
import { setIO } from './socket';
import { prisma } from './prisma/client';
import { getRedisClient } from './redis/client';
import { redisRateLimitStore } from './config/rateLimit';
import { hasDeviceAccess } from './services/device.service';
import { JwtPayload } from './types';

/** Resolve a Socket.IO auth token (JWT access token or static API key) to a userId. */
async function identifySocketUser(token: string): Promise<string | null> {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, isActive: true } });
    return user?.isActive ? user.id : null;
  } catch {
    // not a valid JWT — fall through and try as a static API key
  }
  const user = await prisma.user.findUnique({ where: { apiKey: token }, select: { id: true, isActive: true } });
  return user?.isActive ? user.id : null;
}

export function createApp() {
  const app = express();
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.ALLOWED_ORIGINS.split(','),
      methods: ['GET', 'POST'],
    },
  });

  setSocketIO(io);
  setIO(io);

  // Auth handshake — client must connect with `auth: { token }` (JWT access
  // token or static API key). Prevents joining another tenant's rooms and
  // eavesdropping on their incoming messages / broadcast progress / leads.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    const userId = await identifySocketUser(token);
    if (!userId) {
      next(new Error('Invalid or expired authentication token'));
      return;
    }
    socket.data.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    logger.debug(`Socket connected: ${socket.id} (user ${userId})`);

    socket.on('join:device', async (deviceId: string) => {
      const allowed = await hasDeviceAccess(userId, deviceId).catch(() => false);
      if (!allowed) {
        socket.emit('error', { message: 'Access denied to this device' });
        return;
      }
      socket.join(`device:${deviceId}`);
      logger.debug(`Socket ${socket.id} joined device:${deviceId}`);
    });

    socket.on('join:user', () => {
      socket.join(`user:${userId}`);
      logger.debug(`Socket ${socket.id} joined user:${userId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  app.use(helmet());
  app.use(
    cors({
      origin: config.ALLOWED_ORIGINS.split(','),
      credentials: true,
    }),
  );

  const morganStream = { write: (message: string) => logger.http(message.trim()) };
  app.use(morgan('combined', { stream: morganStream }));

  // rawBody disimpan untuk verifikasi HMAC signature webhook masuk
  const captureRawBody = (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; };
  app.use(express.json({ limit: `${config.MAX_FILE_SIZE_MB}mb`, verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: `${config.MAX_FILE_SIZE_MB}mb`, verify: captureRawBody }));

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: true,
      legacyHeaders: false,
      store: redisRateLimitStore('general'),
      keyGenerator: (req) => {
        const apiKey = req.headers['x-api-key'] as string;
        return apiKey || ipKeyGenerator(req.ip ?? '');
      },
      message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, slow down' },
      },
    }),
  );

  app.use('/uploads', express.static(config.UPLOAD_DIR));

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
    ]);

  app.get('/health', async (_req, res) => {
    // Redis client has maxRetriesPerRequest: null (queues commands forever
    // while disconnected instead of rejecting) — without a timeout, this
    // endpoint would hang indefinitely whenever Redis is unreachable.
    const [dbResult, redisResult] = await Promise.allSettled([
      withTimeout(prisma.$queryRaw`SELECT 1`, 3_000),
      withTimeout(getRedisClient().ping(), 3_000),
    ]);

    const checks = {
      database:
        dbResult.status === 'fulfilled'
          ? { status: 'ok' as const }
          : { status: 'error' as const, error: (dbResult.reason as Error).message },
      redis:
        redisResult.status === 'fulfilled' && redisResult.value === 'PONG'
          ? { status: 'ok' as const }
          : {
              status: 'error' as const,
              error:
                redisResult.status === 'rejected'
                  ? (redisResult.reason as Error).message
                  : 'Unexpected PING response',
            },
    };

    const healthy = checks.database.status === 'ok' && checks.redis.status === 'ok';

    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        checks,
        waSessions: { active: getAllSessions().size },
      },
    });
  });

  // API docs (Swagger UI) — spec also available as JSON at /api/docs.json
  app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec as any, {
    customSiteTitle: 'Blastify API Docs',
  }));

  app.use('/api/v1', rootRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, httpServer, io };
}
