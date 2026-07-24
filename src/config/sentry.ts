import * as Sentry from '@sentry/node';
import { config } from './index';
import { logger } from './logger';

export function isSentryEnabled(): boolean {
  return Boolean(config.SENTRY_DSN);
}

/** Must be called as early as possible in bootstrap — before other imports create long-lived state. */
export function initSentry(): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
  });

  logger.info('Sentry error tracking initialized');
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!isSentryEnabled()) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
