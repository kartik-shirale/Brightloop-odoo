// Test-only values. This module must be imported before application modules.
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  JWT_ACCESS_SECRET: 'a'.repeat(48), OTP_HMAC_SECRET: 'c'.repeat(48),
  EMAILJS_SERVICE_ID: 'test', EMAILJS_TEMPLATE_ID: 'test', EMAILJS_PUBLIC_KEY: 'test',
  EMAILJS_PRIVATE_KEY: 'test', ACCESS_TOKEN_TTL: '15m', OTP_TTL_SECONDS: '300',
  OTP_MAX_ATTEMPTS: '5', OTP_RESEND_COOLDOWN_SECONDS: '60', OTP_DAILY_LIMIT: '10',
});
