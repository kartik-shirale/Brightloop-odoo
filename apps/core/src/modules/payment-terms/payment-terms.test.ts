import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import { createPaymentTermsRouter } from './payment-terms.routes.js';
import type { PaymentTermRow, PaymentTermsRepository } from './payment-terms.repository.js';
import { PaymentTermsService } from './payment-terms.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

interface Setup {
  table: InMemoryTable<PaymentTermRow>;
  audit: RecordingAudit;
  service: PaymentTermsService;
  failNext: { create?: Error; update?: Error; delete?: Error };
  lastList: { search?: string; isActive?: boolean; isDefault?: boolean }[];
}

function term(name: string, extra: Partial<PaymentTermRow> = {}): Omit<PaymentTermRow, 'id'> {
  return { name, dueDays: 15, isDefault: false, isActive: true, createdAt: NOW, updatedAt: NOW, ...extra };
}

function setup(): Setup {
  const table = new InMemoryTable<PaymentTermRow>();
  const audit = new RecordingAudit();
  const failNext: Setup['failNext'] = {};
  const lastList: Setup['lastList'] = [];
  const clearOthers = (keepId: number): void => {
    for (const row of table.rows) if (row.id !== keepId) row.isDefault = false;
  };
  const repository = fakeRepository<PaymentTermsRepository>({
    async list(query) {
      lastList.push({ search: query.search, isActive: query.isActive, isDefault: query.isDefault });
      return paginateRows(table.rows, query.page, query.limit).data;
    },
    async count() { return table.rows.length; },
    async findById(id) { const row = table.find(id); return row === null ? null : { ...row }; },
    async findDefault() { return table.rows.find((row) => row.isDefault && row.isActive) ?? null; },
    async create(input) {
      if (failNext.create) throw failNext.create;
      const row = table.insert({ ...input, createdAt: NOW, updatedAt: NOW });
      if (input.isDefault) clearOthers(row.id);
      return row;
    },
    async update(id, patch) {
      if (failNext.update) throw failNext.update;
      const row = table.update(id, patch);
      if (row !== null && patch.isDefault === true) clearOthers(id);
      return row;
    },
    async delete(id) {
      if (failNext.delete) throw failNext.delete;
      const row = table.find(id);
      if (row === null) return { kind: 'not-found' };
      if (row.isDefault) return { kind: 'is-default' };
      table.remove(id);
      return { kind: 'deleted', row };
    },
  });
  return { table, audit, service: new PaymentTermsService(repository, audit), failNext, lastList };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/payment-terms', createPaymentTermsRouter({
    authService: auth.asAuthService(), paymentTermsService: s.service,
  })));
}

const net15 = { name: 'Net 15', dueDays: 15 };

test('RBAC matrix: ADMIN and STAFF read, only ADMIN writes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  s.table.insert(term('Net 30', { dueDays: 30 }));
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/payment-terms', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/payment-terms/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/payment-terms', allowed: [Role.ADMIN], body: { name: 'Net 7', dueDays: 7 }, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/payment-terms/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/payment-terms/1', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create returns 201 with Location, applies defaults and audits the change', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: { id: number; isActive: boolean; isDefault: boolean } }>(
    '/payment-terms', { method: 'POST', role: Role.ADMIN, body: net15 });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.isActive, true);
  assert.equal(response.body.data.isDefault, false);
  assert.match(response.headers.get('location') ?? '', /\/payment-terms\/1$/);
  assert.deepEqual(s.audit.actions(), ['payment-term.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);
  assert.equal(s.audit.entries[0]?.entityType, 'PaymentTerm');
});

test('dueDays rules: 0 to 365 integers, strict body, default must be active', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/payment-terms', { method: 'POST', role: Role.ADMIN, body });
  assert.equal((await post({ name: 'Immediate', dueDays: 0 })).status, 201);
  assert.equal((await post({ name: 'Year', dueDays: 365 })).status, 201);
  const tooHigh = await post({ name: 'Long', dueDays: 366 });
  assert.equal(tooHigh.status, 400);
  assert.equal(tooHigh.body.error?.details?.[0]?.field, 'dueDays');
  const inactiveDefault = await post({ name: 'Bad default', dueDays: 5, isDefault: true, isActive: false });
  assert.equal(inactiveDefault.status, 400);
  assert.equal(inactiveDefault.body.error?.details?.[0]?.field, 'isActive');
  for (const body of [
    { name: 'Neg', dueDays: -1 }, { name: 'Float', dueDays: 1.5 }, { name: '', dueDays: 1 },
    { name: 'Extra', dueDays: 1, id: 9 }, { dueDays: 1 }, { name: 'NoDays' }, { name: 'Str', dueDays: '7' },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
});

test('duplicate name on create and update returns 409 DUPLICATE', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.failNext.create = sqlError('23505');
  const created = await srv.request<ApiBody>('/payment-terms', { method: 'POST', role: Role.ADMIN, body: net15 });
  assert.equal(created.status, 409);
  assert.equal(created.body.error?.code, 'DUPLICATE');
  s.failNext.create = undefined;
  await srv.request('/payment-terms', { method: 'POST', role: Role.ADMIN, body: net15 });
  s.failNext.update = sqlError('23505');
  const updated = await srv.request<ApiBody>('/payment-terms/1', { method: 'PATCH', role: Role.ADMIN, body: { name: 'Other' } });
  assert.equal(updated.status, 409);
  assert.equal(updated.body.error?.code, 'DUPLICATE');
  assert.deepEqual(s.audit.actions(), ['payment-term.create']);
});

