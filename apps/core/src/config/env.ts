import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
/**
 * Fail-fast environment validation (backend-rules.md #2).
 *
 * Access secrets via `import { env } from '../config/env.js'` only — never
 * `process.env` in feature code.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().default(3001),

  /** Requires PostgreSQL >= 15. Validated by the Prisma CLI at connect time too. */
  DATABASE_URL: z.url().refine((v) => /^postgres(ql)?:/.test(v), 'Expected a PostgreSQL URL'),

  /** Local Docker Compose Redis by default. */
  REDIS_URL: z.url().default('redis://127.0.0.1:6380'),

  /** Comma-separated allowlist of origins, e.g. `http://localhost:3000`. */
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  /** JWT secrets — generate with `node -p "require('crypto').randomBytes(48).toString('hex')"` */
  JWT_ACCESS_SECRET: z.string().min(32),
  /** Secret used to HMAC the OTP before it is persisted (and never stored in clear). */
  OTP_HMAC_SECRET: z.string().min(32),

  ACCESS_TOKEN_TTL: z.string().regex(/^[1-9]\d*[smh]$/).default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_DAILY_LIMIT: z.coerce.number().int().positive().default(10),

  /** IANA zone used to decide the business "today". Stored dates stay in UTC. */
  APP_TIMEZONE: z.string().default('Asia/Kolkata').refine((zone) => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'Expected a valid IANA time zone'),

  EMAILJS_SERVICE_ID: z.string().min(1),
  EMAILJS_TEMPLATE_ID: z.string().min(1),
  EMAILJS_PUBLIC_KEY: z.string().min(1),
  EMAILJS_PRIVATE_KEY: z.string().min(1),
  /** Optional: without it, sending an invoice returns 503 DELIVERY_FAILED. */
  EMAILJS_INVOICE_TEMPLATE_ID: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).optional()),

  /** Base URL of the customer portal, used in invoice emails. */
  APP_PUBLIC_URL: z.preprocess((v) => v === '' ? undefined : v, z.url().default('http://localhost:3000')),
  DEFAULT_CURRENCY: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).default('INR')),
  /** Company details printed on invoices. */
  COMPANY_NAME: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).default('Brightloop')),
  COMPANY_ADDRESS: z.string().default(''),
  COMPANY_TAX_ID: z.string().default(''),

  /** Billing runs and the in-process scheduler (backend plan sections M11 and 8). */
  BILLING_SCHEDULER_ENABLED: z.preprocess(
    (v) => v === '' ? undefined : v,
    z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  ),
  /** UTC hour (0 to 23) from which the scheduler starts the daily billing run. */
  BILLING_RUN_HOUR_UTC: z.preprocess((v) => v === '' ? undefined : v, z.coerce.number().int().min(0).max(23).default(0)),
  /** Subscriptions fetched per keyset batch during a billing run. */
  BILLING_BATCH_SIZE: z.preprocess((v) => v === '' ? undefined : v, z.coerce.number().int().min(1).max(1000).default(100)),
  /** Maximum overdue periods billed for one subscription in one run. */
  BILLING_MAX_CATCHUP_PERIODS: z.preprocess((v) => v === '' ? undefined : v, z.coerce.number().int().min(1).max(120).default(12)),
  /** A run still RUNNING after this many minutes is marked FAILED on startup. */
  BILLING_STUCK_RUN_MINUTES: z.preprocess((v) => v === '' ? undefined : v, z.coerce.number().int().min(1).default(30)),

  /** Seed credentials for the default admin (role ADMIN, pre-verified). */
  ADMIN_EMAIL: z.preprocess((v) => v === '' ? undefined : v, z.email().toLowerCase().optional()),
  ADMIN_PASSWORD: z.preprocess((v) => v === '' ? undefined : v, z.string().min(8).optional()),
}).refine((value) => Boolean(value.ADMIN_EMAIL) === Boolean(value.ADMIN_PASSWORD), {
  message: 'Provide both ADMIN_EMAIL and ADMIN_PASSWORD, or leave both blank',
  path: ['ADMIN_EMAIL'],
});

type EnvSource = Record<string, string | undefined>;

function parseEnv(source: EnvSource): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration. Fill apps/core/.env:\n${fields.join('\n')}`);
  }
  return result.data;
}

const parsed = parseEnv(process.env);

export const env = Object.freeze({
  ...parsed,
  corsOrigins: parsed.CORS_ORIGIN,
});

export type Env = typeof env;
