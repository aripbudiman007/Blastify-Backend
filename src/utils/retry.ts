import { logger } from '../config/logger';

interface RetryOptions {
  attempts: number;
  delay: number;
  backoff?: 'linear' | 'exponential';
  onError?: (err: Error, attempt: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { attempts, delay, backoff = 'linear', onError } = options;
  let lastError: Error;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (onError) onError(err, attempt);

      if (attempt < attempts) {
        const waitMs = backoff === 'exponential' ? delay * Math.pow(2, attempt - 1) : delay;
        logger.debug(`Retry attempt ${attempt}/${attempts} after ${waitMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError!;
}