test('setting a default clears the previous one so there is at most one default', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  await srv.request('/payment-terms', { method: 'POST', role: Role.ADMIN, body: { ...net15, isDefault: true } });
  await srv.request('/payment-terms', { method: 'POST', role: Role.ADMIN, body: { name: 'Net 30', dueDays: 30 } });
  assert.deepEqual(s.table.rows.map((r) => r.isDefault), [true, false]);
  const patched = await srv.request('/payment-terms/2', { method: 'PATCH', role: Role.ADMIN, body: { isDefault: true } });
  assert.equal(patched.status, 200);
  assert.deepEqual(s.table.rows.map((r) => r.isDefault), [false, true]);
  await srv.request('/payment-terms', { method: 'POST', role: Role.ADMIN, body: { name: 'Net 45', dueDays: 45, isDefault: true } });
  assert.equal(s.table.rows.filter((r) => r.isDefault).length, 1);
  assert.equal((await s.service.getDefault())?.name, 'Net 45');
});

test('update: merged default and active rules, empty patch and unknown id', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(term('Default', { isDefault: true }));
  s.table.insert(term('Other'));
  const patch = (id: number, body: unknown) => srv.request<ApiBody>(`/payment-terms/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  const deactivateDefault = await patch(1, { isActive: false });
  assert.equal(deactivateDefault.status, 400);
  assert.equal(deactivateDefault.body.error?.details?.[0]?.field, 'isActive');
  assert.equal((await patch(2, { isDefault: true, isActive: false })).status, 400);
  assert.equal((await patch(1, { isDefault: false, isActive: false })).status, 200);
  assert.equal((await patch(2, {})).status, 400);
  assert.equal((await patch(2, { dueDays: 400 })).status, 400);
  assert.equal((await patch(99, { dueDays: 3 })).status, 404);
  assert.equal((await patch(2, { dueDays: 30 })).status, 200);
  const entry = s.audit.entries.find((e) => e.action === 'payment-term.update' && e.entityId === 2);
  assert.deepEqual(entry?.metadata, { changes: { dueDays: 30 }, previous: { dueDays: 15 } });
});

test('delete: 200 and audited, 404 when missing, 409 IN_USE when referenced or when it is the default', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(term('Default', { isDefault: true }));
  s.table.insert(term('Referenced'));
  s.table.insert(term('Free'));
  const del = (id: number) => srv.request<ApiBody>(`/payment-terms/${id}`, { method: 'DELETE', role: Role.ADMIN });
  const defaultBlocked = await del(1);
  assert.equal(defaultBlocked.status, 409);
  assert.equal(defaultBlocked.body.error?.code, 'IN_USE');
  s.failNext.delete = sqlError('23503');
  const referenced = await del(2);
  assert.equal(referenced.status, 409);
  assert.equal(referenced.body.error?.code, 'IN_USE');
  assert.equal(s.table.rows.length, 3);
  s.failNext.delete = undefined;
  assert.equal((await del(3)).status, 200);
  assert.equal((await del(3)).status, 404);
  assert.deepEqual(s.audit.actions(), ['payment-term.delete']);
});

test('list: bounded, strict query, boolean filters, search and page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) s.table.insert(term(`T${i}`, { dueDays: i }));
  const get = (query: string) => srv.request<ApiBody & { data: unknown[] }>(`/payment-terms${query}`, { role: Role.STAFF });
  for (const bad of ['?limit=101', '?limit=0', '?page=0', '?sortBy=id', '?sortBy=isDefault', '?sortOrder=up', '?isActive=yes', '?isDefault=1', '?bogus=1', '?search=']) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?isActive=true&isDefault=false&search=net&sortBy=dueDays&sortOrder=asc&limit=2');
  assert.equal(ok.status, 200);
  assert.deepEqual(s.lastList.at(-1), { search: 'net', isActive: true, isDefault: false });
  assert.equal(ok.body.data.length, 2);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
  assert.equal((await get('/abc')).status, 400);
});

test('service enforces roles itself and the gateway returns records and the active default', async () => {
  const s = setup();
  const first = s.table.insert(term('Net 30', { dueDays: 30, isDefault: true }));
  await assert.rejects(s.service.list(actorFor(Role.CUSTOMER), { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' }), { status: 403 });
  await assert.rejects(s.service.create(actorFor(Role.STAFF), { name: 'X', dueDays: 1, isDefault: false, isActive: true }), { status: 403 });
  await assert.rejects(s.service.remove(actorFor(Role.STAFF), first.id), { status: 403 });
  assert.deepEqual(await s.service.getById(first.id), { id: 1, name: 'Net 30', dueDays: 30, isDefault: true, isActive: true });
  assert.equal(await s.service.getById(77), null);
  assert.equal((await s.service.getDefault())?.id, 1);
  s.table.update(1, { isActive: false });
  assert.equal(await s.service.getDefault(), null);
});
