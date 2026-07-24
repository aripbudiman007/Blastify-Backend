import { Request, Response, NextFunction } from 'express';
import {
  listIntegrations,
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  regenerateToken,
  getIntegrationLogs,
  processWebhook,
} from '../services/integration.service';
import { listPlatforms, getPlatformPreset } from '../integrations/platforms';
import { logger } from '../config/logger';
import { prisma } from '../prisma/client';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';

/** Auth opsional: identifikasi user dari Bearer/API Key bila ada, tanpa mewajibkannya. */
async function tryIdentifyUser(req: Request): Promise<{ plan: string } | null> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const payload = jwt.verify(authHeader.slice(7), config.JWT_SECRET) as any;
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { plan: true } });
      return user;
    }
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      const user = await prisma.user.findUnique({ where: { apiKey }, select: { plan: true } });
      return user;
    }
  } catch { /* token invalid/expired — treat as anonymous */ }
  return null;
}

// ─── Platform Presets (public) ────────────────────────────────────────────────

/**
 * List preset platform. Bila request membawa JWT/API key yang valid,
 * setiap platform ditandai `locked` sesuai plan user (untuk badge "Upgrade" di UI).
 */
export async function platformList(req: Request, res: Response, next: NextFunction) {
  try {
    const platforms = listPlatforms();
    const user = await tryIdentifyUser(req);

    if (!user) {
      res.json({ success: true, data: platforms });
      return;
    }

    const { getPlanLimits } = await import('../middleware/plan.middleware');
    const limits = await getPlanLimits(user.plan as any);
    const allowed: string[] = (limits as any)?.allowedPlatforms ?? [];
    const webhookEnabled = Boolean(limits?.canWebhook);

    const withLockInfo = platforms.map((p) => ({
      ...p,
      locked: !webhookEnabled || (allowed.length > 0 && !allowed.includes(p.key)),
    }));

    res.json({ success: true, data: withLockInfo });
  } catch (err) { next(err); }
}

export async function platformPreset(req: Request, res: Response, next: NextFunction) {
  try {
    const { platform } = req.params;
    const preset = getPlatformPreset(platform);
    if (!preset) {
      return res.status(404).json({ success: false, error: 'Platform preset not found' });
    }
    res.json({ success: true, data: { key: platform, ...preset } });
  } catch (err) { next(err); }
}

// ─── CRUD (authenticated) ─────────────────────────────────────────────────────

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const data = await listIntegrations(userId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function detail(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const data = await getIntegration(userId, req.params.integrationId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const data = await createIntegration(userId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const data = await updateIntegration(userId, req.params.integrationId, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    await deleteIntegration(userId, req.params.integrationId);
    res.json({ success: true, message: 'Integration deleted' });
  } catch (err) { next(err); }
}

export async function rotateToken(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const data = await regenerateToken(userId, req.params.integrationId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function logs(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user.id;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const data = await getIntegrationLogs(userId, req.params.integrationId, limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ─── Public Webhook Receiver ──────────────────────────────────────────────────

/**
 * POST /api/v1/integrations/receive/:secretToken
 *
 * No auth required — the secretToken IS the authentication.
 * Accepts any JSON or form-urlencoded body from any platform.
 * Always returns 200 immediately (fire-and-forget processing).
 */
export async function receive(req: Request, res: Response) {
  const { secretToken } = req.params;

  // Verifikasi HMAC signature bila integrasi mengonfigurasinya —
  // dicek SEBELUM merespons supaya payload palsu ditolak dengan 401
  try {
    const integration = await prisma.integration.findUnique({
      where: { secretToken },
      select: { id: true, signatureHeader: true, signatureSecret: true },
    });

    if (integration?.signatureSecret) {
      const headerName = (integration.signatureHeader || 'x-signature').toLowerCase();
      const received = String(req.headers[headerName] ?? '');
      const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

      const digest = crypto.createHmac('sha256', integration.signatureSecret).update(rawBody).digest();
      // Platform berbeda mengirim hex (GitHub-style, kadang berprefix "sha256=")
      // atau base64 (Shopify, WooCommerce) — terima keduanya
      const candidates = [
        digest.toString('hex'),
        `sha256=${digest.toString('hex')}`,
        digest.toString('base64'),
      ];

      const matches = (a: string, b: string) => {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
      };

      if (!received || !candidates.some((c) => matches(c, received))) {
        logger.warn(`Webhook signature mismatch for integration ${integration.id} (header ${headerName})`);
        await prisma.integrationLog.create({
          data: {
            integrationId: integration.id,
            rawPayload: req.body ?? {},
            status: 'FAILED',
            error: `Invalid signature (header: ${headerName})`,
          },
        }).catch(() => {});
        res.status(401).json({
          success: false,
          error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
        });
        return;
      }
    }
  } catch (err: any) {
    logger.error(`Webhook signature check error: ${err.message}`);
  }

  // Respond immediately — platforms may time out if we wait for processing
  res.json({ success: true, message: 'Webhook received' });

  const payload = req.body ?? {};
  const maskedToken = `${secretToken.slice(0, 8)}****${secretToken.slice(-4)}`;
  logger.debug(`Webhook received for token ${maskedToken}: ${JSON.stringify(payload).slice(0, 200)}`);

  // Process asynchronously — errors are caught and logged
  processWebhook(secretToken, payload).catch((err) => {
    logger.error(`Webhook processing error for token ${maskedToken}: ${err.message}`);
  });
}
