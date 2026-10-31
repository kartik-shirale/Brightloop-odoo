import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import { createPlansRouter } from './plans.routes.js';
import type { PlanRow, PlansRepository } from './plans.repository.js';
import type { ListPlansParams } from './plans.schema.js';
import { PlansService } from './plans.service.js';

const NOW = '2026-10-31T00:00:00.000Z';

interface Setup {
  table: InMemoryTable<PlanRow>;
  audit: RecordingAudit;
  service: PlansService;
  subs: { active: number; open: number };
  lastList: ListPlansParams[];
}

function planData(over: Partial<PlanRow> = {}): Omit<PlanRow, 'id'> {
  return {
    name: 'Basic', description: null, price: 49900, billingPeriod: 'MONTHLY', minQuantity: 1,
    availableFrom: '2026-01-01T00:00:00.000Z', availableTo: null, autoClose: false, closable: false,
    pausable: false, renewable: false, isActive: true, createdById: 1, createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

function setup(): Setup {
  const table = new InMemoryTable<PlanRow>();
  const audit = new RecordingAudit();
  const subs = { active: 0, open: 0 };
  const lastList: ListPlansParams[] = [];
  const repository = fakeRepository<PlansRepository>({
    async list(query) { lastList.push(query); return paginateRows(table.rows, query.page, query.limit).data; },
    async count() { return table.rows.length; },
    async findById(id) { const row = table.find(id); return row === null ? null : { ...row }; },
    async countActiveSubscriptions() { return subs.active; },
    async countOpenSubscriptions() { return subs.open; },
    async create(input, createdById) {
      return table.insert(planData({
        name: input.name, description: input.description ?? null, price: input.price,
        billingPeriod: input.billingPeriod, minQuantity: input.minQuantity,
        availableFrom: input.availableFrom.toISOString(), availableTo: input.availableTo?.toISOString() ?? null,
        autoClose: input.autoClose, closable: input.closable, pausable: input.pausable,
        renewable: input.renewable, isActive: input.isActive, createdById,
      }));
    },
    async update(id, patch) {
      const { availableFrom, availableTo, ...rest } = patch;
      return table.update(id, {
        ...rest,
        ...(availableFrom !== undefined ? { availableFrom: availableFrom.toISOString() } : {}),
        ...(availableTo !== undefined ? { availableTo: availableTo === null ? null : availableTo.toISOString() } : {}),
      });
    },
    async softDelete(id) {
      const row = table.find(id);
      return row !== null && table.remove(id) ? row : null;
    },
  });
  return { table, audit, service: new PlansService(repository, audit), subs, lastList };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/plans', createPlansRouter({
    authService: auth.asAuthService(), plansService: s.service,
  })));
}

const basic = { name: 'Pro', price: 99900, billingPeriod: 'YEARLY', availableFrom: '2026-11-01' };

