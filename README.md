# Brightloop Subscription Management

Brightloop is a subscription management application being built for customer
subscriptions, recurring billing, invoicing, payments, and reporting. This Bun
monorepo contains the Express API, React frontend, and their shared API contracts.

## Current status

The authentication foundation is implemented: email signup and OTP verification,
login, rotating refresh sessions, logout, password recovery, and role-based routing.
ADMIN and STAFF land on the dashboard; CUSTOMER lands on the customer portal shell.
Public signup always creates a CUSTOMER account.

The database contract and migration files cover the planned business domain.
Shared request, response, query, enum, and workflow types cover 121 agreed API
endpoints. Catalog, subscriptions, invoices, payments, billing runs, reports,
staff administration, and full portal business pages remain planned modules.
Their schema and types do not mean their API handlers are implemented.

## Repository layout

| Package | Directory | Responsibility |
| --- | --- | --- |
| `@odoo/core` | `apps/core` | Node.js, Express 5, Prisma contract client, PostgreSQL, Redis, EmailJS |
| `@odoo/web` | `apps/web` | React, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router |
| `@brightloop/shared` | `shared` | Common API contracts consumed by both apps |

```text
apps/
  core/
    src/modules/        Authentication and users modules
    src/prisma/         Authored contract, generated client artifacts, admin seed
    migrations/         Versioned migrations and contract snapshots
  web/
    src/api/            Shared HTTP client and authentication API calls
    src/components/     Forms, layouts, shared components, shadcn/ui
    src/hooks/auth/     Authentication actions and form behavior
    src/pages/          Auth pages, dashboard and portal shells
shared/
  src/types/            Feature contracts and endpoint type registry
  tests/                Compile-time checks and schema/plan coverage tests
docs/
  plan/                 Problem statement and implementation plans
compose.yaml            Local Redis service
```

## Local setup

### Prerequisites

- Bun (the repository declares `bun@1.3.14`) and Node.js.
- Docker with Docker Compose for Redis.
- A PostgreSQL database compatible with the Prisma contract client (PostgreSQL 15+).
- An EmailJS service and OTP template configured for server-side requests.

### 1. Install dependencies and configure the environment

```sh
bun install
```

For a new checkout, copy `apps/core/.env.example` to `apps/core/.env`, and
`apps/web/.env.example` to `apps/web/.env`. Keep existing populated files when
updating an installation.

In the core environment, provide:

- `DATABASE_URL`: your PostgreSQL connection string.
- `JWT_ACCESS_SECRET` and `OTP_HMAC_SECRET`: independent random secrets.
- `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, and
  `EMAILJS_PRIVATE_KEY`: server-side email configuration.
- `CORS_ORIGIN`: the frontend origin; the default is `http://localhost:3000`.
- Optionally, both `ADMIN_EMAIL` and `ADMIN_PASSWORD` to seed a verified admin.
  New passwords require at least 9 characters, uppercase, lowercase, and a special
  character, with a maximum of 72 UTF-8 bytes. Existing accounts are not overwritten.

Generate each secret separately:

```sh
node -p "require('crypto').randomBytes(48).toString('hex')"
```

EmailJS must allow non-browser/server requests and private-key authorization.
Set the template **To Email** field to `{{to_email}}`. Template variables are
`to_email`, `name`, `otp`, `expiry_minutes`, and `purpose`.

The frontend's `NEXT_PUBLIC_API_URL` can stay empty for local development: Vite
proxies `/api` to the core API. For a separate deployment, set it to the API origin
and allow the frontend origin in `CORS_ORIGIN`. Despite the variable's retained
name, the frontend runs on Vite. EmailJS credentials belong only in the backend.
Environment files are ignored by Git; examples contain no real credentials.

### 2. Start Redis

```sh
bun run redis:up
```

