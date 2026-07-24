import { prisma } from '../prisma/client';
import { enqueueMessage } from './message.queue';
import { logger } from '../config/logger';

/**
 * Re-enqueue scheduled messages that are still PENDING/QUEUED in the DB.
 * Called once on server startup — if the server restarted while delayed jobs
 * were sitting in BullMQ, Redis flushes or job loss would otherwise drop them.
 *
 * Idempotent: enqueueMessage uses jobId = messageId, so a job that already
 * exists in BullMQ is not duplicated.
 */
export async function requeueScheduledMessages(): Promise<void> {
  try {
    const pending = await prisma.message.findMany({
      where: {
        scheduledAt: { not: null },
        status: { in: ['PENDING', 'QUEUED'] },
      },
      include: {
        device: { select: { minDelay: true, maxDelay: true } },
        user: { select: { plan: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5_000,
    });

    if (pending.length === 0) {
      logger.info('Requeue check: no scheduled messages to restore');
      return;
    }

    let requeued = 0;
    for (const msg of pending) {
      // Overdue messages (scheduledAt in the past) are sent immediately
      const delay = Math.max(0, msg.scheduledAt!.getTime() - Date.now());
      try {
        await enqueueMessage(
          {
            messageId: msg.id,
            deviceId: msg.deviceId,
            userId: msg.userId,
            to: msg.to,
            type: msg.type,
            content: msg.content,
            mediaUrl: msg.mediaUrl ?? undefined,
            caption: msg.caption ?? undefined,
            minDelay: msg.device.minDelay,
            maxDelay: msg.device.maxDelay,
            userPlan: msg.user.plan,
          },
          delay > 0 ? delay : undefined,
        );
        requeued++;
      } catch (err: any) {
        logger.error(`Failed to requeue scheduled message ${msg.id}: ${err.message}`);
      }
    }

    logger.info(`Requeued ${requeued}/${pending.length} scheduled message(s) after restart`);
  } catch (err: any) {
    logger.error(`Scheduled message requeue failed: ${err.message}`);
  }
}
