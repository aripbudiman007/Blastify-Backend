import { prisma } from '../prisma/client';
import { logger } from '../config/logger';
import { Plan } from '@prisma/client';

// Default retention days per plan (fallback if PlanLimit table not seeded)
const DEFAULT_RETENTION: Record<Plan, number> = {
  FREE:    2,
  LITE:    3,
  REGULAR: 5,
  MASTER:  7,
  ULTRA:   30,
};

async function getRetentionDays(plan: Plan): Promise<number> {
  try {
    const limit = await (prisma as any).planLimit.findUnique({ where: { plan } });
    if (limit?.messageRetentionDays != null) return limit.messageRetentionDays;
  } catch { /* fall through */ }
  return DEFAULT_RETENTION[plan] ?? 5;
}

async function runCleanup(): Promise<void> {
  logger.info('[CleanupJob] Starting message history cleanup...');

  // Get all plans and their retention
  const plans = Object.values(Plan) as Plan[];
  let totalDeleted = 0;

  for (const plan of plans) {
    const retentionDays = await getRetentionDays(plan);
    if (retentionDays === -1) continue; // forever retention

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    // Find users on this plan
    const users = await prisma.user.findMany({
      where: { plan },
      select: { id: true },
    });

    if (users.length === 0) continue;

    const userIds = users.map((u) => u.id);

    const result = await prisma.message.deleteMany({
      where: {
        userId: { in: userIds },
        createdAt: { lt: cutoff },
        status: { in: ['SENT', 'DELIVERED', 'READ', 'FAILED'] },
      },
    });

    totalDeleted += result.count;
    if (result.count > 0) {
      logger.info(`[CleanupJob] Plan ${plan} (${retentionDays}d): deleted ${result.count} messages`);
    }
  }

  await cleanupStaleChatFlowSessions();

  logger.info(`[CleanupJob] Done. Total deleted: ${totalDeleted}`);
}

/**
 * Chat flow sessions: expire abandoned ACTIVE conversations (safety net —
 * chatflow.service.ts already expires on next read, this catches contacts who
 * never send another message) and delete old COMPLETED/EXPIRED rows.
 */
async function cleanupStaleChatFlowSessions(): Promise<void> {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

  const expired = await prisma.chatFlowSession.updateMany({
    where: { status: 'ACTIVE', lastInteractionAt: { lt: new Date(Date.now() - ONE_DAY_MS) } },
    data: { status: 'EXPIRED' },
  });

  const deleted = await prisma.chatFlowSession.deleteMany({
    where: { status: { in: ['COMPLETED', 'EXPIRED'] }, updatedAt: { lt: new Date(Date.now() - SEVEN_DAYS_MS) } },
  });

  if (expired.count > 0 || deleted.count > 0) {
    logger.info(`[CleanupJob] Chat flow sessions: ${expired.count} expired, ${deleted.count} deleted`);
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

export function startMessageCleanupJob(): void {
  // Run once on startup (after 10s delay) then every 24h
  const TEN_SECONDS = 10_000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  setTimeout(() => {
    runCleanup().catch((err) => logger.error('[CleanupJob] Error:', err));
  }, TEN_SECONDS);

  cleanupInterval = setInterval(() => {
    runCleanup().catch((err) => logger.error('[CleanupJob] Error:', err));
  }, ONE_DAY);

  logger.info('[CleanupJob] Message cleanup job scheduled (runs every 24h)');
}

export function stopMessageCleanupJob(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
