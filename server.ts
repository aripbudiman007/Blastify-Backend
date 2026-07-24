import 'dotenv/config';
import { initSentry, captureException } from './src/config/sentry';
initSentry();

import { createApp } from './src/app';
import { connectPrisma, disconnectPrisma } from './src/prisma/client';
import { getRedisClient, disconnectRedis } from './src/redis/client';
import { startMessageWorker, stopMessageWorker } from './src/queue/message.worker';
import { requeueScheduledMessages } from './src/queue/requeue';
import { startMessageCleanupJob, stopMessageCleanupJob } from './src/jobs/message-cleanup.job';
import { startSubscriptionCheckJob, stopSubscriptionCheckJob } from './src/jobs/subscription-check.job';
import { restoreAllSessions } from './src/baileys/session';
import { logger } from './src/config/logger';
import { config } from './src/config';
import fs from 'fs';

async function bootstrap(): Promise<void> {
  if (!fs.existsSync(config.UPLOAD_DIR)) {
    fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
  }
  if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs', { recursive: true });
  }

  await connectPrisma();

  getRedisClient();

  startMessageWorker();
  startMessageCleanupJob();
  startSubscriptionCheckJob();

  const { httpServer } = createApp();

  httpServer.listen(config.PORT, () => {
    logger.info(`🚀 WA Gateway running on port ${config.PORT} [${config.NODE_ENV}]`);
  });

  logger.info('Restoring active sessions...');
  restoreAllSessions().catch((err) =>
    logger.error('Error during session restore', err),
  );

  logger.info('Re-queueing scheduled messages...');
  requeueScheduledMessages().catch((err) =>
    logger.error('Error during scheduled message requeue', err),
  );

  // Muat daftar plan ber-watermark dari DB (data-driven via PlanLimit.hasWatermark)
  const { refreshWatermarkPlans } = await import('./src/utils/watermark');
  refreshWatermarkPlans().catch(() => {});

  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received. Shutting down gracefully...`);
    httpServer.close(async () => {
      await stopMessageWorker();
      stopMessageCleanupJob();
      stopSubscriptionCheckJob();
      await disconnectPrisma();
      await disconnectRedis();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
    captureException(err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
    captureException(reason);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