test('RBAC matrix: ADMIN and STAFF read, only ADMIN writes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  s.table.insert(planData());
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/plans', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/plans/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/plans', allowed: [Role.ADMIN], body: basic, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/plans/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/plans/1', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create returns 201 with Location, defaults, UTC-midnight dates, createdById and an audit entry', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: PlanRow & { activeSubscriptionCount: number } }>('/plans', {
    method: 'POST', role: Role.ADMIN, body: { ...basic, availableTo: '2027-01-31T15:30:00Z' },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/plans\/1$/);
  const plan = response.body.data;
  assert.equal(plan.minQuantity, 1);
  assert.equal(plan.isActive, true);
  assert.equal(plan.closable, false);
  assert.equal(plan.availableFrom, '2026-11-01T00:00:00.000Z');
  assert.equal(plan.availableTo, '2027-01-31T00:00:00.000Z');
  assert.equal(plan.activeSubscriptionCount, 0);
  assert.equal(s.table.rows[0]?.createdById, actorFor(Role.ADMIN).userId);
  assert.deepEqual(s.audit.actions(), ['plan.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);
});

test('validation: price >= 0 integer, minQuantity >= 1, availableTo after availableFrom, strict body', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/plans', { method: 'POST', role: Role.ADMIN, body });
  assert.equal((await post({ ...basic, price: 0, minQuantity: 1 })).status, 201);
  assert.equal((await post({ ...basic, availableTo: '2026-11-02' })).status, 201);
  const sameDay = await post({ ...basic, availableTo: '2026-11-01' });
  assert.equal(sameDay.status, 400);
  assert.equal(sameDay.body.error?.details?.[0]?.field, 'availableTo');
  for (const body of [
    { ...basic, availableTo: '2026-10-01' }, { ...basic, price: -1 }, { ...basic, price: 1.5 },
    { ...basic, minQuantity: 0 }, { ...basic, billingPeriod: 'HOURLY' }, { ...basic, availableFrom: '2026-13-40' },
    { ...basic, id: 5 }, { ...basic, name: '' }, { price: 1, billingPeriod: 'DAILY', availableFrom: '2026-11-01' },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
});

test('update: merged availability check, empty patch, unknown id, flags apply immediately and audit keeps previous values', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(planData({ availableFrom: '2026-03-01T00:00:00.000Z', availableTo: '2026-06-01T00:00:00.000Z' }));
  const patch = (id: number, body: unknown) => srv.request<ApiBody & { data: PlanRow }>(`/plans/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  assert.equal((await patch(1, { availableTo: '2026-02-01' })).status, 400);
  assert.equal((await patch(1, { availableFrom: '2026-07-01' })).status, 400);
  assert.equal((await patch(1, { availableFrom: '2026-07-01', availableTo: null })).status, 200);
  assert.equal((await patch(1, {})).status, 400);
  assert.equal((await patch(99, { isActive: false })).status, 404);
  s.subs.open = 3;
  const flags = await patch(1, { closable: true, pausable: true, renewable: true, autoClose: true, price: 1000 });
  assert.equal(flags.status, 200);
  assert.equal(flags.body.data.closable, true);
  const entry = s.audit.entries.at(-1);
  assert.equal(entry?.action, 'plan.update');
  assert.deepEqual((entry?.metadata as { previous: unknown }).previous, {
    closable: false, pausable: false, renewable: false, autoClose: false, price: 49900,
  });
});

test('billingPeriod change is 409 IN_USE while open subscriptions exist, allowed otherwise or when unchanged', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(planData());
  const patch = (body: unknown) => srv.request<ApiBody>('/plans/1', { method: 'PATCH', role: Role.ADMIN, body });
  s.subs.open = 2;
  const blocked = await patch({ billingPeriod: 'YEARLY' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error?.code, 'IN_USE');
  assert.equal(s.table.rows[0]?.billingPeriod, 'MONTHLY');
  assert.equal((await patch({ billingPeriod: 'MONTHLY', name: 'Same period' })).status, 200);
  s.subs.open = 0;
  assert.equal((await patch({ billingPeriod: 'YEARLY' })).status, 200);
  assert.equal(s.table.rows[0]?.billingPeriod, 'YEARLY');
  assert.deepEqual(s.audit.actions(), ['plan.update', 'plan.update']);
});

test('GET /:id includes activeSubscriptionCount and 404s for missing plans', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(planData());
  s.subs.active = 4;
  const found = await srv.request<ApiBody & { data: { activeSubscriptionCount: number } }>('/plans/1', { role: Role.STAFF });
  assert.equal(found.body.data.activeSubscriptionCount, 4);
  assert.equal((await srv.request('/plans/9', { role: Role.STAFF })).status, 404);
  assert.equal((await srv.request('/plans/abc', { role: Role.STAFF })).status, 400);
});

test('delete is a soft delete: 409 IN_USE with open subscriptions, 404 once gone, audited', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(planData());
  s.subs.open = 1;
  const blocked = await srv.request<ApiBody>('/plans/1', { method: 'DELETE', role: Role.ADMIN });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error?.code, 'IN_USE');
  assert.equal(s.table.rows.length, 1);
  s.subs.open = 0;
  assert.equal((await srv.request('/plans/1', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await srv.request('/plans/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.deepEqual(s.audit.actions(), ['plan.delete']);
});

test('list: bounded, strict query, comma enum, booleans, availableOn date, search and page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) s.table.insert(planData({ name: `P${i}` }));
  const get = (query: string) => srv.request<ApiBody & { data: unknown[] }>(`/plans${query}`, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?limit=0', '?page=0', '?sortBy=id', '?sortBy=description', '?sortOrder=up', '?billingPeriod=HOURLY',
    '?isActive=yes', '?closable=1', '?availableOn=tomorrow', '?availableOn=2026-02-30', '?bogus=1', '?search=',
  ]) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?billingPeriod=MONTHLY,YEARLY&isActive=true&autoClose=false&closable=true&pausable=false&renewable=true'
    + '&availableOn=2026-11-01&search=pro&sortBy=price&sortOrder=asc&limit=2');
  assert.equal(ok.status, 200);
  const q = s.lastList.at(-1);
  assert.deepEqual(q?.billingPeriod, ['MONTHLY', 'YEARLY']);
  assert.deepEqual([q?.isActive, q?.autoClose, q?.closable, q?.pausable, q?.renewable], [true, false, true, false, true]);
  assert.equal(q?.availableOn?.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(q?.search, 'pro');
  assert.equal(q?.sortBy, 'price');
  assert.equal(ok.body.data.length, 2);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
});

test('assertAvailable: inclusive on availableFrom and availableTo days, 409 before and after, no end means open-ended', async () => {
  const s = setup();
  s.table.insert(planData({ availableFrom: '2026-03-01T00:00:00.000Z', availableTo: '2026-03-31T00:00:00.000Z' }));
  s.table.insert(planData({ availableFrom: '2026-03-01T00:00:00.000Z', availableTo: null }));
  const at = (id: number, iso: string) => s.service.assertAvailable(id, new Date(iso));
  assert.equal((await at(1, '2026-03-01T00:00:00.000Z')).id, 1);
  assert.equal((await at(1, '2026-03-01T23:59:59.999Z')).id, 1);
  assert.equal((await at(1, '2026-03-31T00:00:00.000Z')).id, 1);
  assert.equal((await at(1, '2026-03-31T23:59:59.999Z')).id, 1);
  await assert.rejects(at(1, '2026-02-28T23:59:59.999Z'), { status: 409, code: 'PLAN_NOT_AVAILABLE' });
  await assert.rejects(at(1, '2026-04-01T00:00:00.000Z'), { status: 409, code: 'PLAN_NOT_AVAILABLE' });
  assert.equal((await at(2, '2099-01-01T00:00:00.000Z')).id, 2);
  await assert.rejects(at(2, '2026-02-28T00:00:00.000Z'), { code: 'PLAN_NOT_AVAILABLE' });
});

test('assertAvailable: inactive plan is PLAN_NOT_AVAILABLE, deleted or missing plan is 404; getById hides deleted plans', async () => {
  const s = setup();
  s.table.insert(planData({ isActive: false }));
  s.table.insert(planData());
  await assert.rejects(s.service.assertAvailable(1, new Date('2026-06-01')), { status: 409, code: 'PLAN_NOT_AVAILABLE' });
  assert.equal((await s.service.getById(2))?.id, 2);
  await s.service.remove(actorFor(Role.ADMIN), 2);
  await assert.rejects(s.service.assertAvailable(2, new Date('2026-06-01')), { status: 404 });
  await assert.rejects(s.service.assertAvailable(77, new Date('2026-06-01')), { status: 404 });
  assert.equal(await s.service.getById(2), null);
  const record = await s.service.getById(1);
  assert.deepEqual(Object.keys(record ?? {}).sort(), [
    'autoClose', 'availableFrom', 'availableTo', 'billingPeriod', 'closable', 'id', 'isActive',
    'minQuantity', 'name', 'pausable', 'price', 'renewable',
  ]);
});

test('service enforces roles itself', async () => {
  const s = setup();
  s.table.insert(planData());
  const params: ListPlansParams = { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' };
  await assert.rejects(s.service.list(actorFor(Role.CUSTOMER), params), { status: 403 });
  await assert.rejects(s.service.get(actorFor(Role.CUSTOMER), 1), { status: 403 });
  await assert.rejects(s.service.update(actorFor(Role.STAFF), 1, { isActive: false }), { status: 403 });
  await assert.rejects(s.service.remove(actorFor(Role.STAFF), 1), { status: 403 });
  await assert.rejects(s.service.create(actorFor(Role.STAFF), {
    name: 'X', price: 1, billingPeriod: 'DAILY', minQuantity: 1, availableFrom: new Date(),
    autoClose: false, closable: false, pausable: false, renewable: false, isActive: true,
  }), { status: 403 });
  assert.equal((await s.service.list(actorFor(Role.STAFF), params)).plans.length, 1);
});
