import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import type { DiscountEvaluationLine } from './discounts.gateway.js';
import { createDiscountsRouter } from './discounts.routes.js';
import type { DiscountRow, DiscountUsageRow, DiscountsRepository } from './discounts.repository.js';
import type { ListDiscountUsagesParams, ListDiscountsParams } from './discounts.schema.js';
import { DiscountsService } from './discounts.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const CLOCK = new Date('2026-10-31T10:00:00.000Z');
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

interface Setup {
  table: InMemoryTable<DiscountRow>;
  audit: RecordingAudit;
  service: DiscountsService;
  productLinks: Map<number, number[]>;
  subscriptionLinks: Map<number, number[]>;
  usages: DiscountUsageRow[];
  deleted: Set<number>;
  products: Set<number>;
  subscriptions: Set<number>;
  writes: string[];
  lastList: ListDiscountsParams[];
  lastUsageList: ListDiscountUsagesParams[];
  failNext: { create?: Error; attach?: Error };
}

function discountData(over: Partial<DiscountRow> = {}): Omit<DiscountRow, 'id'> {
  return {
    name: 'Offer', code: null, type: 'PERCENTAGE', value: 1000, scope: 'PRODUCT', minPurchase: null, minQuantity: null,
    startDate: '2026-01-01T00:00:00.000Z', endDate: null, usageLimit: null, usedCount: 0, isActive: true,
    createdById: 1, createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

function setup(): Setup {
  const table = new InMemoryTable<DiscountRow>();
  const audit = new RecordingAudit();
  const productLinks = new Map<number, number[]>();
  const subscriptionLinks = new Map<number, number[]>();
  const usages: DiscountUsageRow[] = [];
  const deleted = new Set<number>();
  const products = new Set<number>([1, 2, 3, 4]);
  const subscriptions = new Set<number>([1, 2, 3]);
  const writes: string[] = [];
  const lastList: ListDiscountsParams[] = [];
  const lastUsageList: ListDiscountUsagesParams[] = [];
  const failNext: Setup['failNext'] = {};
  const live = (): DiscountRow[] => table.rows.filter((row) => !deleted.has(row.id));

  const repository = fakeRepository<DiscountsRepository>({
    async list(query) { lastList.push(query); return paginateRows(live(), query.page, query.limit).data; },
    async count() { return live().length; },
    async findById(id) { const row = table.find(id); return row === null || deleted.has(id) ? null : { ...row }; },
    async create(input, createdById) {
      writes.push('create');
      if (failNext.create) throw failNext.create;
      const row = table.insert(discountData({
        name: input.name, code: input.code ?? null, type: input.type, value: input.value, scope: input.scope,
        minPurchase: input.minPurchase ?? null, minQuantity: input.minQuantity ?? null,
        startDate: input.startDate.toISOString(), endDate: input.endDate?.toISOString() ?? null,
        usageLimit: input.usageLimit ?? null, isActive: input.isActive, createdById,
      }));
      productLinks.set(row.id, input.productIds ?? []);
      return { ...row };
    },
    async update(id, patch, clearLinks) {
      writes.push('update');
      const { startDate, endDate, ...rest } = patch;
      const row = table.update(id, {
        ...rest,
        ...(startDate !== undefined ? { startDate: startDate.toISOString() } : {}),
        ...(endDate !== undefined ? { endDate: endDate === null ? null : endDate.toISOString() } : {}),
      });
      if (clearLinks === 'products') productLinks.delete(id);
      if (clearLinks === 'subscriptions') subscriptionLinks.delete(id);
      return row === null ? null : { ...row };
    },
    async softDelete(id) {
      writes.push('softDelete');
      const row = table.find(id);
      if (row === null || deleted.has(id)) return null;
      deleted.add(id);
      return { ...row };
    },
    async listProductIds(id) { return [...(productLinks.get(id) ?? [])].sort((a, b) => a - b); },
    async replaceProducts(id, productIds) { writes.push('replaceProducts'); productLinks.set(id, [...productIds]); },
    async findExistingProductIds(ids) { return ids.filter((id) => products.has(id)); },
    async findExistingSubscriptionIds(ids) { return ids.filter((id) => subscriptions.has(id)); },
    async countAttachedSubscriptions(id) { return (subscriptionLinks.get(id) ?? []).length; },
    async attachSubscriptions(id, ids) {
      writes.push('attachSubscriptions');
      if (failNext.attach) throw failNext.attach;
      const current = subscriptionLinks.get(id) ?? [];
      const added = ids.filter((subscriptionId) => !current.includes(subscriptionId));
      subscriptionLinks.set(id, [...current, ...added]);
      return added;
    },
    async detachSubscription(id, subscriptionId) {
      writes.push('detachSubscription');
      const current = subscriptionLinks.get(id) ?? [];
      if (!current.includes(subscriptionId)) return false;
      subscriptionLinks.set(id, current.filter((value) => value !== subscriptionId));
      return true;
    },
    async countUsagesOf(id) { return usages.filter((usage) => usage.discountId === id).length; },
    async listUsages(id, query) {
      lastUsageList.push(query);
      return paginateRows(usages.filter((usage) => usage.discountId === id), query.page, query.limit).data;
    },
    async countUsages(id) { return usages.filter((usage) => usage.discountId === id).length; },
    async findInvoiceNumbers(ids) { return new Map(ids.map((id) => [id, `INV-2026-${String(id).padStart(6, '0')}`])); },
    async findSubscriptionNumbers(ids) { return new Map(ids.map((id) => [id, `SUB-2026-${String(id).padStart(6, '0')}`])); },
    async findProductDiscounts(productIds) {
      return live()
        .filter((row) => row.scope === 'PRODUCT')
        .map((row) => ({ ...row, matchedProductIds: (productLinks.get(row.id) ?? []).filter((id) => productIds.includes(id)) }))
        .filter((row) => row.matchedProductIds.length > 0);
    },
    async findSubscriptionDiscounts(subscriptionId) {
      return live().filter((row) => row.scope === 'SUBSCRIPTION' && (subscriptionLinks.get(row.id) ?? []).includes(subscriptionId));
    },
  });
  return {
    table, audit, productLinks, subscriptionLinks, usages, deleted, products, subscriptions, writes, lastList,
    lastUsageList, failNext, service: new DiscountsService(repository, audit, () => CLOCK),
  };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/discounts', createDiscountsRouter({
    authService: auth.asAuthService(), discountsService: s.service,
  })));
}

