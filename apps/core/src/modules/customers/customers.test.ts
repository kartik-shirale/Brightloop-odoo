import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import { createCustomersRouter } from './customers.routes.js';
import type {
  CustomerRow, CustomerSummaryRow, CustomersRepository, DeleteBlockers, PortalUserRow,
} from './customers.repository.js';
import { CustomersService } from './customers.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

type NewRow = Omit<CustomerRow, 'id'>;
const blank = (over: Partial<NewRow> = {}): NewRow => ({
  userId: null, name: 'Acme', companyName: null, email: 'acme@example.com', phone: null, taxId: null,
  addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null,
  notes: null, deletedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
});

interface Setup {
  table: InMemoryTable<CustomerRow>;
  users: PortalUserRow[];
  audit: RecordingAudit;
  service: CustomersService;
  blockers: DeleteBlockers;
  failNext: { create?: Error; createForUser?: Error };
  calls: { list: number; summaries: number[][]; linkByEmail: number; createForUser: number };
  lastList: { search?: string; include?: string[]; hasOutstanding?: boolean; hasPortalAccount?: boolean; city?: string }[];
  summaryRows: Map<number, CustomerSummaryRow>;
  linkable: { value: CustomerRow | null };
  raceWinner: { value: CustomerRow | null };
}

function setup(): Setup {
  const table = new InMemoryTable<CustomerRow>();
  const users: PortalUserRow[] = [];
  const audit = new RecordingAudit();
  const failNext: Setup['failNext'] = {};
  const calls: Setup['calls'] = { list: 0, summaries: [], linkByEmail: 0, createForUser: 0 };
  const lastList: Setup['lastList'] = [];
  const summaryRows = new Map<number, CustomerSummaryRow>();
  const blockers: DeleteBlockers = { subscriptions: 0, invoices: 0 };
  const linkable: Setup['linkable'] = { value: null };
  const raceWinner: Setup['raceWinner'] = { value: null };
  const live = () => table.rows.filter((row) => row.deletedAt === null);

  const repository = fakeRepository<CustomersRepository>({
    async list(query) {
      calls.list += 1;
      lastList.push({
        search: query.search, include: query.include, hasOutstanding: query.hasOutstanding,
        hasPortalAccount: query.hasPortalAccount, city: query.city,
      });
      return paginateRows(live(), query.page, query.limit).data;
    },
    async count() { return live().length; },
    async findById(id) { const row = table.find(id); return row === null || row.deletedAt !== null ? null : { ...row }; },
    async findByUserId(userId) {
      if (raceWinner.value !== null && calls.createForUser > 0) return raceWinner.value;
      return table.rows.find((row) => row.userId === userId) ?? null;
    },
    async findUserById(id) { return users.find((user) => user.id === id) ?? null; },
    async summaries(ids) {
      calls.summaries.push([...ids]);
      return new Map(ids.map((id) => [id, summaryRows.get(id) ?? { activeSubscriptions: 0, outstandingAmount: 0, overdueCount: 0 }]));
    },
    async create(input) {
      if (failNext.create) throw failNext.create;
      return table.insert(blank({
        name: input.name, email: input.email, companyName: input.companyName ?? null,
        phone: input.phone ?? null, city: input.city ?? null,
      }));
    },
    async createForUser(user) {
      calls.createForUser += 1;
      if (failNext.createForUser) throw failNext.createForUser;
      return table.insert(blank({ userId: user.id, name: user.name, email: user.email }));
    },
    async linkByEmail(userId) {
      calls.linkByEmail += 1;
      const target = linkable.value;
      if (target === null) return null;
      table.update(target.id, { userId });
      return table.find(target.id);
    },
    async update(id, patch) { return live().some((row) => row.id === id) ? table.update(id, patch) : null; },
    async deleteBlockers() { return { ...blockers }; },
    async softDelete(id) { return table.update(id, { deletedAt: NOW }); },
  });
  return {
    table, users, audit, blockers, failNext, calls, lastList, summaryRows, linkable, raceWinner,
    service: new CustomersService(repository, audit, () => new Date(NOW)),
  };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/customers', createCustomersRouter({
    authService: auth.asAuthService(), customersService: s.service,
  })));
}

