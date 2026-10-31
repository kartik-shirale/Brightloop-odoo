import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import { createTaxesRouter } from './taxes.routes.js';
import type { TaxRow, TaxesRepository } from './taxes.repository.js';
import { TaxesService } from './taxes.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

interface Setup {
  table: InMemoryTable<TaxRow>;
  audit: RecordingAudit;
  service: TaxesService;
  failNext: { create?: Error; update?: Error; delete?: Error };
  lastList: { search?: string; type?: string[]; isActive?: boolean }[];
}

function setup(): Setup {
  const table = new InMemoryTable<TaxRow>();
  const audit = new RecordingAudit();
  const failNext: Setup['failNext'] = {};
  const lastList: Setup['lastList'] = [];
  const repository = fakeRepository<TaxesRepository>({
    async list(query) {
      lastList.push({ search: query.search, type: query.type, isActive: query.isActive });
      return paginateRows(table.rows, query.page, query.limit).data;
    },
    async count() { return table.rows.length; },
    async findById(id) { const row = table.find(id); return row === null ? null : { ...row }; },
    async findByIds(ids) { return table.rows.filter((row) => ids.includes(row.id)); },
    async create(input) {
      if (failNext.create) throw failNext.create;
      return table.insert({ ...input, createdAt: NOW, updatedAt: NOW });
    },
    async update(id, patch) {
      if (failNext.update) throw failNext.update;
      return table.update(id, patch);
    },
    async delete(id) {
      if (failNext.delete) throw failNext.delete;
      const row = table.find(id);
      return row !== null && table.remove(id) ? row : null;
    },
  });
  return { table, audit, service: new TaxesService(repository, audit), failNext, lastList };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/taxes', createTaxesRouter({
    authService: auth.asAuthService(), taxesService: s.service,
  })));
}

const gst = { name: 'GST 18%', type: 'PERCENTAGE', rate: 1800 };

test('RBAC matrix: ADMIN and STAFF read, only ADMIN writes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  s.table.insert({ name: 'GST', type: 'PERCENTAGE', rate: 1800, isActive: true, createdAt: NOW, updatedAt: NOW });
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/taxes', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/taxes/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/taxes', allowed: [Role.ADMIN], body: { name: 'VAT', type: 'FIXED', rate: 500 }, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/taxes/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/taxes/1', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create returns 201 with Location, applies defaults and audits the change', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: { id: number; isActive: boolean } }>('/taxes', { method: 'POST', role: Role.ADMIN, body: gst });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.isActive, true);
  assert.match(response.headers.get('location') ?? '', /\/taxes\/1$/);
  assert.deepEqual(s.audit.actions(), ['tax.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);
});

