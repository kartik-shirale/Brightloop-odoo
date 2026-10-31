# BACKEND ENGINEERING RULES (MANDATORY FOR EVERY TASK)

Stack: Node.js, TypeScript, Express 5, the existing Prisma 8 PostgreSQL contract client, Redis (ioredis), Zod, bcryptjs, jsonwebtoken, Pino, and EmailJS. Bun manages the monorepo and scripts; the backend runs on Node.js.

Follow these rules in generated code. If a request conflicts with a rule, explain the conflict and follow the rule unless the user explicitly overrides it. Keep the implementation simple and consistent with the existing code.

## 1. Architecture and folder structure

Use feature-based modules with this dependency direction:

HTTP router/handler -> service -> repository -> Prisma.

Thin HTTP handlers can live directly in `<feature>.routes.ts`. Extract a separate controller only when it makes a module easier to maintain. A controller file is not required for every module.

```text
apps/core/
├── src/
│   ├── app.ts                         # Express setup; mounts module routers under /api/v1
│   ├── server.ts                      # Bootstrap and graceful shutdown
│   ├── index.ts                       # Server entry point
│   ├── container.ts                   # Constructor-based dependency wiring
│   ├── config/
│   │   ├── env.ts                     # Loads core .env and validates with Zod
│   │   ├── constants.ts
│   │   ├── prisma.ts                  # Exposes the shared contract client
│   │   └── redis.ts                   # Redis client, KV interface, test double
│   ├── core/
│   │   ├── errors.ts                  # AppError and error factory helpers
│   │   ├── logger.ts
│   │   ├── mail/emailjs.ts
│   │   ├── middlewares/               # Auth, role checks, validation, errors, rate limits
│   │   ├── utils/                     # Async handlers, response, pagination, hashing, JWTs
│   │   └── types/                     # Express augmentation and internal row types
│   ├── modules/
│   │   └── <feature>/
│   │       ├── <feature>.routes.ts
│   │       ├── <feature>.service.ts
│   │       ├── <feature>.repository.ts
│   │       ├── <feature>.schema.ts
│   │       ├── <feature>.dto.ts
│   │       └── <feature>.test.ts
│   └── prisma/
│       ├── contract.prisma            # Authored contract
│       ├── contract.json              # Generated contract artifact
│       ├── contract.d.ts              # Generated contract types
│       ├── db.ts                      # Creates the single shared client
│       └── seed.ts                    # Optional configured admin seed
├── migrations/
│   ├── app/                           # Generated, reviewable migration packages
│   └── snapshots/                     # Generated contract snapshots
└── prisma.config.ts

shared/src/types/                      # Public request/response DTOs and roles
```

- HTTP handlers contain only HTTP concerns: read validated inputs, call a service, set cookies/headers, and return a response. No business logic or Prisma queries.
- Services contain business logic and accept typed values. No `req`/`res` or Express types.
- Repositories own database queries and database transactions. Services coordinate operations through repository methods.
- Only repositories import Prisma for feature queries. Client configuration, lifecycle cleanup and seed wiring are infrastructure concerns; seed data access still goes through a repository.
- One feature per module folder. Modules collaborate through services or narrow gateways wired in `container.ts`; do not import another module's repository into feature code.
- Use constructor injection and small interfaces/gateways for testability. Do not introduce a DI framework.
- Mount routers in `app.ts`. A separate `routes/index.ts` is optional when the routing tree grows.

## 2. API design and validation

- Resource base paths: `/api/v1/<resource>`, using plural nouns and kebab-case. Auth workflow endpoints such as `/api/v1/auth/login` and `/verify-otp` are intentional exceptions to noun-only routing.
- Standard resource methods: GET list, GET `/:id`, POST create, PUT replace, PATCH update, DELETE remove.
- Validate consumed `body`, `query`, and `params` with Zod. Pass only parsed, typed values to services.
- Use `validateBody`, `validateQuery`, `validateParams`, and `validated(res, source, schema)` from the existing validation middleware.
- Parsed values live in `res.locals.validated`. Do not assign to `req.query`: it is a getter in Express 5. Do not cast raw input to a DTO to bypass validation.
- Validate IDs as positive integers or UUIDs, as appropriate. Invalid input returns 400 with `{ field, message }` details.
- Lists always have bounded pagination: `page` defaults to 1, `limit` defaults to 10 and is at most 100. Return pagination metadata.
- For searchable/filterable lists, support case-insensitive search over explicit fields, whitelisted sorting, and explicit filters. Do not add meaningless search/filter parameters to lists that do not need them.
- Optional field selection or relation loading must use a whitelist.
- Reuse `core/utils/pagination.ts`. Use offset pagination by default; cursor pagination when the use case warrants it.
- API responses use these envelopes (health probes have their documented diagnostic shape):

