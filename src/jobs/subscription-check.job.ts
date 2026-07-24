import { prisma } from '../prisma/client';
import { logger } from '../config/logger';

export const PLAN_DURATION_DAYS = 30;

/**
 * Calculate the new planExpiresAt when activating/extending a plan.
 * If the user still has active days, extend from their current expiry.
 * Otherwise, start fresh from now.
 */
export function calcPlanExpiry(currentExpiry: Date | null): Date {
  const now = new Date();
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  return new Date(base.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
}

async function runSubscriptionCheck(): Promise<void> {
  logger.info('[SubscriptionJob] Checking expired subscriptions...');

  const expired = await prisma.user.findMany({
    where: {
      plan: { not: 'FREE' },
      planExpiresAt: { lte: new Date() },
    },
    select: { id: true, email: true, plan: true },
  });

  if (expired.length === 0) {
    logger.info('[SubscriptionJob] No expired subscriptions found.');
    return;
  }

  for (const user of expired) {
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: 'FREE', planExpiresAt: null },
    });
    logger.info(`[SubscriptionJob] Downgraded ${user.email} from ${user.plan} → FREE (expired)`);
  }

  logger.info(`[SubscriptionJob] Done. Downgraded ${expired.length} users.`);
}

let subscriptionInterval: NodeJS.Timeout | null = null;

export function startSubscriptionCheckJob(): void {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  // Run once shortly after startup
  setTimeout(() => {
    runSubscriptionCheck().catch((err) => logger.error('[SubscriptionJob] Error:', err));
  }, 15_000);

  subscriptionInterval = setInterval(() => {
    runSubscriptionCheck().catch((err) => logger.error('[SubscriptionJob] Error:', err));
  }, TWELVE_HOURS);

  logger.info('[SubscriptionJob] Subscription check job scheduled (runs every 12h)');
}

export function stopSubscriptionCheckJob(): void {
  if (subscriptionInterval) {
    clearInterval(subscriptionInterval);
    subscriptionInterval = null;
  }
}
