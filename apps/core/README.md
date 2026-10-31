# Brightloop API

Express API with PostgreSQL, Prisma contract migrations, Redis OTPs and rate
limiting, JWT access tokens, rotating refresh cookies, and EmailJS delivery.

## Setup

From the repository root:

1. Copy `apps/core/.env.example` to `apps/core/.env`.
2. Fill `DATABASE_URL`, `JWT_ACCESS_SECRET`, `OTP_HMAC_SECRET`, and `EMAILJS_*`.
3. In EmailJS, enable server requests and private-key authorization. Set the
   template **To Email** to `{{to_email}}`.

```sh
bun install
bun run redis:up
bun run --filter '@odoo/core' db:migrate
bun run --filter '@odoo/core' db:verify
bun run dev
```

Redis defaults to `redis://127.0.0.1:6380`. The API defaults to port `3001`.
`/health` checks liveness; `/ready` checks PostgreSQL and Redis.

Optionally set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to seed an admin at startup.
New passwords require 9+ characters, uppercase, lowercase, and a special character,
within 72 UTF-8 bytes. Public signup creates CUSTOMER accounts.

## Schema changes

From `apps/core`, run `contract:emit` and `migration:plan`, review the generated
operations, then run `db:migrate` and `db:verify`.

## Documentation

- [Authentication API](../../docs/authentication.md)
- [Backend plan](../../docs/plan/backend.md)
- [Backend rules](../../docs/backend-rules.md)
- [Shared contracts](../../shared/README.md)
