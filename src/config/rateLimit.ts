import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../redis/client';

/**
 * Shared Redis-backed store for express-rate-limit.
 * Without this, limiters use in-memory counters that reset on every deploy/restart
 * and don't share state across multiple app instances — defeating brute-force
 * protection on login/2FA/payment endpoints in any horizontally-scaled deployment.
 */
export function redisRateLimitStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix: `ratelimit:${prefix}:`,
    sendCommand: (...args: string[]) => (getRedisClient().call as (...a: string[]) => Promise<any>)(...args),
  });
}