```json
{
  "success": true,
  "message": "Users fetched",
  "data": [],
  "meta": {
    "page": 1, "limit": 10, "total": 0, "totalPages": 0,
    "hasNext": false, "hasPrev": false
  }
}
```

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "field": "email", "message": "Invalid email" }]
  }
}
```

- Use the existing `respondOk`/`respondCreated` helpers and DTO mappers.
- Never return password hashes, refresh-token hashes, OTP digests, or internal database fields. Access JWTs and short-lived reset grants are returned only by the auth endpoints that intentionally issue them; refresh tokens travel in httpOnly cookies.
- Public request/response contracts and roles live in `@brightloop/shared`. Keep them synchronized with backend behavior.
- Use soft delete where recovery is needed. Filter soft-deleted records in normal repository reads; auth can inspect them to explicitly reject the account.

## 3. Routing, authentication and RBAC without decorators

- Use plain Express routers and explicit middleware. Do not add route decorators, metadata registries, `reflect-metadata`, `experimentalDecorators`, or `emitDecoratorMetadata`.
- Middleware order is: `rateLimit -> authenticate -> requireRoles (when needed) -> validate -> asyncHandler(handler)`.
- Protect an entire private router with `router.use(authenticate(authService))`, or apply authentication explicitly to protected endpoints in a mixed public/private router.
- Every new endpoint is protected unless the product flow explicitly requires public access. Public auth endpoints must be visibly registered and rate-limited. Plain Express does not enforce default protection automatically; verify the middleware chain during review.
- Always authenticate before checking roles. Omitting `requireRoles` on a protected endpoint means any authenticated role may access it.
- Use roles from `@brightloop/shared`. Do not maintain a separate role registry in the backend.
- The application is Brightloop Subscription Management. Roles are ADMIN, STAFF, and CUSTOMER. Both apps import the common API contracts from `@brightloop/shared`.
- Authentication delegates to the auth service, which checks the JWT, live user, and issuing session. Reject inactive/deleted/unverified accounts and revoked, expired, missing, or mismatched sessions.
- Resource ownership checks belong in services. UI hiding does not enforce access control.
- Use the existing helpers rather than building a route-registrar or generic authorization framework.

Example inside the users module:

```ts
import { Router, type Router as RouterType } from 'express';
import { Role } from '@brightloop/shared';
import { authenticate, requireRoles } from '../../core/middlewares/auth-barriers.js';
import { validateQuery, validated } from '../../core/middlewares/validate.js';
import { asyncHandler } from '../../core/utils/async-handler.js';
import { respondOk } from '../../core/utils/response.js';
import type { AuthService } from '../auth/auth.service.js';
import type { UsersService } from './users.service.js';
import { listUsersQuerySchema } from './users.schema.js';

interface UsersRouterDeps {
  authService: AuthService;
  usersService: UsersService;
}

