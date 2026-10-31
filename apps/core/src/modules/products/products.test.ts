import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import { createProductsRouter } from './products.routes.js';
import type { ProductRow, ProductsRepository, VariantRow } from './products.repository.js';
import { ProductsService } from './products.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

interface Setup {
  products: InMemoryTable<ProductRow>;
  variants: InMemoryTable<VariantRow>;
  audit: RecordingAudit;
  service: ProductsService;
  failNext: { createVariant?: Error; updateVariant?: Error; deleteVariant?: Error; createProduct?: Error };
  lastProductList: { search?: string; type?: string[]; isActive?: boolean; minPrice?: number; maxPrice?: number; include?: string[] }[];
  lastVariantList: { search?: string; isActive?: boolean }[];
}

function setup(): Setup {
  const products = new InMemoryTable<ProductRow>();
  const variants = new InMemoryTable<VariantRow>();
  const audit = new RecordingAudit();
  const failNext: Setup['failNext'] = {};
  const lastProductList: Setup['lastProductList'] = [];
  const lastVariantList: Setup['lastVariantList'] = [];
  const live = () => products.rows.filter((row) => row.deletedAt === null);
  const variantKey = (v: { productId: number; attribute: string; value: string }) => `${v.productId}|${v.attribute}|${v.value}`;
  const repository = fakeRepository<ProductsRepository>({
    async listProducts(query) {
      lastProductList.push({ search: query.search, type: query.type, isActive: query.isActive, minPrice: query.minPrice, maxPrice: query.maxPrice, include: query.include });
      return paginateRows(live(), query.page, query.limit).data;
    },
    async countProducts() { return live().length; },
    async findProduct(id) { const row = live().find((r) => r.id === id); return row === undefined ? null : { ...row }; },
    async listVariantsForProducts(ids) { return variants.rows.filter((row) => ids.includes(row.productId)); },
    async createProduct(input, createdById) {
      if (failNext.createProduct) throw failNext.createProduct;
      const keys = new Set<string>();
      for (const v of input.variants ?? []) keys.add(`${v.attribute}|${v.value}`);
      const product = products.insert({
        name: input.name, type: input.type, salesPrice: input.salesPrice, costPrice: input.costPrice,
        notes: input.notes ?? null, isActive: input.isActive, createdById, deletedAt: null, createdAt: NOW, updatedAt: NOW,
      });
      const created = (input.variants ?? []).map((v) => variants.insert({ ...v, productId: product.id, createdAt: NOW, updatedAt: NOW }));
      return { product, variants: created };
    },
    async updateProduct(id, patch) {
      const row = live().find((r) => r.id === id);
      return row === undefined ? null : products.update(id, patch);
    },
    async softDeleteProduct(id) {
      const row = live().find((r) => r.id === id);
      return row === undefined ? null : products.update(id, { deletedAt: NOW });
    },
    async listVariants(productId, query) {
      lastVariantList.push({ search: query.search, isActive: query.isActive });
      return paginateRows(variants.rows.filter((v) => v.productId === productId), query.page, query.limit).data;
    },
    async countVariants(productId) { return variants.rows.filter((v) => v.productId === productId).length; },
    async findVariant(productId, variantId) {
      const row = variants.rows.find((v) => v.id === variantId && v.productId === productId);
      return row === undefined ? null : { ...row };
    },
    async createVariant(productId, input) {
      if (failNext.createVariant) throw failNext.createVariant;
      if (variants.rows.some((v) => variantKey(v) === variantKey({ productId, ...input }))) throw sqlError('23505');
      return variants.insert({ ...input, productId, createdAt: NOW, updatedAt: NOW });
    },
    async updateVariant(productId, variantId, patch) {
      if (failNext.updateVariant) throw failNext.updateVariant;
      const row = variants.rows.find((v) => v.id === variantId && v.productId === productId);
      return row === undefined ? null : variants.update(variantId, patch);
    },
    async deleteVariant(productId, variantId) {
      if (failNext.deleteVariant) throw failNext.deleteVariant;
      const row = variants.rows.find((v) => v.id === variantId && v.productId === productId);
      return row !== undefined && variants.remove(variantId) ? row : null;
    },
  });
  return { products, variants, audit, service: new ProductsService(repository, audit), failNext, lastProductList, lastVariantList };
}