const basic = { name: 'Spring', type: 'PERCENTAGE', value: 1500, scope: 'PRODUCT', startDate: '2026-11-01' };

test('RBAC matrix: ADMIN and STAFF read and attach, only ADMIN writes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  s.table.insert(discountData({ scope: 'PRODUCT' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION', name: 'To delete' }));
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/discounts', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/discounts/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/discounts/1/usages', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/discounts', allowed: [Role.ADMIN], body: basic, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/discounts/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'PUT', path: '/discounts/1/products', allowed: [Role.ADMIN], body: { productIds: [1] }, expectedAllowedStatus: 200 },
    { method: 'POST', path: '/discounts/2/subscriptions', allowed: [Role.ADMIN, Role.STAFF], body: { subscriptionIds: [1] }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/discounts/2/subscriptions/1', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'DELETE', path: '/discounts/3', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create returns 201 with Location, defaults, UTC-midnight dates, createdById, productIds and an audit entry', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: { id: number; state: string; isActive: boolean; productIds: number[]; startDate: string; endDate: string; usedCount: number; attachedSubscriptionCount: number } }>(
    '/discounts', {
      method: 'POST', role: Role.ADMIN,
      body: { ...basic, code: ' SPRING ', endDate: '2026-12-31T18:00:00Z', usageLimit: 5, productIds: [2, 1] },
    },
  );
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/discounts\/1$/);
  const data = response.body.data;
  assert.equal(data.state, 'upcoming');
  assert.equal(data.isActive, true);
  assert.equal(data.usedCount, 0);
  assert.equal(data.startDate, '2026-11-01T00:00:00.000Z');
  assert.equal(data.endDate, '2026-12-31T00:00:00.000Z');
  assert.deepEqual(data.productIds, [1, 2]);
  assert.equal(s.table.rows[0]?.code, 'SPRING');
  assert.equal(s.table.rows[0]?.createdById, actorFor(Role.ADMIN).userId);
  assert.deepEqual(s.audit.actions(), ['discount.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);
});

