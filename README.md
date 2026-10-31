# Brightloop

Subscription management for recurring billing, invoices, payments, and reporting.
Built with React, Vite, Express, PostgreSQL, Redis, and TypeScript in a Bun monorepo.

Authentication and role-based routing are implemented. Business modules are
planned; their database schema and shared API contracts are in place.

## Structure

- `apps/web` — React frontend
- `apps/core` — Express API
- `shared` — `@brightloop/shared` contracts for both apps
- `docs` — engineering rules and implementation plans

## Setup

Requires Bun, Node.js, Docker Compose, PostgreSQL, and an EmailJS service.

1. Run `bun install`.
2. Copy each app's `.env.example` to `.env` and fill in your settings.
3. Start Redis and apply migrations:

```sh
bun run redis:up
bun run --filter '@odoo/core' db:migrate
bun run --filter '@odoo/core' db:verify
bun run dev
```

Frontend: `http://localhost:3000` · API: `http://localhost:3001/api/v1`

Public signup creates CUSTOMER accounts. ADMIN and STAFF use `/dashboard`;
CUSTOMER uses `/portal`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to seed an admin.

## Checks

```sh
bun run typecheck
bun run lint
bun run test
bun run build
```

## Documentation

- [Core setup](apps/core/README.md) · [Authentication](docs/authentication.md)
- [Shared contracts](shared/README.md)
- [Problem statement](docs/plan/ps.md)
- [Backend plan](docs/plan/backend.md) · [Frontend plan](docs/plan/frontend.md)
- [Backend rules](docs/backend-rules.md) · [Frontend rules](docs/frontend-rules.md)
