/**
 * Redis-backed rate limiting (backend-rules.md #6) — fixed-window per key
 * (`INCR` + `EXPIRE` on first hit, atomic in Redis).
 */

import type { RequestHandler } from 'express';
import { getKvStore, type KvStore } from '../../config/redis.js';
import { REDIS_KEYS } from '../../config/constants.js';
import { rateLimited } from '../errors.js';
import { logger } from '../logger.js';

export interface RateLimitOptions {
  /** Stable bucket name, e.g. `global` or `otp`. */
  scope: string;
  store?: KvStore;
  /** Requests allowed per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Extra key discriminator (defaults to the client IP). */
  keyFor?: (req: { ip?: string; method?: string; path?: string }) => string;
}

export const ipKey = (): ((req: { ip?: string }) => string) => (req) => req.ip ?? 'unknown';

/** Largest of the supplied keys wins (string sort) — deterministic & uniform. */
const buildKey = (options: RateLimitOptions, discriminator: string): string =>
  REDIS_KEYS.rateLimit(options.scope, discriminator);

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const keyFor =
    options.keyFor ??
    (() => {
      return (req: { ip?: string }) => req.ip ?? 'unknown';
    })();

  return async (req, _res, next) => {
    try {
      const windowKey = buildKey(options, keyFor(req));
      const cache = options.store ?? getKvStore();
      const hits = await cache.incr(windowKey, options.windowSeconds);
      if (hits > options.max) {
        const ttl = await cache.ttl(windowKey);
        logger.warn({ scope: options.scope, hits, ttl }, 'rate limit exceeded');
        next(rateLimited('Too many requests, slow down.', ttl > 0 ? ttl : options.windowSeconds));
        return;
      }
      next();
    } catch (error) {
      // Fail closed when Redis is unavailable; auth must not bypass limits.
      next(error);
    }
  };
}

/** Default global limiter: 100 req / 15 min / IP. */
export const globalRateLimiter: RequestHandler = createRateLimiter({
  scope: 'global',
  max: 100,
  windowSeconds: 15 * 60,
  keyFor: ipKey(),
});

/** Strict limiter for OTP endpoints: 30 req / 15 min / IP (email cooldown lives in the service). */
export const otpRateLimiter: RequestHandler = createRateLimiter({
  scope: 'otp',
  max: 30,
  windowSeconds: 15 * 60,
  keyFor: ipKey(),
});