test('validation: value bounds per type, window, limits, usedCount and unknown keys are rejected, unknown products are 400', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/discounts', { method: 'POST', role: Role.ADMIN, body });
  assert.equal((await post({ ...basic, value: 10000 })).status, 201);
  assert.equal((await post({ ...basic, type: 'FIXED', value: 1 })).status, 201);
  assert.equal((await post({ ...basic, type: 'FIXED', value: 5_000_000 })).status, 201);
  assert.equal((await post({ ...basic, endDate: '2026-11-01' })).status, 201);
  const badWindow = await post({ ...basic, endDate: '2026-10-31' });
  assert.equal(badWindow.status, 400);
  assert.equal(badWindow.body.error?.details?.[0]?.field, 'endDate');
  const badValue = await post({ ...basic, value: 10001 });
  assert.equal(badValue.body.error?.details?.[0]?.field, 'value');
  for (const body of [
    { ...basic, value: 0 }, { ...basic, value: 1.5 }, { ...basic, type: 'FIXED', value: 0 }, { ...basic, type: 'BOGUS' },
    { ...basic, scope: 'ORDER' }, { ...basic, usageLimit: 0 }, { ...basic, minQuantity: 0 }, { ...basic, minPurchase: -1 },
    { ...basic, usedCount: 3 }, { ...basic, id: 4 }, { ...basic, name: '' }, { ...basic, code: '' },
    { ...basic, startDate: '2026-13-40' }, { ...basic, productIds: [1, 1] }, { ...basic, productIds: [0] },
    { ...basic, scope: 'SUBSCRIPTION', productIds: [1] }, { type: 'FIXED', value: 5, scope: 'PRODUCT', startDate: '2026-11-01' },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const missing = await post({ ...basic, productIds: [1, 99] });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error?.details?.[0]?.field, 'productIds');
  assert.equal((await post({ ...basic, usageLimit: null, minPurchase: null, minQuantity: null, endDate: null, code: null })).status, 201);
});

test('duplicate code is 409 DUPLICATE on create and update; raw database errors never leak', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ code: 'A' }));
  s.failNext.create = sqlError('23505');
  const dup = await srv.request<ApiBody>('/discounts', { method: 'POST', role: Role.ADMIN, body: { ...basic, code: 'A' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error?.code, 'DUPLICATE');
  s.failNext.create = new Error('connection string leaked');
  const broken = await srv.request<ApiBody>('/discounts', { method: 'POST', role: Role.ADMIN, body: basic });
  assert.equal(broken.status, 500);
  assert.doesNotMatch(JSON.stringify(broken.body), /leaked/);
  assert.deepEqual(s.audit.actions(), []);
});

test('update: merged value and window checks, empty patch, unknown id, strict body, audit keeps previous values', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ type: 'FIXED', value: 50000, startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-06-01T00:00:00.000Z' }));
  const patch = (id: number, body: unknown) => srv.request<ApiBody & { data: DiscountRow }>(`/discounts/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  assert.equal((await patch(1, { type: 'PERCENTAGE' })).status, 400);
  assert.equal((await patch(1, { endDate: '2026-02-01' })).status, 400);
  assert.equal((await patch(1, { startDate: '2026-07-01' })).status, 400);
  assert.equal((await patch(1, { startDate: '2026-07-01', endDate: null })).status, 200);
  assert.equal((await patch(1, { type: 'PERCENTAGE', value: 2500 })).status, 200);
  assert.equal((await patch(1, {})).status, 400);
  assert.equal((await patch(1, { usedCount: 0 })).status, 400);
  assert.equal((await patch(99, { isActive: false })).status, 404);
  const entry = s.audit.entries.at(-1);
  assert.equal(entry?.action, 'discount.update');
  assert.deepEqual((entry?.metadata as { previous: unknown }).previous, { type: 'FIXED', value: 50000 });
  assert.equal(s.table.rows[0]?.usedCount, 0);
});

test('scope: change is 409 IN_USE once usages exist; otherwise it clears the old links', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ scope: 'PRODUCT' }));
  s.table.insert(discountData({ scope: 'PRODUCT' }));
  s.productLinks.set(1, [1]);
  s.productLinks.set(2, [2]);
  s.usages.push({ id: 1, discountId: 1, invoiceId: 5, subscriptionId: 1, amount: 100, createdAt: NOW });
  const patch = (id: number, body: unknown) => srv.request<ApiBody>(`/discounts/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  const blocked = await patch(1, { scope: 'SUBSCRIPTION' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error?.code, 'IN_USE');
  assert.equal(s.table.rows[0]?.scope, 'PRODUCT');
  assert.equal((await patch(1, { scope: 'PRODUCT', name: 'Same scope' })).status, 200);
  assert.equal((await patch(2, { scope: 'SUBSCRIPTION' })).status, 200);
  assert.equal(s.productLinks.has(2), false);
  assert.equal(s.productLinks.has(1), true);
});

test('delete is a soft delete: 404 once gone, audited, hidden from reads', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData());
  assert.equal((await srv.request('/discounts/1', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await srv.request('/discounts/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/discounts/1', { role: Role.STAFF })).status, 404);
  assert.equal((await srv.request('/discounts/1', { method: 'PATCH', role: Role.ADMIN, body: { name: 'x' } })).status, 404);
  assert.deepEqual(s.audit.actions(), ['discount.delete']);
  assert.equal(s.table.rows.length, 1);
});