Redis 8 runs in Docker at `redis://127.0.0.1:6380`, bound to localhost, with a
persistent volume and health check. Keep `REDIS_URL` in the core environment in
sync if you override the Compose host port with `REDIS_PORT`.

```sh
bun run redis:logs
bun run redis:down
```

Stopping Redis preserves its volume. The API requires Redis for OTPs and rate
limiting and reports unavailability rather than bypassing those protections.

### 3. Apply and verify database migrations

From the repository root:

```sh
bun run --filter '@odoo/core' db:migrate
bun run --filter '@odoo/core' db:verify
```

The repository includes the auth foundation and Brightloop compatibility
migrations. The compatibility migration maps old USER/MANAGER roles to
CUSTOMER/STAFF and aligns the database with the full application contract.
Apply migrations to each environment before running the app; a new checkout does
not migrate its database automatically. Review migration operations before
applying them to an existing database.

For subsequent schema changes, run `contract:emit` and `migration:plan` from
`apps/core`, review the generated migration, then run `db:migrate` and `db:verify`.
The contract source is `apps/core/src/prisma/contract.prisma`.

### 4. Start the application

```sh
bun run dev
```

| Service | Default address |
| --- | --- |
| Frontend | http://localhost:3000 |
| Core API | http://localhost:3001/api/v1 |
| Liveness | http://localhost:3001/health |
| Database and Redis readiness | http://localhost:3001/ready |

Auth routes include `/login`, `/signup`, `/verify-otp`, and `/forgot-password`.
The dashboard is at `/dashboard`, and the customer shell is at `/portal`.

`bun run dev` builds shared first, then watches shared, core, and web together.
To run apps separately, build shared with
`bun run --filter '@brightloop/shared' build`, then use `bun run dev:core` and
`bun run dev:web` in separate terminals. Configured admin seeding runs on API
startup; it can also be invoked with `bun run --filter '@odoo/core' db:seed`.

## Shared contracts

Both backend and frontend import their API contracts from `@brightloop/shared`:

```ts
import type {
  CreateSubscriptionRequest,
  SubscriptionDto,
  ListSubscriptionsQuery,
  ResponseFor,
} from '@brightloop/shared';
import { Role, SubscriptionStatus } from '@brightloop/shared';
```

The package has no Prisma, Express, React, or Zod dependency. Dates travel as ISO
strings, money as integer paise, and percentage rates as basis points. Backend
schemas validate requests at runtime and mappers construct public DTOs. Admin,
staff, and portal projections keep their respective fields explicit.

See the [shared package guide](shared/README.md) for endpoint helpers, payload
conventions, contract checks, and outstanding design details. Rebuild or watch
shared after changing its exports. Type-only imports are erased; enum constants
and application constants also have runtime exports.

## Checks

Run these from the repository root:

```sh
bun run typecheck
bun run lint
bun run build
bun run test
```

The default test command runs shared compile-time/schema/endpoint checks followed
by backend auth tests using fake repositories, a test KV store, and mocked email.
It does not require a live database or send real emails.

Additional checks:

```sh
bun run --filter '@brightloop/shared' test
bun run --filter '@odoo/core' test:redis
bun run --filter '@odoo/web' test:compatibility
bun run --filter '@odoo/web' test:e2e
```

The Redis integration test requires running Redis. Playwright browser tests
require its browser installation; compatibility tests intercept built artifacts
and API responses, while live auth E2E tests require the app services and configured
admin credentials. These commands do not start the development servers for you.

## Project documentation

- [Problem statement](docs/plan/ps.md)
- [Backend implementation plan](docs/plan/backend.md)
- [Frontend implementation plan](docs/plan/frontend.md)
- [Compatibility and migration baseline](docs/plan/compatibility.md)
- [Backend engineering rules](docs/backend-rules.md)
- [Frontend engineering rules](docs/frontend-rules.md)
- [Authentication API](docs/authentication.md)
- [Core setup and verification](apps/core/README.md)
- [Shared API contract guide](shared/README.md)