test('rate rules: percentage limited to 10000 bps, fixed only needs 0 or more, integers only', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/taxes', { method: 'POST', role: Role.ADMIN, body });
  assert.equal((await post({ name: 'Max', type: 'PERCENTAGE', rate: 10000 })).status, 201);
  assert.equal((await post({ name: 'Zero', type: 'PERCENTAGE', rate: 0 })).status, 201);
  assert.equal((await post({ name: 'Fixed', type: 'FIXED', rate: 250000 })).status, 201);
  const tooHigh = await post({ name: 'High', type: 'PERCENTAGE', rate: 10001 });
  assert.equal(tooHigh.status, 400);
  assert.equal(tooHigh.body.error?.details?.[0]?.field, 'rate');
  for (const body of [
    { name: 'Neg', type: 'FIXED', rate: -1 }, { name: 'Float', type: 'PERCENTAGE', rate: 18.5 },
    { name: '', type: 'FIXED', rate: 1 }, { name: 'Bad', type: 'OTHER', rate: 1 },
    { name: 'Extra', type: 'FIXED', rate: 1, id: 9 }, { type: 'FIXED', rate: 1 },
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
  const created = await srv.request<ApiBody>('/taxes', { method: 'POST', role: Role.ADMIN, body: gst });
  assert.equal(created.status, 409);
  assert.equal(created.body.error?.code, 'DUPLICATE');
  s.failNext.create = undefined;
  await srv.request('/taxes', { method: 'POST', role: Role.ADMIN, body: gst });
  s.failNext.update = sqlError('23505');
  const updated = await srv.request<ApiBody>('/taxes/1', { method: 'PATCH', role: Role.ADMIN, body: { name: 'Other' } });
  assert.equal(updated.status, 409);
  assert.equal(updated.body.error?.code, 'DUPLICATE');
  assert.deepEqual(s.audit.actions(), ['tax.create']);
});

test('update validates the merged type and rate, rejects empty patches and unknown ids', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert({ name: 'Flat', type: 'FIXED', rate: 50000, isActive: true, createdAt: NOW, updatedAt: NOW });
  const patch = (id: number, body: unknown) => srv.request<ApiBody & { data: { type: string; rate: number } }>(`/taxes/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  assert.equal((await patch(1, { type: 'PERCENTAGE' })).status, 400);
  assert.equal((await patch(1, { type: 'PERCENTAGE', rate: 1800 })).status, 200);
  assert.equal((await patch(1, { rate: 10001 })).status, 400);
  assert.equal((await patch(1, {})).status, 400);
  assert.equal((await patch(99, { isActive: false })).status, 404);
  const entry = s.audit.entries.find((e) => e.action === 'tax.update');
  assert.deepEqual(entry?.metadata, { changes: { type: 'PERCENTAGE', rate: 1800 }, previous: { type: 'FIXED', rate: 50000 } });
});

test('delete: 200 and audited, 404 when missing, 409 IN_USE when a line references the tax', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert({ name: 'A', type: 'FIXED', rate: 1, isActive: true, createdAt: NOW, updatedAt: NOW });
  s.table.insert({ name: 'B', type: 'FIXED', rate: 1, isActive: true, createdAt: NOW, updatedAt: NOW });
  s.failNext.delete = sqlError('23503');
  const blocked = await srv.request<ApiBody>('/taxes/1', { method: 'DELETE', role: Role.ADMIN });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error?.code, 'IN_USE');
  assert.equal(s.table.rows.length, 2);
  s.failNext.delete = undefined;
  assert.equal((await srv.request('/taxes/2', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await srv.request('/taxes/2', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.deepEqual(s.audit.actions(), ['tax.delete']);
});

test('list: bounded, strict query, comma type filter, boolean filter, search and page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) s.table.insert({ name: `T${i}`, type: 'FIXED', rate: i, isActive: true, createdAt: NOW, updatedAt: NOW });
  const get = (query: string) => srv.request<ApiBody & { data: unknown[] }>(`/taxes${query}`, { role: Role.STAFF });
  for (const bad of ['?limit=101', '?limit=0', '?page=0', '?sortBy=id', '?sortOrder=up', '?type=NOPE', '?isActive=yes', '?bogus=1', '?search=']) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?type=PERCENTAGE,FIXED&isActive=false&search=gst&sortBy=rate&sortOrder=asc&limit=2');
  assert.equal(ok.status, 200);
  assert.deepEqual(s.lastList.at(-1), { search: 'gst', type: ['PERCENTAGE', 'FIXED'], isActive: false });
  assert.equal(ok.body.data.length, 2);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
});

test('service enforces roles itself and the gateway returns existing taxes once per id', async () => {
  const s = setup();
  const first = s.table.insert({ name: 'A', type: 'FIXED', rate: 1, isActive: true, createdAt: NOW, updatedAt: NOW });
  await assert.rejects(s.service.list(actorFor(Role.CUSTOMER), { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' }), { status: 403 });
  await assert.rejects(s.service.create(actorFor(Role.STAFF), { name: 'X', type: 'FIXED', rate: 1, isActive: true }), { status: 403 });
  assert.deepEqual(await s.service.getByIds([first.id, first.id, 77]), [
    { id: first.id, name: 'A', type: 'FIXED', rate: 1, isActive: true },
  ]);
});