test('GET /:id returns productIds and attachedSubscriptionCount; 404 and 400 for bad ids', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ scope: 'PRODUCT' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION' }));
  s.productLinks.set(1, [3, 1]);
  s.subscriptionLinks.set(2, [1, 2]);
  const one = await srv.request<ApiBody & { data: { productIds: number[]; attachedSubscriptionCount: number; state: string } }>('/discounts/1', { role: Role.STAFF });
  assert.deepEqual(one.body.data.productIds, [1, 3]);
  assert.equal(one.body.data.state, 'active');
  const two = await srv.request<ApiBody & { data: { productIds: number[]; attachedSubscriptionCount: number } }>('/discounts/2', { role: Role.STAFF });
  assert.equal(two.body.data.attachedSubscriptionCount, 2);
  assert.deepEqual(two.body.data.productIds, []);
  assert.equal((await srv.request('/discounts/9', { role: Role.STAFF })).status, 404);
  assert.equal((await srv.request('/discounts/abc', { role: Role.STAFF })).status, 400);
});

test('PUT /:id/products replaces the set, needs PRODUCT scope and existing products, and is audited', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ scope: 'PRODUCT' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION' }));
  s.productLinks.set(1, [1, 2]);
  const put = (id: number, body: unknown, role: typeof Role.ADMIN | typeof Role.STAFF = Role.ADMIN) =>
    srv.request<ApiBody & { data: { productIds: number[] } }>(`/discounts/${id}/products`, { method: 'PUT', role, body });
  const ok = await put(1, { productIds: [3, 4] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.productIds, [3, 4]);
  assert.deepEqual(s.productLinks.get(1), [3, 4]);
  assert.equal((await put(1, { productIds: [] })).status, 200);
  assert.deepEqual(s.productLinks.get(1), []);
  const unknown = await put(1, { productIds: [3, 77] });
  assert.equal(unknown.status, 400);
  assert.deepEqual(s.productLinks.get(1), []);
  assert.equal((await put(2, { productIds: [1] })).status, 409);
  assert.equal((await put(1, { productIds: [1, 1] })).status, 400);
  assert.equal((await put(1, { productIds: [1], extra: true })).status, 400);
  assert.equal((await put(1, { productIds: [1] }, Role.STAFF)).status, 403);
  assert.equal((await put(9, { productIds: [1] })).status, 404);
  assert.deepEqual(s.audit.actions(), ['discount.products.set', 'discount.products.set']);
  assert.deepEqual((s.audit.entries[0]?.metadata as { previous: number[] }).previous, [1, 2]);
});

test('attach: STAFF may attach; expired, exhausted, inactive and wrong-scope discounts are 409 DISCOUNT_NOT_APPLICABLE', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ scope: 'SUBSCRIPTION' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION', endDate: '2026-10-30T00:00:00.000Z' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION', usageLimit: 2, usedCount: 2 }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION', isActive: false }));
  s.table.insert(discountData({ scope: 'PRODUCT' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION', startDate: '2026-12-01T00:00:00.000Z' }));
  s.table.insert(discountData({ scope: 'SUBSCRIPTION', endDate: '2026-10-31T00:00:00.000Z' }));
  const attach = (id: number, body: unknown, role: typeof Role.ADMIN | typeof Role.STAFF = Role.STAFF) =>
    srv.request<ApiBody & { data: { attachedSubscriptionCount: number } }>(`/discounts/${id}/subscriptions`, { method: 'POST', role, body });
  const ok = await attach(1, { subscriptionIds: [1, 2] });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.attachedSubscriptionCount, 2);
  assert.equal((await attach(1, { subscriptionIds: [2, 3] })).body.data.attachedSubscriptionCount, 3);
  for (const id of [2, 3, 4, 5]) {
    const response = await attach(id, { subscriptionIds: [1] });
    assert.equal(response.status, 409, `discount ${id}`);
    assert.equal(response.body.error?.code, 'DISCOUNT_NOT_APPLICABLE');
  }
  assert.equal((await attach(6, { subscriptionIds: [1] }, Role.ADMIN)).status, 200);
  assert.equal((await attach(7, { subscriptionIds: [1] })).status, 200);
  const missing = await attach(1, { subscriptionIds: [1, 99] });
  assert.equal(missing.status, 404);
  assert.equal((await attach(1, { subscriptionIds: [] })).status, 400);
  assert.equal((await attach(1, { subscriptionIds: [1, 1] })).status, 400);
  assert.equal((await attach(1, {})).status, 400);
  assert.equal((await attach(99, { subscriptionIds: [1] })).status, 404);
  assert.equal(s.audit.actions().filter((action) => action === 'discount.attach').length, 4);
  s.failNext.attach = sqlError('23505');
  assert.equal((await attach(1, { subscriptionIds: [1] })).status, 409);
});

