# Core API

Node.js + Express backend with JWT access tokens, rotating opaque refresh tokens,
PostgreSQL sessions through the existing Prisma 8 contract client, and Redis OTPs.
Routes use plain Express middleware.

## Setup

From the repository root:

```sh
bun install
bun run redis:up
```

Copy `.env.example` to `.env` inside `apps/core`. Fill `DATABASE_URL`,
`JWT_ACCESS_SECRET`, `OTP_HMAC_SECRET` and the four `EMAILJS_*` credentials.
Generate each secret separately with:

```sh
node -p "require('crypto').randomBytes(48).toString('hex')"
```

Redis is already configured at `redis://127.0.0.1:6380`. Docker Compose binds it
only to localhost, persists data in `odoo_redis-data`, and checks health with PING.
Use `bun run redis:down` to stop it without deleting data. `REDIS_PORT` overrides
the host port; also update `REDIS_URL` in the core environment if you change it.

Supply both `ADMIN_EMAIL` and `ADMIN_PASSWORD` to seed a verified ADMIN account.
The seed leaves existing accounts unchanged. Leave both blank to skip seeding.
There is no public role selector; public signup always creates CUSTOMER. ADMIN
and STAFF use the dashboard; CUSTOMER uses the portal shell. A staff-provisioning
API is planned but is not implemented yet. New admin seed passwords must satisfy
the shared password policy: at least 9 characters with uppercase, lowercase, and
a special character, within the 72-byte bcrypt limit.

The migrations include `20261031T0007_auth_foundation` and
`20261031T0447_brightloop_compatibility`. The compatibility migration maps
USER/MANAGER roles to CUSTOMER/STAFF, adds account activation state, removes the
old scaffold Post table, and creates the planned business-domain tables. Those
tables do not implement the planned business APIs. Apply migrations separately
in each environment. From `apps/core`, `bun run db:migrate` applies them and
`bun run db:verify` checks the marker and live schema.
For subsequent schema changes, run `bun run contract:emit`,
`bun run migration:plan`, review the generated operations, then `bun run db:migrate`.

Configure EmailJS to allow server-side API calls
and enable private-key authorization. Set the template To Email field to
`{{to_email}}`. Template variables are `to_email`, `name`,
`otp`, `expiry_minutes`, and `purpose`.

```sh
bun run dev
```

The app fails fast on missing configuration. `/health` (`/api/health` alias) is
liveness; `/ready` (`/api/ready`) checks both PostgreSQL and Redis.

## Verification

From the repository root:

```sh
bun run typecheck
bun run lint
bun run build
bun run test
```

From `apps/core`, `bun run test:redis` additionally checks atomic operations
against the Docker Redis instance. The regular tests use fake repositories and
mailers: no real database, credentials or emails are needed. The browser suite also checks real admin login and cookie-based restoration against
the configured PostgreSQL database and Redis. Email delivery is mocked in automated
tests; live EmailJS delivery depends on your configured service and template.

See [authentication API](../../docs/authentication.md) for routes, request and
response examples, RBAC and browser integration.