function seedProduct(s: Setup, over: Partial<ProductRow> = {}): ProductRow {
  return s.products.insert({
    name: 'Odoo ERP', type: 'SOFTWARE', salesPrice: 100000, costPrice: 40000, notes: null, isActive: true,
    createdById: 1, deletedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
  });
}

function seedVariant(s: Setup, productId: number, over: Partial<VariantRow> = {}): VariantRow {
  return s.variants.insert({
    productId, attribute: 'Brand', value: 'Odoo', extraPrice: 56000, isActive: true, createdAt: NOW, updatedAt: NOW, ...over,
  });
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/products', createProductsRouter({
    authService: auth.asAuthService(), productsService: s.service,
  })));
}

interface ProductBody extends ApiBody {
  data: { id: number; costPrice?: number; variants?: unknown[]; createdById?: number | null };
}

const newProduct = { name: 'Odoo ERP', type: 'SOFTWARE', salesPrice: 100000, costPrice: 40000 };

test('RBAC matrix: ADMIN and STAFF read, only ADMIN writes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  const product = seedProduct(s);
  seedVariant(s, product.id);
  seedVariant(s, product.id, { value: 'Other' });
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/products', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/products/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/products', allowed: [Role.ADMIN], body: newProduct, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/products/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'GET', path: '/products/1/variants', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/products/1/variants', allowed: [Role.ADMIN], body: { attribute: 'Color', value: 'Red' }, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/products/1/variants/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/products/1/variants/2', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/products/1', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('staff never receives costPrice, admin does, on get, list and create', async (t) => {
  const s = setup();
  seedProduct(s);
  const srv = await server(t, s);
  const staffGet = await srv.request<ProductBody>('/products/1', { role: Role.STAFF });
  const adminGet = await srv.request<ProductBody>('/products/1', { role: Role.ADMIN });
  assert.equal('costPrice' in staffGet.body.data, false);
  assert.equal(adminGet.body.data.costPrice, 40000);
  const staffList = await srv.request<ApiBody & { data: Record<string, unknown>[] }>('/products', { role: Role.STAFF });
  assert.equal('costPrice' in (staffList.body.data[0] ?? {}), false);
  const adminList = await srv.request<ApiBody & { data: Record<string, unknown>[] }>('/products', { role: Role.ADMIN });
  assert.equal(adminList.body.data[0]?.costPrice, 40000);
  assert.deepEqual(JSON.stringify(staffGet.body).includes('costPrice'), false);
});

test('create: 201 with Location, createdById from the actor, variants in the same call, audited', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ProductBody>('/products', {
    method: 'POST', role: Role.ADMIN,
    body: { ...newProduct, variants: [{ attribute: 'Brand', value: 'Odoo', extraPrice: 56000 }, { attribute: 'Brand', value: 'Other' }] },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/products\/1$/);
  assert.equal(response.body.data.variants?.length, 2);
  assert.equal(s.products.rows[0]?.createdById, 1);
  assert.equal(s.variants.rows[1]?.extraPrice, 0);
  assert.equal(s.variants.rows[1]?.isActive, true);
  assert.deepEqual(s.audit.actions(), ['product.create']);
  assert.equal(s.audit.entries[0]?.metadata?.variantCount, 2);
});