test('detach: A and S may detach, 404 when not attached, audited', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ scope: 'SUBSCRIPTION' }));
  s.subscriptionLinks.set(1, [1, 2]);
  const del = (path: string, role: typeof Role.ADMIN | typeof Role.STAFF | typeof Role.CUSTOMER = Role.STAFF) =>
    srv.request<ApiBody>(`/discounts/${path}`, { method: 'DELETE', role });
  assert.equal((await del('1/subscriptions/1')).status, 200);
  assert.equal((await del('1/subscriptions/1')).status, 404);
  assert.equal((await del('1/subscriptions/2', Role.ADMIN)).status, 200);
  assert.equal((await del('1/subscriptions/2', Role.CUSTOMER)).status, 403);
  assert.equal((await del('9/subscriptions/1')).status, 404);
  assert.equal((await del('1/subscriptions/x')).status, 400);
  assert.deepEqual(s.audit.actions(), ['discount.detach', 'discount.detach']);
});

test('list: bounded, strict query, comma enums, derived state filter, productId, search and page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) s.table.insert(discountData({ name: `D${i}`, createdAt: `2026-10-0${i}T00:00:00.000Z` }));
  const get = (query: string) => srv.request<ApiBody & { data: { state: string }[] }>(`/discounts${query}`, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?limit=0', '?page=0', '?sortBy=id', '?sortBy=value', '?sortOrder=up', '?type=BOGUS', '?scope=ORDER',
    '?state=gone', '?state=', '?isActive=yes', '?productId=0', '?productId=x', '?bogus=1', '?search=', '?usedCount=1',
  ]) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?type=PERCENTAGE,FIXED&scope=PRODUCT&isActive=true&state=active,upcoming&productId=2&search=d&sortBy=usedCount&sortOrder=asc&limit=2');
  assert.equal(ok.status, 200);
  const q = s.lastList.at(-1);
  assert.deepEqual(q?.type, ['PERCENTAGE', 'FIXED']);
  assert.deepEqual(q?.scope, ['PRODUCT']);
  assert.equal(q?.isActive, true);
  assert.deepEqual(q?.state, ['active', 'upcoming']);
  assert.equal(q?.productId, 2);
  assert.equal(q?.search, 'd');
  assert.equal(q?.sortBy, 'usedCount');
  assert.equal(ok.body.data.length, 2);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
  assert.equal(past.body.meta?.total, 3);
});

test('state is derived from dates and usedCount at read time', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ startDate: '2026-11-01T00:00:00.000Z' }));
  s.table.insert(discountData({ startDate: '2026-10-31T00:00:00.000Z', endDate: '2026-10-31T00:00:00.000Z' }));
  s.table.insert(discountData({ endDate: '2026-10-30T00:00:00.000Z' }));
  s.table.insert(discountData({ usageLimit: 3, usedCount: 3 }));
  s.table.insert(discountData({ usageLimit: 3, usedCount: 2 }));
  const response = await srv.request<ApiBody & { data: { state: string }[] }>('/discounts', { role: Role.ADMIN });
  assert.deepEqual(response.body.data.map((row) => row.state), ['upcoming', 'active', 'expired', 'exhausted', 'active']);
});

