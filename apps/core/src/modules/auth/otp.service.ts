import { randomUUID } from 'node:crypto';
import { getKvStore, type KvStore } from '../../config/redis.js';
import { REDIS_KEYS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { badRequest, rateLimited } from '../../core/errors.js';
import type { OtpMailer } from '../../core/mail/emailjs.js';
import { generateOtp, hmacOtp } from '../../core/utils/hash.js';

export type OtpKind = 'verify' | 'reset';
export interface IssuedOtp { expiresInSeconds: number }
export class OtpService {
  constructor(private readonly mail: OtpMailer, private readonly kv: KvStore = getKvStore()) {}

  /** Reserve the cooldown atomically before generating a replacement code. */
  async issue(kind: OtpKind, email: string, name: string): Promise<IssuedOtp> {
    const cooldownKey = REDIS_KEYS.otpCooldown(kind, email);
    const reservation = randomUUID();
    if (!await this.kv.setIfAbsent(cooldownKey, reservation, env.OTP_RESEND_COOLDOWN_SECONDS)) {
      const retryAfter = Math.max(1, await this.kv.ttl(cooldownKey));
      throw rateLimited(`Please wait ${retryAfter}s before requesting another code.`, retryAfter);
    }
    const otpKey = REDIS_KEYS.otp(kind, email);
    const otp = generateOtp();
    const record = JSON.stringify({ digest: hmacOtp(otp), attempts: 0 });
    const dailyKey = REDIS_KEYS.otpDaily(kind, email);
    let reservedDailySlot = false;
    try {
      const count = await this.kv.incr(dailyKey, 86400);
      reservedDailySlot = true;
      if (count > env.OTP_DAILY_LIMIT) throw rateLimited('Daily OTP limit reached.', 86400);
      await this.kv.set(otpKey, record, env.OTP_TTL_SECONDS);
      await this.mail.sendOtp({ toEmail: email, name, otp, kind,
        expiryMinutes: Math.ceil(env.OTP_TTL_SECONDS / 60) });
    } catch (error) {
      // A failed delivery must not leave an unusable code or cooldown behind.
      await this.kv.deleteIfValue(otpKey, record);
      await this.kv.deleteIfValue(cooldownKey, reservation);
      if (reservedDailySlot) await this.kv.decrement(dailyKey);
      throw error;
    }
    return { expiresInSeconds: env.OTP_TTL_SECONDS };
  }

  /** Redis verifies, counts wrong attempts and consumes the code in one script. */
  async verify(kind: OtpKind, email: string, otp: string): Promise<void> {
    const result = await this.kv.verifyOtp(REDIS_KEYS.otp(kind, email), hmacOtp(otp), env.OTP_MAX_ATTEMPTS);
    if (result === 1) return;
    if (result === 0) throw badRequest('OTP is invalid or expired. Request a new code.');
    const remaining = -result - 1;
    throw badRequest(remaining === 0 ? 'Too many wrong attempts. Request a new code.' :
      `Wrong OTP. ${remaining} attempts remaining.`);
  }
}