test('create validation: integer paise, no negatives, no unknown keys, no duplicate variants in the body', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/products', { method: 'POST', role: Role.ADMIN, body });
  for (const body of [
    { ...newProduct, salesPrice: -1 }, { ...newProduct, salesPrice: 10.5 }, { ...newProduct, costPrice: -5 },
    { ...newProduct, type: 'OTHER' }, { ...newProduct, name: '' }, { ...newProduct, id: 4 },
    { name: 'X', type: 'ADDON', salesPrice: 1 },
    { ...newProduct, variants: [{ attribute: 'A', value: 'B', extraPrice: -1 }] },
    { ...newProduct, variants: [{ attribute: 'A', value: 'B' }, { attribute: 'a', value: 'b' }] },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  assert.equal((await post({ ...newProduct, salesPrice: 0, costPrice: 0, notes: null })).status, 201);
  assert.equal(s.products.rows.length, 1);
});

test('update: partial, audited with previous values, 404 for unknown or soft-deleted, empty patch rejected', async (t) => {
  const s = setup();
  seedProduct(s);
  seedProduct(s, { deletedAt: NOW });
  const srv = await server(t, s);
  const patch = (id: number, body: unknown) => srv.request<ProductBody>(`/products/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  const ok = await patch(1, { salesPrice: 120000, notes: 'hi' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.costPrice, 40000);
  assert.equal((await patch(1, {})).status, 400);
  assert.equal((await patch(1, { salesPrice: -2 })).status, 400);
  assert.equal((await patch(2, { isActive: false })).status, 404);
  assert.equal((await patch(99, { isActive: false })).status, 404);
  assert.deepEqual(s.audit.entries[0]?.metadata, {
    changes: { salesPrice: 120000, notes: 'hi' }, previous: { salesPrice: 100000, notes: null },
  });
  assert.deepEqual(s.audit.actions(), ['product.update']);
});

test('soft delete hides the product from get, list and its variants, and is audited', async (t) => {
  const s = setup();
  const product = seedProduct(s);
  seedVariant(s, product.id);
  const srv = await server(t, s);
  assert.equal((await srv.request('/products/1', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal(s.products.rows[0]?.deletedAt, NOW);
  assert.equal((await srv.request('/products/1', { role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/products/1/variants', { role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/products/1/variants', { method: 'POST', role: Role.ADMIN, body: { attribute: 'A', value: 'B' } })).status, 404);
  assert.equal((await srv.request('/products/1/variants/1', { method: 'PATCH', role: Role.ADMIN, body: { isActive: false } })).status, 404);
  assert.equal((await srv.request('/products/1/variants/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/products/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  const list = await srv.request<ApiBody & { data: unknown[] }>('/products', { role: Role.STAFF });
  assert.equal(list.body.data.length, 0);
  assert.deepEqual(s.audit.actions(), ['product.delete']);
  assert.equal(s.variants.rows.length, 1);
});

test('list: bounded, strict query, comma type filter, price range, include whitelist, page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) {
    const product = seedProduct(s, { name: `P${i}` });
    seedVariant(s, product.id, { value: `v${i}` });
  }
  const get = (query: string) => srv.request<ApiBody & { data: { id: number; variants?: unknown[] }[] }>(`/products${query}`, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?limit=0', '?page=0', '?sortBy=costPrice', '?sortBy=id', '?sortOrder=up', '?type=NOPE', '?isActive=yes',
    '?bogus=1', '?search=', '?minPrice=-1', '?minPrice=1.5', '?include=lines', '?include=',
  ]) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?type=SOFTWARE,ADDON&isActive=true&search=odoo&minPrice=100&maxPrice=200000&include=variants&sortBy=salesPrice&sortOrder=asc&limit=2');
  assert.equal(ok.status, 200);
  assert.deepEqual(s.lastProductList.at(-1), {
    search: 'odoo', type: ['SOFTWARE', 'ADDON'], isActive: true, minPrice: 100, maxPrice: 200000, include: ['variants'],
  });
  assert.equal(ok.body.data.length, 2);
  assert.equal(ok.body.data[0]?.variants?.length, 1);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const plain = await get('');
  assert.equal('variants' in (plain.body.data[0] ?? {}), false);
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
});

test('variants: create, duplicate 409, update, unique conflict on update, list contract, unknown ids', async (t) => {
  const s = setup();
  seedProduct(s);
  const srv = await server(t, s);
  const create = (body: unknown) => srv.request<ApiBody & { data: { id: number; extraPrice: number } }>('/products/1/variants', { method: 'POST', role: Role.ADMIN, body });
  const first = await create({ attribute: 'Brand', value: 'Odoo', extraPrice: 56000 });
  assert.equal(first.status, 201);
  assert.match(first.headers.get('location') ?? '', /\/products\/1\/variants\/1$/);
  const duplicate = await create({ attribute: 'Brand', value: 'Odoo' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error?.code, 'DUPLICATE');
  for (const body of [{ attribute: 'A' }, { attribute: 'A', value: 'B', extraPrice: -1 }, { attribute: 'A', value: 'B', extraPrice: 1.5 }, { attribute: 'A', value: 'B', productId: 2 }]) {
    assert.equal((await create(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await srv.request('/products/99/variants', { method: 'POST', role: Role.ADMIN, body: { attribute: 'A', value: 'B' } })).status, 404);

  await create({ attribute: 'Brand', value: 'Other' });
  s.failNext.updateVariant = sqlError('23505');
  const conflict = await srv.request<ApiBody>('/products/1/variants/2', { method: 'PATCH', role: Role.ADMIN, body: { value: 'Odoo' } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error?.code, 'DUPLICATE');
  s.failNext.updateVariant = undefined;
  const updated = await srv.request<ApiBody>('/products/1/variants/2', { method: 'PATCH', role: Role.ADMIN, body: { extraPrice: 100 } });
  assert.equal(updated.status, 200);
  assert.equal((await srv.request('/products/1/variants/2', { method: 'PATCH', role: Role.ADMIN, body: {} })).status, 400);
  assert.equal((await srv.request('/products/1/variants/77', { method: 'PATCH', role: Role.ADMIN, body: { isActive: false } })).status, 404);

  const get = (query: string) => srv.request<ApiBody & { data: unknown[] }>(`/products/1/variants${query}`, { role: Role.STAFF });
  for (const bad of ['?limit=101', '?sortBy=createdAt', '?sortBy=id', '?bogus=1', '?isActive=maybe', '?include=variants']) {
    assert.equal((await get(bad)).status, 400, bad);
  }
  const ok = await get('?search=brand&isActive=true&sortBy=extraPrice&sortOrder=desc&limit=1');
  assert.equal(ok.status, 200);
  assert.deepEqual(s.lastVariantList.at(-1), { search: 'brand', isActive: true });
  assert.deepEqual(ok.body.meta, { page: 1, limit: 1, total: 2, totalPages: 2, hasNext: true, hasPrev: false });
  assert.equal((await get('?page=9')).body.data.length, 0);
  assert.deepEqual(s.audit.actions(), ['product.variant.create', 'product.variant.create', 'product.variant.update']);
});

test('variant of another product is not reachable through this product', async (t) => {
  const s = setup();
  seedProduct(s);
  const other = seedProduct(s, { name: 'Other' });
  seedVariant(s, other.id);
  const srv = await server(t, s);
  assert.equal((await srv.request('/products/1/variants/1', { method: 'PATCH', role: Role.ADMIN, body: { isActive: false } })).status, 404);
  assert.equal((await srv.request('/products/1/variants/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.equal(s.variants.rows.length, 1);
});

test('variant delete: 200 and audited, 409 IN_USE when a line references it, 404 when missing', async (t) => {
  const s = setup();
  const product = seedProduct(s);
  seedVariant(s, product.id);
  seedVariant(s, product.id, { value: 'B' });
  const srv = await server(t, s);
  s.failNext.deleteVariant = sqlError('23503');
  const blocked = await srv.request<ApiBody>('/products/1/variants/1', { method: 'DELETE', role: Role.ADMIN });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error?.code, 'IN_USE');
  assert.equal(s.variants.rows.length, 2);
  s.failNext.deleteVariant = undefined;
  assert.equal((await srv.request('/products/1/variants/2', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await srv.request('/products/1/variants/2', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.deepEqual(s.audit.actions(), ['product.variant.delete']);
});

test('raw database errors never reach the client', async (t) => {
  const s = setup();
  seedProduct(s);
  const srv = await server(t, s);
  s.failNext.createVariant = Object.assign(new Error('secret sql detail'), { name: 'SqlQueryError', sqlState: '42P01' });
  const response = await srv.request<ApiBody>('/products/1/variants', { method: 'POST', role: Role.ADMIN, body: { attribute: 'A', value: 'B' } });
  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(response.body).includes('secret sql detail'), false);
});

test('getPricedItem: product price, variant extra price, description, inactivity, wrong product, soft-deleted', async () => {
  const s = setup();
  const product = seedProduct(s, { name: 'Odoo ERP', salesPrice: 100000 });
  const variant = seedVariant(s, product.id, { attribute: 'Brand', value: 'Odoo', extraPrice: 56000 });
  const inactiveVariant = seedVariant(s, product.id, { value: 'Old', isActive: false });
  const inactiveProduct = seedProduct(s, { isActive: false });
  const deleted = seedProduct(s, { deletedAt: NOW });
  const otherVariant = seedVariant(s, inactiveProduct.id, { value: 'X' });

  assert.deepEqual(await s.service.getPricedItem(product.id), {
    productId: product.id, variantId: null, name: 'Odoo ERP', unitPrice: 100000, isActive: true,
  });
  assert.deepEqual(await s.service.getPricedItem(product.id, variant.id), {
    productId: product.id, variantId: variant.id, name: 'Odoo ERP (Brand: Odoo)', unitPrice: 156000, isActive: true,
  });
  assert.equal((await s.service.getPricedItem(product.id, inactiveVariant.id)).isActive, false);
  assert.equal((await s.service.getPricedItem(inactiveProduct.id, otherVariant.id)).isActive, false);
  assert.equal((await s.service.getPricedItem(inactiveProduct.id)).isActive, false);
  await assert.rejects(s.service.getPricedItem(deleted.id), { status: 404 });
  await assert.rejects(s.service.getPricedItem(999), { status: 404 });
  await assert.rejects(s.service.getPricedItem(product.id, otherVariant.id), { status: 404 });
  await assert.rejects(s.service.getPricedItem(product.id, 999), { status: 404 });
});

test('service enforces roles itself', async () => {
  const s = setup();
  seedProduct(s);
  const customer = actorFor(Role.CUSTOMER);
  const staff = actorFor(Role.STAFF);
  const query = { page: 1, limit: 10, sortBy: 'name' as const, sortOrder: 'asc' as const };
  await assert.rejects(s.service.list(customer, query), { status: 403 });
  await assert.rejects(s.service.get(customer, 1), { status: 403 });
  await assert.rejects(s.service.listVariants(customer, 1, { ...query, sortBy: 'attribute' }), { status: 403 });
  await assert.rejects(s.service.create(staff, { ...newProduct, type: 'SOFTWARE', isActive: true }), { status: 403 });
  await assert.rejects(s.service.update(staff, 1, { isActive: false }), { status: 403 });
  await assert.rejects(s.service.remove(staff, 1), { status: 403 });
  await assert.rejects(s.service.createVariant(staff, 1, { attribute: 'A', value: 'B', extraPrice: 0, isActive: true }), { status: 403 });
  await assert.rejects(s.service.updateVariant(staff, 1, 1, { isActive: false }), { status: 403 });
  await assert.rejects(s.service.removeVariant(staff, 1, 1), { status: 403 });
  assert.deepEqual(s.audit.actions(), []);
});