test('usages list: contract, filters, names and numbers', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.table.insert(discountData({ name: 'Spring' }));
  s.usages.push({ id: 1, discountId: 1, invoiceId: 7, subscriptionId: 2, amount: 500, createdAt: NOW });
  const get = (query: string) => srv.request<ApiBody & { data: Record<string, unknown>[] }>(`/discounts/1/usages${query}`, { role: Role.STAFF });
  for (const bad of ['?limit=101', '?sortBy=id', '?sortBy=discountId', '?invoiceId=0', '?createdFrom=soon', '?search=x', '?bogus=1']) {
    assert.equal((await get(bad)).status, 400, bad);
  }
  const ok = await get('?invoiceId=7&subscriptionId=2&createdFrom=2026-10-01&createdTo=2026-10-31&sortBy=amount&sortOrder=asc');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data[0], {
    id: 1, discountId: 1, discountName: 'Spring', invoiceId: 7, invoiceNumber: 'INV-2026-000007',
    subscriptionId: 2, subscriptionNumber: 'SUB-2026-000002', amount: 500, createdAt: NOW,
  });
  const q = s.lastUsageList.at(-1);
  assert.equal(q?.invoiceId, 7);
  assert.equal(q?.sortBy, 'amount');
  assert.equal(q?.createdTo?.toISOString(), '2026-10-31T23:59:59.999Z');
  assert.equal((await get('?page=5')).body.data.length, 0);
  assert.equal((await srv.request('/discounts/9/usages', { role: Role.STAFF })).status, 404);
});

