import '../test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { Router } from 'express';
import { authenticate, requireRoles } from '../middlewares/auth-barriers.js';
import { asyncHandler } from '../utils/async-handler.js';
import { respondOk } from '../utils/response.js';
import { FakeMailer, FakeSequenceGateway, InMemoryTable, RecordingAudit, fakeRepository, fixedClock, paginateRows } from './fakes.js';
import { assertRbacMatrix, type RouteSpec } from './rbac-matrix.js';
import { ALL_ROLES, FakeAuthService, TEST_CUSTOMER_ID, TEST_USERS, actorFor, tokenFor } from './test-auth.js';
import { startTestServer, type ApiBody } from './test-server.js';

function sampleRouter(auth: FakeAuthService): Router {
  const router = Router();
  router.use(authenticate(auth.asAuthService()));
  router.get('/things', requireRoles(Role.ADMIN, Role.STAFF), asyncHandler(async (_req, res) => {
    respondOk(res, 'Things fetched.', []);
  }));
  router.post('/things', requireRoles(Role.ADMIN), asyncHandler(async (_req, res) => {
    respondOk(res, 'Thing created.', {});
  }));
  return router;
}

const routes: RouteSpec[] = [
  { method: 'GET', path: '/things', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
  { method: 'POST', path: '/things', allowed: [Role.ADMIN], body: {} },
];

test('tokens identify each role and actors carry the customer id for CUSTOMER only', async () => {
  const auth = new FakeAuthService();
  for (const role of ALL_ROLES) {
    assert.deepEqual(await auth.authenticate(tokenFor(role)), TEST_USERS[role]);
  }
  assert.deepEqual(actorFor(Role.CUSTOMER), { userId: 3, role: 'CUSTOMER', customerId: TEST_CUSTOMER_ID });
  assert.equal(actorFor(Role.STAFF).customerId, undefined);
  await assert.rejects(auth.authenticate('not-a-token'), { status: 401 });
});

test('test server, 401/403 behaviour and deactivated users', async (t) => {
  const auth = new FakeAuthService();
  const server = await startTestServer(t, (v1) => v1.use('/', sampleRouter(auth)));
  assert.equal((await server.request('/things')).status, 401);
  assert.equal((await server.request('/things', { token: 'garbage' })).status, 401);
  assert.equal((await server.request('/things', { role: Role.CUSTOMER })).status, 403);
  const ok = await server.request<ApiBody>('/things', { role: Role.STAFF });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.success, true);
  assert.equal((await server.request('/nope', { role: Role.ADMIN })).status, 404);

  auth.deactivate(TEST_USERS.STAFF.id);
  assert.equal((await server.request('/things', { role: Role.STAFF })).status, 401);
  auth.reactivate(TEST_USERS.STAFF.id);
  assert.equal((await server.request('/things', { role: Role.STAFF })).status, 200);
});

test('RBAC matrix passes for a correct table and reports a wrong one', async (t) => {
  const server = await startTestServer(t, (v1) => v1.use('/', sampleRouter(new FakeAuthService())));
  await assertRbacMatrix(server, routes);
  await assert.rejects(
    assertRbacMatrix(server, [{ method: 'GET', path: '/things', allowed: [Role.ADMIN, Role.STAFF, Role.CUSTOMER] }]),
    /CUSTOMER should be allowed, got 403/,
  );
});

test('fakeRepository throws on any method that was not stubbed', async () => {
  const repository = fakeRepository<{ find(id: number): Promise<string>; remove(id: number): Promise<void> }>({
    async find(id) { return `row-${id}`; },
  });
  assert.equal(await repository.find(7), 'row-7');
  assert.throws(() => repository.remove(1), /Unexpected call to "remove"/);
});

test('fakes: audit, sequences, mailer, table, pagination and clock', async () => {
  const audit = new RecordingAudit();
  await audit.record({ actor: null, action: 'x.y', entityType: 'X' });
  assert.deepEqual(audit.actions(), ['x.y']);

  const sequences = new FakeSequenceGateway(2026);
  assert.equal(await sequences.next('INVOICE'), 'INV-2026-000001');
  assert.equal(await sequences.next('INVOICE'), 'INV-2026-000002');
  assert.equal(await sequences.next('SUBSCRIPTION'), 'SUB-2026-000001');

  const mailer = new FakeMailer();
  mailer.failNext();
  await assert.rejects(mailer.send({ to: 'a@x.test', kind: 'invoice', params: {} }), /mail delivery failed/);
  await mailer.send({ to: 'a@x.test', kind: 'invoice', params: {} });
  assert.equal(mailer.sent.length, 1);

  const table = new InMemoryTable<{ id: number; name: string }>();
  const row = table.insert({ name: 'a' });
  table.insert({ name: 'b' });
  assert.equal(table.update(row.id, { name: 'c' })?.name, 'c');
  assert.equal(table.remove(2), true);
  assert.equal(table.find(2), null);

  const page = paginateRows([1, 2, 3, 4, 5], 3, 2);
  assert.deepEqual(page.data, [5]);
  assert.deepEqual(page.meta, { page: 3, limit: 2, total: 5, totalPages: 3, hasNext: false, hasPrev: true });

  const clock = fixedClock('2026-01-31T00:00:00Z');
  clock.advanceDays(1);
  assert.equal(clock.now().toISOString(), '2026-02-01T00:00:00.000Z');
});
