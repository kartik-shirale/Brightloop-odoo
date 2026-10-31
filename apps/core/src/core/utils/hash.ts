/**
 * Hashing + HMAC helpers (backend-rules.md #6).
 *
 * - Passwords: bcrypt (bcryptjs build, cost in constants.ts)
 * - OTPs: HMAC-SHA256 digest with a server secret — the clear OTP is NEVER
 *   persisted, so a Redis dump cannot reveal usable codes.
 */

import { randomInt, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from '../../config/constants.js';
import { env } from '../../config/env.js';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

/** HMAC-SHA256 digest of an OTP (hex). */
export const hmacOtp = (otp: string): string =>
  createHmac('sha256', env.OTP_HMAC_SECRET).update(otp).digest('hex');

/** Plain SHA-256 hex digest (e.g. refresh-token hashing before it hits Postgres). */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Constant-time string comparison for digests. */
export const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
};

/** Cryptographically secure random 6-digit OTP (no modulo bias, `randomInt` is [min, max)). */
export const generateOtp = (): string =>
  String(randomInt(0, 1_000_000)).padStart(6, '0');