test('service enforces roles itself', async () => {
  const s = setup();
  s.table.insert(discountData());
  const params: ListDiscountsParams = { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' };
  const customer = actorFor(Role.CUSTOMER);
  await assert.rejects(s.service.list(customer, params), { status: 403 });
  await assert.rejects(s.service.get(customer, 1), { status: 403 });
  await assert.rejects(s.service.listUsages(customer, 1, { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }), { status: 403 });
  await assert.rejects(s.service.attachSubscriptions(customer, 1, [1]), { status: 403 });
  await assert.rejects(s.service.detachSubscription(customer, 1, 1), { status: 403 });
  const staff = actorFor(Role.STAFF);
  await assert.rejects(s.service.update(staff, 1, { isActive: false }), { status: 403 });
  await assert.rejects(s.service.remove(staff, 1), { status: 403 });
  await assert.rejects(s.service.setProducts(staff, 1, []), { status: 403 });
  await assert.rejects(s.service.create(staff, {
    name: 'X', type: 'FIXED', value: 1, scope: 'PRODUCT', startDate: new Date(), isActive: true,
  }), { status: 403 });
  assert.equal((await s.service.list(staff, params)).discounts.length, 1);
  assert.deepEqual(s.writes, []);
});

// ---- evaluate -------------------------------------------------------------------------------

const ASOF = new Date('2026-10-31T12:00:00.000Z');
const line = (lineId: number, productId: number | null, quantity: number, amount: number): DiscountEvaluationLine =>
  ({ lineId, productId, quantity, amount });

function productDiscount(s: Setup, productIds: number[], over: Partial<DiscountRow> = {}): DiscountRow {
  const row = s.table.insert(discountData({ scope: 'PRODUCT', ...over }));
  s.productLinks.set(row.id, productIds);
  return row;
}

function subscriptionDiscount(s: Setup, subscriptionId: number | null, over: Partial<DiscountRow> = {}): DiscountRow {
  const row = s.table.insert(discountData({ scope: 'SUBSCRIPTION', ...over }));
  if (subscriptionId !== null) s.subscriptionLinks.set(row.id, [subscriptionId]);
  return row;
}

const evaluate = (s: Setup, lines: DiscountEvaluationLine[], subscriptionId: number | null = 1, asOf: Date = ASOF) =>
  s.service.evaluate({ subscriptionId, lines, asOf });

test('evaluate: usage limit is reached on the exact last use (limit-1 eligible, limit not)', async () => {
  const s = setup();
  productDiscount(s, [1], { usageLimit: 3, usedCount: 2 });
  productDiscount(s, [1], { usageLimit: 3, usedCount: 3 });
  productDiscount(s, [1], { usageLimit: null, usedCount: 999 });
  const result = await evaluate(s, [line(10, 1, 1, 10000)]);
  assert.deepEqual(result.map((a) => a.discountId), [1, 3]);
});

test('evaluate: valid on its start date and its end date (inclusive by calendar day), not the day before or after', async () => {
  const s = setup();
  productDiscount(s, [1], { startDate: '2026-10-31T00:00:00.000Z', endDate: '2026-10-31T00:00:00.000Z' });
  const at = (iso: string) => evaluate(s, [line(1, 1, 1, 1000)], 1, new Date(iso));
  assert.equal((await at('2026-10-31T00:00:00.000Z')).length, 1);
  assert.equal((await at('2026-10-31T23:59:59.999Z')).length, 1);
  assert.equal((await at('2026-10-30T23:59:59.999Z')).length, 0);
  assert.equal((await at('2026-11-01T00:00:00.000Z')).length, 0);
  productDiscount(s, [2], { endDate: null });
  assert.equal((await evaluate(s, [line(1, 2, 1, 1000)], 1, new Date('2099-01-01T00:00:00.000Z'))).length, 1);
});

test('evaluate: minimum purchase equal to the amount is eligible, one paise less is not', async () => {
  const s = setup();
  productDiscount(s, [1], { minPurchase: 5000 });
  assert.equal((await evaluate(s, [line(1, 1, 1, 5000)])).length, 1);
  assert.equal((await evaluate(s, [line(1, 1, 1, 4999)])).length, 0);
  subscriptionDiscount(s, 1, { minPurchase: 8000 });
  assert.equal((await evaluate(s, [line(1, 9, 1, 8000)])).length, 1);
  assert.equal((await evaluate(s, [line(1, 9, 1, 7999)])).length, 0);
});

test('evaluate: minimum quantity uses the matched line (PRODUCT) or the total quantity (SUBSCRIPTION)', async () => {
  const s = setup();
  productDiscount(s, [1], { minQuantity: 3 });
  subscriptionDiscount(s, 1, { minQuantity: 5, type: 'FIXED', value: 100 });
  const exact = await evaluate(s, [line(1, 1, 3, 3000), line(2, 2, 2, 2000)]);
  assert.deepEqual(exact.map((a) => [a.discountId, a.lineId]), [[1, 1], [2, 1], [2, 2]]);
  const below = await evaluate(s, [line(1, 1, 2, 2000), line(2, 2, 2, 2000)]);
  assert.deepEqual(below, []);
  // Two lines of the same product: 3 units in total, but no single matched line reaches 3 and the
  // subscription total (3) is below 5.
  const split = await evaluate(s, [line(1, 1, 1, 1000), line(2, 1, 2, 1000)]);
  assert.deepEqual(split, []);
});

test('evaluate: stacking runs in ascending discount id regardless of insertion order or attachment order', async () => {
  const s = setup();
  subscriptionDiscount(s, 1, { type: 'PERCENTAGE', value: 1000, name: 'sub 10%' });
  productDiscount(s, [1], { type: 'FIXED', value: 2000, name: 'product fixed' });
  productDiscount(s, [1], { type: 'PERCENTAGE', value: 5000, name: 'product 50%' });
  const result = await evaluate(s, [line(1, 1, 1, 10000)]);
  assert.deepEqual(result, [
    { discountId: 2, lineId: 1, amount: 2000 },
    { discountId: 3, lineId: 1, amount: 4000 },
    { discountId: 1, lineId: 1, amount: 400 },
  ]);
  const t = setup();
  productDiscount(t, [1], { type: 'PERCENTAGE', value: 5000 });
  productDiscount(t, [1], { type: 'FIXED', value: 2000 });
  assert.deepEqual(await evaluate(t, [line(1, 1, 1, 10000)]), [
    { discountId: 1, lineId: 1, amount: 5000 },
    { discountId: 2, lineId: 1, amount: 2000 },
  ]);
});

test('evaluate: a discount never exceeds its base (FIXED larger than the base is capped, later discounts see zero)', async () => {
  const s = setup();
  productDiscount(s, [1], { type: 'FIXED', value: 90000 });
  productDiscount(s, [1], { type: 'FIXED', value: 500 });
  subscriptionDiscount(s, 1, { type: 'FIXED', value: 700 });
  const result = await evaluate(s, [line(1, 1, 1, 30000)]);
  assert.deepEqual(result, [{ discountId: 1, lineId: 1, amount: 30000 }]);
  const sub = setup();
  subscriptionDiscount(sub, 1, { type: 'FIXED', value: 50000 });
  const capped = await evaluate(sub, [line(1, null, 1, 12000), line(2, null, 1, 8000)]);
  assert.equal(capped.reduce((sum, a) => sum + a.amount, 0), 20000);
});

test('evaluate: PERCENTAGE rounds through bpsOf (half up), per line', async () => {
  const s = setup();
  productDiscount(s, [1], { type: 'PERCENTAGE', value: 1250 });
  const result = await evaluate(s, [line(1, 1, 1, 3333), line(2, 1, 1, 3333)]);
  assert.deepEqual(result.map((a) => a.amount), [417, 417]);
  const half = await evaluate(s, [line(1, 1, 1, 4)]);
  assert.deepEqual(half.map((a) => a.amount), [1]);
  assert.deepEqual(await evaluate(s, [line(1, 1, 1, 3)]), []);
});

test('evaluate: PRODUCT scope applies only to lines whose product is in the set', async () => {
  const s = setup();
  productDiscount(s, [1, 3], { type: 'PERCENTAGE', value: 1000 });
  const result = await evaluate(s, [line(10, 1, 1, 1000), line(11, 2, 1, 5000), line(12, null, 1, 7000), line(13, 3, 2, 2000)]);
  assert.deepEqual(result, [
    { discountId: 1, lineId: 10, amount: 100 },
    { discountId: 1, lineId: 13, amount: 200 },
  ]);
});

test('evaluate: SUBSCRIPTION scope uses the base after product discounts and spreads proportionally, last line absorbs the remainder', async () => {
  const s = setup();
  productDiscount(s, [1], { type: 'FIXED', value: 1000 });
  subscriptionDiscount(s, 1, { type: 'FIXED', value: 1001 });
  const lines = [line(1, 1, 1, 4000), line(2, 2, 1, 3000), line(3, 3, 1, 3000)];
  const result = await evaluate(s, lines);
  const sub = result.filter((a) => a.discountId === 2);
  assert.deepEqual(result.filter((a) => a.discountId === 1), [{ discountId: 1, lineId: 1, amount: 1000 }]);
  // base after the product discount: 3000 + 3000 + 3000 = 9000
  assert.deepEqual(sub, [
    { discountId: 2, lineId: 1, amount: 333 },
    { discountId: 2, lineId: 2, amount: 333 },
    { discountId: 2, lineId: 3, amount: 335 },
  ]);
  assert.equal(sub.reduce((sum, a) => sum + a.amount, 0), 1001);
});

test('evaluate: subscription shares never exceed what is left on a line (overflow moves to earlier lines)', async () => {
  const s = setup();
  subscriptionDiscount(s, 1, { type: 'FIXED', value: 2 });
  const result = await evaluate(s, [line(1, null, 1, 1), line(2, null, 1, 1), line(3, null, 1, 1)]);
  assert.equal(result.reduce((sum, a) => sum + a.amount, 0), 2);
  assert.ok(result.every((a) => a.amount <= 1));
});

test('evaluate: inactive, deleted and not-attached discounts are ignored; subscriptionId null skips subscription scope', async () => {
  const s = setup();
  productDiscount(s, [1], { isActive: false });
  const deleted = productDiscount(s, [1]);
  s.deleted.add(deleted.id);
  subscriptionDiscount(s, 1, { isActive: false });
  subscriptionDiscount(s, 2);
  subscriptionDiscount(s, null);
  const attached = subscriptionDiscount(s, 1);
  const lines = [line(1, 1, 1, 10000)];
  assert.deepEqual((await evaluate(s, lines)).map((a) => a.discountId), [attached.id]);
  assert.deepEqual(await evaluate(s, lines, null), []);
  assert.deepEqual(await evaluate(s, []), []);
});

test('evaluate is pure: no repository write is called and usedCount is untouched', async () => {
  const s = setup();
  productDiscount(s, [1], { usageLimit: 2, usedCount: 1 });
  subscriptionDiscount(s, 1);
  const before = JSON.stringify(s.table.rows);
  const first = await evaluate(s, [line(1, 1, 1, 10000), line(2, 2, 1, 5000)]);
  const second = await evaluate(s, [line(1, 1, 1, 10000), line(2, 2, 1, 5000)]);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.audit.actions(), []);
  assert.equal(JSON.stringify(s.table.rows), before);
});

test('listAttachedForSubscription returns the summary fields only', async () => {
  const s = setup();
  subscriptionDiscount(s, 1, { name: 'Loyalty', code: 'LOYAL', type: 'FIXED', value: 500 });
  subscriptionDiscount(s, 2);
  assert.deepEqual(await s.service.listAttachedForSubscription(1), [
    { id: 1, name: 'Loyalty', code: 'LOYAL', type: 'FIXED', value: 500, scope: 'SUBSCRIPTION' },
  ]);
  assert.deepEqual(await s.service.listAttachedForSubscription(3), []);
});