test('RBAC matrix: ADMIN and STAFF manage customers, only ADMIN deletes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  s.table.insert(blank());
  s.table.insert(blank({ email: 'b@example.com' }));
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/customers', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/customers/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/customers', allowed: [Role.ADMIN, Role.STAFF], body: { name: 'N', email: 'n@example.com' }, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/customers/1', allowed: [Role.ADMIN, Role.STAFF], body: { phone: '123' }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/customers/2', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create returns 201 with Location and summary, lowercases the email and audits', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: { id: number; email: string; summary: unknown } }>('/customers', {
    method: 'POST', role: Role.STAFF, body: { name: '  Acme  ', email: ' Billing@Acme.COM ', companyName: 'Acme Ltd' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.email, 'billing@acme.com');
  assert.deepEqual(response.body.data.summary, { activeSubscriptions: 0, outstandingAmount: 0, overdueCount: 0 });
  assert.match(response.headers.get('location') ?? '', /\/customers\/1$/);
  assert.deepEqual(s.audit.actions(), ['customer.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);
  assert.equal(s.audit.entries[0]?.actor?.role, Role.STAFF);
});

test('create validation: userId and unknown keys rejected, email and name required, nulls allowed', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/customers', { method: 'POST', role: Role.ADMIN, body });
  for (const body of [
    { name: 'A', email: 'a@b.co', userId: 5 }, { name: 'A', email: 'a@b.co', extra: 1 },
    { name: 'A', email: 'not-an-email' }, { name: '', email: 'a@b.co' }, { email: 'a@b.co' }, { name: 'A' },
    { name: 'A', email: 'a@b.co', phone: 12345 }, { name: 'A', email: 'a@b.co', companyName: '' },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  assert.equal((await post({ name: 'A', email: 'a@b.co', phone: null, city: 'Pune' })).status, 201);
  assert.equal(s.audit.entries.length, 1);
});

test('unique violation on create is 409 DUPLICATE and writes no audit entry', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.failNext.create = sqlError('23505');
  const response = await srv.request<ApiBody>('/customers', { method: 'POST', role: Role.ADMIN, body: { name: 'A', email: 'a@b.co' } });
  assert.equal(response.status, 409);
  assert.equal(response.body.error?.code, 'DUPLICATE');
  assert.equal(s.audit.entries.length, 0);
});

test('update: partial patch, null clears a field, previous values audited, 404 and empty patch', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(blank({ phone: '111', city: 'Pune' }));
  const patch = (id: number, body: unknown) => srv.request<ApiBody & { data: { phone: string | null; name: string } }>(`/customers/${id}`, { method: 'PATCH', role: Role.STAFF, body });
  const ok = await patch(1, { phone: null, name: 'Acme 2' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.phone, null);
  assert.equal(ok.body.data.name, 'Acme 2');
  assert.deepEqual(s.audit.entries[0]?.metadata, {
    changes: { phone: null, name: 'Acme 2' }, previous: { phone: '111', name: 'Acme' },
  });
  assert.equal((await patch(1, {})).status, 400);
  assert.equal((await patch(1, { userId: 3 })).status, 400);
  assert.equal((await patch(1, { email: 'bad' })).status, 400);
  assert.equal((await patch(99, { name: 'X' })).status, 404);
  assert.deepEqual(s.audit.actions(), ['customer.update']);
});

test('delete: 409 IN_USE for active/paused subscriptions or unpaid invoices, 404, soft delete audited', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(blank());
  s.blockers.subscriptions = 1;
  const subs = await srv.request<ApiBody>('/customers/1', { method: 'DELETE', role: Role.ADMIN });
  assert.equal(subs.status, 409);
  assert.equal(subs.body.error?.code, 'IN_USE');
  s.blockers.subscriptions = 0;
  s.blockers.invoices = 2;
  assert.equal((await srv.request<ApiBody>('/customers/1', { method: 'DELETE', role: Role.ADMIN })).body.error?.code, 'IN_USE');
  assert.equal(s.table.find(1)?.deletedAt, null);
  assert.equal(s.audit.entries.length, 0);

  s.blockers.invoices = 0;
  assert.equal((await srv.request('/customers/1', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal(s.table.find(1)?.deletedAt, NOW);
  assert.deepEqual(s.audit.actions(), ['customer.delete']);
  assert.equal((await srv.request('/customers/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/customers/1')).status, 401);
  assert.equal((await srv.request('/customers/1', { role: Role.STAFF })).status, 404);
});

test('list: bounded, strict query, filters and search reach the repository, page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) s.table.insert(blank({ email: `c${i}@example.com` }));
  const get = (query: string) => srv.request<ApiBody & { data: { summary?: unknown }[] }>(`/customers${query}`, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?limit=0', '?page=0', '?sortBy=email', '?sortOrder=up', '?bogus=1', '?search=',
    '?hasOutstanding=yes', '?hasPortalAccount=1', '?include=lines', '?createdFrom=yesterday', '?userId=1',
  ]) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  assert.equal(s.calls.list, 0);
  const ok = await get('?search=acme&hasOutstanding=true&hasPortalAccount=false&city=Pune&sortBy=companyName&sortOrder=asc&limit=2&createdFrom=2026-01-01&createdTo=2026-12-31');
  assert.equal(ok.status, 200);
  assert.deepEqual(s.lastList.at(-1), { search: 'acme', include: undefined, hasOutstanding: true, hasPortalAccount: false, city: 'Pune' });
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
  assert.equal(past.body.meta?.total, 3);
});

test('summary: computed once per page for all ids, never per row, only when included', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 5; i += 1) s.table.insert(blank({ email: `c${i}@example.com` }));
  s.summaryRows.set(2, { activeSubscriptions: 3, outstandingAmount: 125000, overdueCount: 1 });
  const get = (query: string) => srv.request<ApiBody & { data: { id: number; summary?: { activeSubscriptions: number; outstandingAmount: number; overdueCount: number } }[] }>(`/customers${query}`, { role: Role.ADMIN });

  const plain = await get('');
  assert.equal(plain.body.data.every((row) => row.summary === undefined), true);
  assert.equal(s.calls.summaries.length, 0);

  const withSummary = await get('?include=summary&limit=5');
  assert.equal(s.calls.summaries.length, 1);
  assert.deepEqual(s.calls.summaries[0], [1, 2, 3, 4, 5]);
  assert.deepEqual(withSummary.body.data[1]?.summary, { activeSubscriptions: 3, outstandingAmount: 125000, overdueCount: 1 });
  assert.deepEqual(withSummary.body.data[0]?.summary, { activeSubscriptions: 0, outstandingAmount: 0, overdueCount: 0 });

  const detail = await srv.request<ApiBody & { data: { summary: { outstandingAmount: number } } }>('/customers/2', { role: Role.STAFF });
  assert.equal(detail.body.data.summary.outstandingAmount, 125000);
  assert.equal(s.calls.summaries.length, 2);
  assert.deepEqual(s.calls.summaries[1], [2]);
});