export function createUsersRouter({ authService, usersService }: UsersRouterDeps): RouterType {
  const router = Router();
  router.use(authenticate(authService));
  router.get(
    '/',
    requireRoles(Role.ADMIN, Role.STAFF),
    validateQuery(listUsersQuerySchema),
    asyncHandler(async (_req, res) => {
      const query = validated(res, 'query', listUsersQuerySchema);
      const result = await usersService.list(query);
      respondOk(res, 'Users fetched.', result.users, result.meta);
    }),
  );
  return router;
}
```

The app-level API limiter runs before this router; public auth endpoints also use their stricter limiter.

## 4. Async operations and error handling

- Use `async/await`, with no promise chains or unhandled promises. Express handlers and Node event/lifecycle callbacks are allowed where the framework requires them.
- Wrap async HTTP handlers with `asyncHandler`. Middleware must forward errors to the global handler. Do not repeat try/catch in every HTTP handler.
- Use try/catch when transforming a dependency error, cleaning up resources, or implementing an explicit fallback. Never silently swallow errors.
- Use the existing `AppError` payload constructor and factory helpers (`badRequest`, `conflict`, `unauthorized`, `forbidden`, `notFound`, `rateLimited`, `serviceUnavailable`, etc.). Separate error subclasses are not required.
- One global error handler produces the standard envelope. Unknown failures return a generic 500; do not expose stack traces, SQL, secrets, or raw provider responses.
- Map database errors supported by the installed client: unique violations (`23505`/`P2002`) -> 409, missing rows (`P2025`) -> 404, foreign-key violations (`23503`/`P2003`) -> 400/409. Do not assume the classic Prisma error class exists in this contract client.
- Validate with Zod before service calls. Malformed JSON returns 400; oversized bodies return 413.
- Log unhandled rejections/exceptions and shut down gracefully.
- Run independent operations with `Promise.all`; use `Promise.allSettled` when each result must be inspected, such as cleanup. Keep dependent operations sequential.
- Related database writes must be atomic using the installed client's `prisma.transaction(async (tx) => ...)` inside repository methods. Do not use unsupported classic-client `$transaction` syntax.
- Use conditional writes for refresh-token rotation. A read followed by an unconditional update is not sufficient to prevent reuse.

## 5. HTTP status codes

| Case | Code |
|---|---|
| GET/PUT/PATCH success; successful workflow action | 200 |
| POST created a resource | 201 (+ Location when applicable) |
| DELETE success with no body | 204 (or 200 with the response envelope) |
| Malformed request or validation failure | 400 |
| Missing/invalid/expired token or invalid login credentials | 401 |
| Authenticated but lacks access; email verification required | 403 |
| Resource not found | 404 |
| Method not allowed | 405 |
| Duplicate/state conflict | 409 |
| Request body too large | 413 |
| Semantic validation failure, only when explicitly specified | 422 |
| Rate limit exceeded | 429 (+ Retry-After) |
| Unexpected server failure | 500 |
| Database, Redis, or upstream dependency unavailable | 503 |

Never return 200 with an error body. Preserve meaningful 401/403/409 responses instead of hiding them to silence browser console messages. An initial refresh request without a cookie can legitimately return 401.

## 6. Prisma contract client and migrations

- Reuse the single client created in `src/prisma/db.ts` and exposed through `config/prisma.ts`. Do not instantiate a client per request.
- Use the installed Prisma 8 contract API: `orm.public.<Model>`, `whereUnique`, `where`, `first`, `create`, `update`, `updateAll`, `aggregate`, `orderBy`, `limit`, `offset`, and `all` as appropriate.
- Handle nullable query/update results explicitly. Do not cast away nullability.
- Fetch/project only the data needed and map rows to public DTOs. Avoid N+1 queries by batching or using the installed client's supported relation APIs.
- Every list query is bounded with `limit`/`offset` (or a documented cursor strategy). Run the list and count independently with `Promise.all` when a shared snapshot is unnecessary; use a transaction when consistency requires one.
- Case-insensitive search uses supported predicates such as `ilike`. Combine alternative searchable fields with `or` and combine filters with `and`.
- Preserve appropriate uniqueness constraints, indexes, relationships, timestamps, and role constraints in `src/prisma/contract.prisma`.
- Generate `contract.json` and `contract.d.ts` with `bun run contract:emit`; do not hand-edit generated contract artifacts or migration snapshots.
- Migration workflow from `apps/core`: emit contract -> `bun run migration:plan` -> inspect generated operations -> `bun run db:migrate` -> `bun run db:verify`. Use `bun run migration:status` to inspect state.
- Migration packages live in `apps/core/migrations/app`, with contract snapshots in `apps/core/migrations/snapshots`. Do not replace this workflow with classic `schema.prisma`/`prisma migrate dev` commands or use schema push in production.
- Inspect existing database state before planning changes. Preserve data; do not reset a database to fix schema drift.
- Use exact numeric/decimal storage for money; never floating-point values.
- Raw SQL, if necessary, must use the installed client's supported parameter-bound APIs. Never concatenate user input into SQL.

## 7. Redis

- Run local Redis through the root Docker Compose service. `bun run redis:up` starts it; `bun run redis:down` stops it without deleting its volume. The project's default host port is 6380; use `REDIS_URL` for configuration.
- Redis is required at runtime for OTPs, reset grants, rate limiting, and short-lived locks/cache as needed. `MemoryKvStore` is an injected test double, not a silent runtime fallback.
- Persistent device sessions and refresh-token hashes live in PostgreSQL. Do not introduce a second authoritative session store in Redis.
- Use centralized key builders and namespaced keys, for example `app:auth:otp:<purpose>:<email>`.
- Every ephemeral key has a TTL. Serialize structured values as JSON and keep payloads small.
- Use atomic operations/Lua for cooldown reservation, counters with expiry, OTP comparison/attempt counting/consumption, and one-time grant consumption. Do not assume GET followed by DELETE, or separate INCR/EXPIRE calls, is atomic.
- For ordinary cache data, use cache-aside in the service and invalidate on writes. Use SCAN rather than KEYS for production key traversal.
- Authentication and rate limiting fail closed with 503 if Redis is unavailable. Optional response caches can fall back to the database after logging the failure.

## 8. Security, authentication and email

- Use helmet, explicit CORS allowlists, JSON body limits, cookie-parser, and hpp. Reuse the existing Redis-backed `createRateLimiter`; installing express-rate-limit or another adapter is not required.
- Passwords use bcryptjs. New passwords require at least nine characters, uppercase, lowercase, and a special character, with a 72-byte UTF-8 maximum. Confirm-password fields must match. Preserve existing hashes and allow existing passwords at login.
- Issue short-lived JWT access tokens and opaque random refresh tokens. Store only SHA-256 refresh-token hashes in PostgreSQL and rotate tokens with a conditional write. Refresh tokens use persistent httpOnly cookies, Secure in production and SameSite/path settings from the existing configuration.
- Every protected request checks session validity so logout and revocation take effect immediately. Password reset changes the password and revokes all sessions in one transaction; password change may preserve the current device and revoke the others.
- Public signup creates CUSTOMER accounts. ADMIN is seeded from configured environment credentials; existing accounts are not overwritten. Role elevation is never accepted from signup input.
- Generate OTPs with Node crypto, store only HMAC digests, enforce expiry and wrong-attempt limits, and consume valid codes atomically. Keep verification and password-reset purposes separate.
- Password recovery can exchange a reset OTP for a short-lived single-use reset grant. Do not persist raw OTPs, grants, or refresh tokens in logs or database rows.
- Use the existing EmailJS mailer interface and server-side REST integration. Keep service/template IDs and public/private keys in core's environment, not browser code. The OTP template recipient is `{{to_email}}`; other parameters are `name`, `otp`, `expiry_minutes`, and `purpose`.
- Delivery failures must remain retryable. A pending, unverified signup can resend with the original password without replacing its stored credentials. Verified or deleted accounts remain conflicts. Refund failed deliveries' reserved daily allowance and remove their unusable OTP/cooldown.
- Expose only sanitized actionable provider diagnostics in development. Use a generic delivery message in production. Never log raw provider response bodies or secrets.
- Secrets and URLs come from validated environment configuration. Fail fast on missing required values. Never print or commit `.env` values.
- Prevent mass assignment: never pass raw request bodies into database queries. Do not bypass verification or relax authentication to make a failing login succeed.

## 9. Code quality, lifecycle and testing

- TypeScript strict mode; no `any`. Use `unknown` with narrowing and explicit return types on public service/repository methods.
- Use kebab-case files, PascalCase classes, camelCase functions/variables, and uppercase constants. Keep functions focused and avoid unnecessary abstractions or deep nesting.
- Reuse shared roles, DTOs, constants, validation, error, response, and pagination helpers.
- Use Pino with request IDs. Never log passwords, OTPs, tokens, authorization headers, cookies, database URLs with credentials, or email-service keys.
- Comment non-obvious reasons; document public service behavior. Keep code compliant with the repository's lint/typecheck settings. Exclude generated contract/snapshot files from lint rather than modifying their generated contents.
- Graceful shutdown closes the HTTP server, Prisma client, and Redis on SIGTERM/SIGINT, with a bounded timeout. Fatal errors must not leave the server accepting requests indefinitely.
- Keep GET `/health` for liveness and GET `/ready` for actual database + Redis readiness. Existing `/api/health` and `/api/ready` aliases are supported.
- Maintain endpoint, role, request/response, environment, and migration documentation in `docs/`. Add OpenAPI output when the task requires it; a decorator-based Swagger generator is not required.
- Tests use the existing `node:test` runner through tsx (`bun run test`). Unit tests mock repositories/mailers; HTTP integration tests can use an ephemeral Express listener and Node fetch. Supertest is optional, not required.
- Real Redis checks use `bun run test:redis` from `apps/core`. Test expiry, concurrency, cooldowns, attempt limits, replay prevention, and failed delivery recovery when changing auth behavior.
- Do not send real emails or modify unrelated user data as part of automated tests. Inject fake mailers and scope database fixtures/cleanup to the test's own records.
- For documentation-only edits, review the diff and check for stale references; do not start services or run unrelated test suites.

## 10. Output requirements

For a feature, deliver:
1. The complete implementation in the workspace and a file list with full paths.
2. The Zod schemas and public shared DTOs used or changed.
3. Prisma contract changes and a migration note, including whether a migration was generated/applied/verified.
4. The RBAC roles and ownership checks per endpoint as a small table.
5. New environment variables without secret values.
6. Example requests/responses, plus relevant test results and any unverified dependencies.

Do not add libraries or patterns outside this stack without explaining why. Do not omit validation, errors, pagination where applicable, or access control to shorten the implementation. Keep documentation-only tasks scoped to the requested documents.
