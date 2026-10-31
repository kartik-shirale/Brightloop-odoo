# Test harness

Helpers live in `apps/core/src/core/testing/` and are excluded from the production build. Every test file starts with `import '../../core/test-env.js'` (path adjusted) so test secrets are set before the app modules load. Run tests with `bun run test`.

## Helpers

| File | What it gives you |
|---|---|
| `test-auth.ts` | `TEST_USERS` (ADMIN id 1, STAFF id 2, CUSTOMER id 3), `tokenFor(role)` (a real signed access JWT), `bearerFor(role)`, `actorFor(role)` (CUSTOMER carries `TEST_CUSTOMER_ID`), `FakeAuthService` with `deactivate(userId)` and `reactivate(userId)` to simulate a deactivated or revoked account |
| `test-server.ts` | `startTestServer(t, (v1) => v1.use('/taxes', router))` starts an ephemeral Express listener with the real error and 404 handlers and closes it after the test. `server.request(path, { method, body, role, token })` returns `{ status, headers, body }`. Paths are relative to `/api/v1` |
| `rbac-matrix.ts` | `assertRbacMatrix(server, routes)` from a route table: no token gives 401, each disallowed role gives 403, each allowed role gets anything except 401 or 403 (or an exact `expectedAllowedStatus`). Failures are listed together |
| `fakes.ts` | `fakeRepository<T>(overrides)` (unstubbed methods throw), `RecordingAudit`, `FakeSequenceGateway`, `FakeMailer` (`failNext`), `InMemoryTable`, `paginateRows`, `fixedClock` |

### Typical module test

```ts
const auth = new FakeAuthService();
const repository = fakeRepository<TaxesRepository>({ async list() { return []; }, async count() { return 0; } });
const service = new TaxesService(repository, new RecordingAudit());
const server = await startTestServer(t, (v1) => v1.use('/taxes', createTaxesRouter({ authService: auth.asAuthService(), taxesService: service })));
await assertRbacMatrix(server, [
  { method: 'GET', path: '/taxes', allowed: [Role.ADMIN, Role.STAFF] },
  { method: 'POST', path: '/taxes', allowed: [Role.ADMIN], body: {} },
]);
```

Unit tests mock repositories and mailers and never send real email. Database fixtures must be scoped to the test's own records and removed afterwards.

## Real-database checks

- `bun run test:db` runs `*.integration.ts` files under `src/modules/` against `DATABASE_URL` (currently the sequences concurrency checks, which restore the counter row afterwards).
- `bun run test:redis` runs the Redis checks. Run it only after touching auth or Redis behaviour.

## Performance seed

`bun run seed:perf` (from `apps/core`) is for development databases only and refuses to run when `NODE_ENV` is `production`.

| Command | Effect |
|---|---|
| `bun run seed:perf` | Dry run. Prints how many perf rows exist |
| `bun run seed:perf -- --yes` | Creates 5,000 customers, 10,000 subscriptions, 30,000 invoices and about 20,000 payments (plus 3 plans) |
| `bun run seed:perf -- --yes --scale 0.01` | The same shape at 1% for a trial run |
| `bun run seed:perf -- --clean --yes` | Deletes only the rows the script created |
| `bun run seed:perf -- --reset --yes` | Cleans, then seeds again |

Scope and tags: every row is tagged and cleanup deletes by those tags alone: subscription numbers `PERF-SUB-n`, invoice numbers `PERF-INV-n`, payment references `PERF-PAY-n`, customer emails `perf-customer-n@perf.brightloop.test`, plan names starting `PERF `. A second seed is refused while perf rows exist.

Shape of the data: deterministic (fixed random seed). About 70% of subscriptions are ACTIVE, with PAUSED, CLOSED, CONFIRMED, QUOTATION and DRAFT making up the rest. Invoices are roughly 55% PAID, 33% CONFIRMED (some with a partial payment), 5% CANCELLED and 5% DRAFT. Due dates give a spread from not yet due to over 90 days overdue. Totals equal subtotal plus 18% tax, `amountPaid + amountDue = total`, and payment sums equal invoice `amountPaid`. Invoice lines and discounts are not seeded because reports read invoice totals.
