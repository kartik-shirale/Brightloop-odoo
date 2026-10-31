/**
 * Framework constants. Runtime configuration belongs in `env.ts`.
 */

/** Refresh-token cookie configuration. Session cookies keep users signed in. */
export const REFRESH_COOKIE = Object.freeze({
  name: 'odoo_refresh_token',
  /** Scoped to the auth router so the browser sends it only to auth endpoints. */
  path: '/api/v1/auth',
  httpOnly: true,
  sameSite: 'lax' as const,
});

/** bcrypt cost (bcryptjs, pure JS — chosen over native bcrypt for Windows dev). */
export const BCRYPT_COST = 10;

/** Response-envelope status codes (http codes in errors.ts). */
export const OTP_DIGITS = 6;

/** Redis key namespaces (TTLs are set by callers, not here). */
export const REDIS_KEYS = Object.freeze({
  otp: (kind: string, email: string) => `app:auth:otp:${kind}:${email}`,
  otpAttempts: (kind: string, email: string) => `app:auth:otp:attempts:${kind}:${email}`,
  otpCooldown: (kind: string, email: string) => `app:auth:otp:cooldown:${kind}:${email}`,
  otpDaily: (kind: string, email: string) => `app:auth:otp:daily:${kind}:${email}`,
  rateLimit: (scope: string, key: string) => `app:rl:${scope}:${key}`,
  cache: (key: string) => `app:cache:${key}`,
});