test('service enforces roles itself', async () => {
  const s = setup();
  s.table.insert(blank());
  const query = { page: 1, limit: 10, sortBy: 'name' as const, sortOrder: 'asc' as const };
  await assert.rejects(s.service.list(actorFor(Role.CUSTOMER), query), { status: 403 });
  await assert.rejects(s.service.get(actorFor(Role.CUSTOMER), 1), { status: 403 });
  await assert.rejects(s.service.create(actorFor(Role.CUSTOMER), { name: 'X', email: 'x@y.co' }), { status: 403 });
  await assert.rejects(s.service.update(actorFor(Role.CUSTOMER), 1, { name: 'X' }), { status: 403 });
  await assert.rejects(s.service.remove(actorFor(Role.STAFF), 1), { status: 403 });
  assert.equal(s.audit.entries.length, 0);
});

test('getOrCreateForUser creates a customer from the user name and email and is idempotent', async () => {
  const s = setup();
  s.users.push({ id: 7, name: 'Riya Shah', email: 'riya@example.com', role: Role.CUSTOMER });
  const first = await s.service.getOrCreateForUser(7);
  assert.equal(first.userId, 7);
  assert.equal(first.name, 'Riya Shah');
  assert.equal(first.email, 'riya@example.com');
  assert.deepEqual(s.audit.actions(), ['customer.create']);
  assert.deepEqual(s.audit.entries[0]?.actor, { userId: 7, role: Role.CUSTOMER });
  const second = await s.service.getOrCreateForUser(7);
  assert.equal(second.id, first.id);
  assert.equal(s.table.rows.length, 1);
  assert.equal(s.audit.entries.length, 1);
  assert.equal(s.calls.createForUser, 1);
});

test('getOrCreateForUser links an existing unlinked customer with the same email instead of creating one', async () => {
  const s = setup();
  const staffMade = s.table.insert(blank({ name: 'Created by staff', email: 'Riya@Example.com' }));
  s.users.push({ id: 7, name: 'Riya', email: 'riya@example.com', role: Role.CUSTOMER });
  s.linkable.value = staffMade;
  const record = await s.service.getOrCreateForUser(7);
  assert.equal(record.id, staffMade.id);
  assert.equal(record.userId, 7);
  assert.equal(record.name, 'Created by staff');
  assert.equal(s.table.rows.length, 1);
  assert.equal(s.calls.createForUser, 0);
  assert.deepEqual(s.audit.actions(), ['customer.link']);
});

test('getOrCreateForUser is race-safe: a unique violation re-reads the winner without a second customer or audit', async () => {
  const s = setup();
  s.users.push({ id: 7, name: 'Riya', email: 'riya@example.com', role: Role.CUSTOMER });
  const winner = s.table.insert(blank({ userId: 7, name: 'Winner' }));
  s.raceWinner.value = winner;
  s.failNext.createForUser = sqlError('23505');
  // The first findByUserId runs before the winner exists in the fake: hide it until createForUser was attempted.
  const hidden = s.table.rows.splice(0, 1);
  const record = await s.service.getOrCreateForUser(7);
  assert.equal(hidden.length, 1);
  assert.equal(record.id, winner.id);
  assert.equal(s.audit.entries.length, 0);
});

test('getOrCreateForUser: a unique violation with no winner becomes 409, other errors pass through, bad users are refused', async () => {
  const s = setup();
  s.users.push({ id: 7, name: 'Riya', email: 'riya@example.com', role: Role.CUSTOMER });
  s.users.push({ id: 8, name: 'Staffer', email: 'staff@example.com', role: Role.STAFF });
  s.failNext.createForUser = sqlError('23505');
  await assert.rejects(s.service.getOrCreateForUser(7), { status: 409, code: 'DUPLICATE' });
  s.failNext.createForUser = new Error('boom');
  await assert.rejects(s.service.getOrCreateForUser(7), { message: 'boom' });
  await assert.rejects(s.service.getOrCreateForUser(99), { status: 404 });
  await assert.rejects(s.service.getOrCreateForUser(8), { status: 403 });
  s.table.insert(blank({ userId: 9, deletedAt: NOW }));
  await assert.rejects(s.service.getOrCreateForUser(9), { status: 403 });
});

test('gateway: getById ignores soft-deleted customers, snapshot formats one billing address string', async () => {
  const s = setup();
  s.table.insert(blank({
    name: 'Acme', email: 'a@acme.com', taxId: '27ABCDE1234F1Z5', addressLine1: '1 MG Road', addressLine2: '  ',
    city: 'Pune', state: 'MH', postalCode: '411001', country: 'India',
  }));
  s.table.insert(blank({ deletedAt: NOW }));
  s.table.insert(blank({ name: 'No address' }));
  assert.equal((await s.service.getById(1))?.name, 'Acme');
  assert.equal(await s.service.getById(2), null);
  assert.equal(await s.service.getById(99), null);
  assert.deepEqual(await s.service.snapshot(1), {
    name: 'Acme', email: 'a@acme.com', taxId: '27ABCDE1234F1Z5', billingAddress: '1 MG Road, Pune, MH, 411001, India',
  });
  assert.equal((await s.service.snapshot(3)).billingAddress, null);
  await assert.rejects(s.service.snapshot(2), { status: 404 });
});
