import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { notFound } from '../../core/errors.js';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import type { PlanRecord, PlansGateway } from '../plans/plans.gateway.js';
import type { CatalogGateway, PricedItem } from '../products/products.gateway.js';
import { createQuotationTemplatesRouter } from './quotation-templates.routes.js';
import type { QuotationTemplatesRepository, TemplateLineRow, TemplateRow } from './quotation-templates.repository.js';
import type { ListTemplatesParams } from './quotation-templates.schema.js';
import { QuotationTemplatesService } from './quotation-templates.service.js';

const NOW = '2026-10-31T00:00:00.000Z';

interface Setup {
  table: InMemoryTable<TemplateRow>;
  lines: TemplateLineRow[];
  audit: RecordingAudit;
  service: QuotationTemplatesService;
  lastList: ListTemplatesParams[];
  plans: Map<number, PlanRecord>;
  /** productId -> { active, variants: variantId -> active } */
  catalog: Map<number, { active: boolean; variants: Map<number, boolean> }>;
  updateCalls: { id: number; lineCount: number | undefined }[];
  failNextUpdate: { value: boolean };
}

function templateData(over: Partial<TemplateRow> = {}): Omit<TemplateRow, 'id'> {
  return {
    name: 'Starter', planId: 1, validityDays: 30, notes: null, isActive: true, createdById: 1,
    createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function planRecord(over: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 1, name: 'Basic', price: 49900, billingPeriod: 'MONTHLY', minQuantity: 1, availableFrom: NOW,
    availableTo: null, autoClose: false, closable: false, pausable: false, renewable: false, isActive: true, ...over,
  };
}

function setup(): Setup {
  const table = new InMemoryTable<TemplateRow>();
  const lines: TemplateLineRow[] = [];
  let nextLineId = 1;
  const audit = new RecordingAudit();
  const lastList: ListTemplatesParams[] = [];
  const plans = new Map<number, PlanRecord>([[1, planRecord()], [2, planRecord({ id: 2, name: 'Dead', isActive: false })]]);
  const catalog: Setup['catalog'] = new Map([
    [10, { active: true, variants: new Map([[100, true], [101, false]]) }],
    [11, { active: true, variants: new Map() }],
    [12, { active: false, variants: new Map() }],
  ]);
  const updateCalls: Setup['updateCalls'] = [];
  const failNextUpdate = { value: false };

  const insertLines = (templateId: number, writes: readonly { productId: number; variantId: number | null; quantity: number; sortOrder: number }[]): TemplateLineRow[] =>
    writes.map((write) => {
      const row: TemplateLineRow = { id: nextLineId, templateId, ...write };
      nextLineId += 1;
      lines.push(row);
      return row;
    });

  const repository = fakeRepository<QuotationTemplatesRepository>({
    async list(query) { lastList.push(query); return paginateRows(table.rows, query.page, query.limit).data; },
    async count() { return table.rows.length; },
    async findById(id) { const row = table.find(id); return row === null ? null : { ...row }; },
    async listLines(templateId) {
      return lines.filter((line) => line.templateId === templateId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    },
    async lookupLabels() {
      return {
        plans: new Map([[1, { name: 'Basic', billingPeriod: 'MONTHLY' as const }]]),
        products: new Map([[10, 'Odoo ERP'], [11, 'Support'], [12, 'Old']]),
        variants: new Map([[100, 'Brand: Odoo'], [101, 'Brand: Old']]),
      };
    },
    async create(input, writes, createdById) {
      const template = table.insert(templateData({
        name: input.name, planId: input.planId, validityDays: input.validityDays, notes: input.notes ?? null,
        isActive: input.isActive, createdById,
      }));
      return { template, lines: insertLines(template.id, writes) };
    },
    async update(id, patch, writes) {
      updateCalls.push({ id, lineCount: writes?.length });
      if (table.find(id) === null) return null;
      // Mimics the transaction: all-or-nothing.
      const snapshot = lines.map((line) => ({ ...line }));
      const { lines: _ignored, ...fields } = patch;
      void _ignored;
      const before = { ...table.find(id) } as TemplateRow;
      const row = table.update(id, fields);
      if (writes !== undefined) {
        for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i]?.templateId === id) lines.splice(i, 1);
        if (failNextUpdate.value) {
          failNextUpdate.value = false;
          lines.splice(0, lines.length, ...snapshot);
          table.update(id, before);
          throw new Error('insert failed');
        }
        insertLines(id, writes);
      }
      return row;
    },
    async softDelete(id) {
      const row = table.find(id);
      return row !== null && table.remove(id) ? row : null;
    },
  });

  const catalogGateway: CatalogGateway = {
    async getPricedItem(productId, variantId): Promise<PricedItem> {
      const product = catalog.get(productId);
      if (product === undefined) throw notFound('Product not found');
      if (variantId !== undefined && !product.variants.has(variantId)) throw notFound('Variant not found');
      const variantActive = variantId === undefined ? true : product.variants.get(variantId) === true;
      return { productId, variantId: variantId ?? null, name: 'x', unitPrice: 100, isActive: product.active && variantActive };
    },
  };
  const plansGateway: PlansGateway = {
    async getById(id) { return plans.get(id) ?? null; },
    async assertAvailable(id) { const plan = plans.get(id); if (plan === undefined) throw notFound(); return plan; },
  };

  return {
    table, lines, audit, lastList, plans, catalog, updateCalls, failNextUpdate,
    service: new QuotationTemplatesService(repository, audit, catalogGateway, plansGateway),
  };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/quotation-templates', createQuotationTemplatesRouter({
    authService: auth.asAuthService(), quotationTemplatesService: s.service,
  })));
}

const valid = { name: 'Pro starter', planId: 1, validityDays: 30, lines: [{ productId: 10, variantId: 100, quantity: 2 }, { productId: 11, quantity: 1 }] };

async function seedTemplate(s: Setup): Promise<void> {
  await s.service.create(actorFor(Role.ADMIN), {
    name: 'Seed', planId: 1, validityDays: 10, isActive: true, lines: [{ productId: 10, quantity: 1 }],
  });
  s.audit.entries.length = 0;
}

test('RBAC matrix: ADMIN and STAFF read, only ADMIN writes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  await seedTemplate(s);
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/quotation-templates', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/quotation-templates/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/quotation-templates', allowed: [Role.ADMIN], body: valid, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/quotation-templates/1', allowed: [Role.ADMIN], body: { isActive: false }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/quotation-templates/1', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create returns 201 with Location, ordered lines with labels, createdById and an audit entry', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: { id: number; isActive: boolean; planName: string; plan: { id: number }; lines: { productName: string; variantLabel: string | null; sortOrder: number }[] } }>(
    '/quotation-templates', { method: 'POST', role: Role.ADMIN, body: { ...valid, lines: [{ productId: 11, quantity: 1, sortOrder: 9 }, valid.lines[0]] } },
  );
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/quotation-templates\/1$/);
  const data = response.body.data;
  assert.equal(data.isActive, true);
  assert.equal(data.planName, 'Basic');
  assert.equal(data.plan.id, 1);
  assert.deepEqual(data.lines.map((line) => [line.productName, line.variantLabel, line.sortOrder]), [['Support', null, 0], ['Odoo ERP', 'Brand: Odoo', 1]]);
  assert.equal(s.table.rows[0]?.createdById, actorFor(Role.ADMIN).userId);
  assert.deepEqual(s.audit.actions(), ['quotationTemplate.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);
});

test('validation: validityDays 1..365, at least one line, quantity >= 1, strict bodies', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/quotation-templates', { method: 'POST', role: Role.ADMIN, body });
  assert.equal((await post({ ...valid, validityDays: 1 })).status, 201);
  assert.equal((await post({ ...valid, validityDays: 365 })).status, 201);
  for (const body of [
    { ...valid, validityDays: 0 }, { ...valid, validityDays: 366 }, { ...valid, validityDays: 1.5 },
    { ...valid, lines: [] }, { ...valid, lines: undefined },
    { ...valid, lines: [{ productId: 10, quantity: 0 }] }, { ...valid, lines: [{ productId: 10, quantity: 1.5 }] },
    { ...valid, lines: [{ productId: 0, quantity: 1 }] }, { ...valid, lines: [{ productId: 10, quantity: 1, extra: 1 }] },
    { ...valid, name: '' }, { ...valid, id: 4 }, { ...valid, planId: undefined },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const patch = (body: unknown) => srv.request<ApiBody>('/quotation-templates/1', { method: 'PATCH', role: Role.ADMIN, body });
  for (const body of [{}, { lines: [] }, { validityDays: 400 }, { unknown: 1 }]) assert.equal((await patch(body)).status, 400);
});

test('inactive or missing products, inactive variants and variants of another product are rejected before any write', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (lines: unknown) => srv.request<ApiBody>('/quotation-templates', { method: 'POST', role: Role.ADMIN, body: { ...valid, lines } });
  for (const lines of [
    [{ productId: 12, quantity: 1 }],
    [{ productId: 10, variantId: 101, quantity: 1 }],
    [{ productId: 11, variantId: 100, quantity: 1 }],
    [{ productId: 10, variantId: 999, quantity: 1 }],
    [{ productId: 999, quantity: 1 }],
    [{ productId: 11, quantity: 1 }, { productId: 12, quantity: 1 }],
  ]) {
    const response = await post(lines);
    assert.equal(response.status, 400, JSON.stringify(lines));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
    assert.match(response.body.error?.details?.[0]?.field ?? '', /^lines\.\d+\.(productId|variantId)$/);
  }
  assert.equal(s.table.rows.length, 0);
  assert.deepEqual(s.audit.actions(), []);
});

test('plan must exist and be active, on create and when PATCH changes planId', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (planId: number) => srv.request<ApiBody>('/quotation-templates', { method: 'POST', role: Role.ADMIN, body: { ...valid, planId } });
  for (const planId of [99, 2]) {
    const response = await post(planId);
    assert.equal(response.status, 400);
    assert.equal(response.body.error?.details?.[0]?.field, 'planId');
  }
  assert.equal(s.table.rows.length, 0);
  assert.equal((await post(1)).status, 201);
  const patch = (body: unknown) => srv.request<ApiBody>('/quotation-templates/1', { method: 'PATCH', role: Role.ADMIN, body });
  assert.equal((await patch({ planId: 2 })).status, 400);
  assert.equal((await patch({ planId: 99 })).status, 400);
  assert.equal(s.table.rows[0]?.planId, 1);
  s.plans.set(3, planRecord({ id: 3 }));
  assert.equal((await patch({ planId: 3 })).status, 200);
  assert.equal(s.table.rows[0]?.planId, 3);
  // Unchanged planId is not re-validated, so a template on a since-deactivated plan can still be renamed.
  s.plans.set(3, planRecord({ id: 3, isActive: false }));
  assert.equal((await patch({ planId: 3, name: 'Renamed' })).status, 200);
});

test('PATCH with lines replaces all lines in one repository call and keeps the old set when it fails', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  await srv.request('/quotation-templates', { method: 'POST', role: Role.ADMIN, body: valid });
  const patch = (body: unknown) => srv.request<ApiBody & { data: { lines: { productId: number; sortOrder: number }[] } }>(
    '/quotation-templates/1', { method: 'PATCH', role: Role.ADMIN, body },
  );

  const replaced = await patch({ lines: [{ productId: 11, quantity: 5 }, { productId: 10, quantity: 1 }, { productId: 10, variantId: 100, quantity: 3 }] });
  assert.equal(replaced.status, 200);
  assert.deepEqual(s.updateCalls, [{ id: 1, lineCount: 3 }]);
  assert.deepEqual(replaced.body.data.lines.map((line) => [line.productId, line.sortOrder]), [[11, 0], [10, 1], [10, 2]]);
  assert.equal(s.lines.length, 3);

  s.failNextUpdate.value = true;
  const failed = await patch({ name: 'Never applied', lines: [{ productId: 11, quantity: 1 }] });
  assert.equal(failed.status, 500);
  assert.deepEqual(s.lines.map((line) => line.productId), [11, 10, 10]);
  assert.equal(s.updateCalls.length, 2);
  assert.deepEqual(s.audit.actions(), ['quotationTemplate.create', 'quotationTemplate.update']);

  const fieldsOnly = await patch({ name: 'Just a name' });
  assert.equal(fieldsOnly.status, 200);
  assert.equal(s.updateCalls.at(-1)?.lineCount, undefined);
  assert.equal(s.lines.length, 3);
  const entry = s.audit.entries.at(-1);
  assert.deepEqual((entry?.metadata as { previous: unknown }).previous, { name: 'Pro starter' });
  assert.equal((await patch({ lines: [{ productId: 12, quantity: 1 }] })).status, 400);
  assert.equal(s.lines.length, 3);
});

test('GET /:id returns lines ordered, 404 for missing, 400 for bad id; soft delete hides the template', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  await seedTemplate(s);
  const found = await srv.request<ApiBody & { data: { lines: unknown[] } }>('/quotation-templates/1', { role: Role.STAFF });
  assert.equal(found.body.data.lines.length, 1);
  assert.equal((await srv.request('/quotation-templates/9', { role: Role.STAFF })).status, 404);
  assert.equal((await srv.request('/quotation-templates/abc', { role: Role.STAFF })).status, 400);

  assert.equal((await srv.request('/quotation-templates/1', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await srv.request('/quotation-templates/1', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/quotation-templates/1', { role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/quotation-templates/1', { method: 'PATCH', role: Role.ADMIN, body: { name: 'x' } })).status, 404);
  assert.deepEqual(s.audit.actions(), ['quotationTemplate.delete']);
});

test('list: bounded, strict query, planId and isActive filters, search, page past the end', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (let i = 1; i <= 3; i += 1) s.table.insert(templateData({ name: `T${i}` }));
  const get = (query: string) => srv.request<ApiBody & { data: { planName: string }[] }>(`/quotation-templates${query}`, { role: Role.STAFF });
  for (const bad of ['?limit=101', '?limit=0', '?page=0', '?sortBy=id', '?sortBy=notes', '?sortOrder=up', '?planId=abc', '?planId=0', '?isActive=yes', '?bogus=1', '?search=']) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?planId=1&isActive=true&search=T&sortBy=validityDays&sortOrder=asc&limit=2');
  assert.equal(ok.status, 200);
  const q = s.lastList.at(-1);
  assert.equal(q?.planId, 1);
  assert.equal(q?.isActive, true);
  assert.equal(q?.search, 'T');
  assert.equal(q?.sortBy, 'validityDays');
  assert.equal(ok.body.data.length, 2);
  assert.equal(ok.body.data[0]?.planName, 'Basic');
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
});

test('gateway getWithLines returns the lean shape, null when missing or deleted, and exposes isActive', async () => {
  const s = setup();
  await s.service.create(actorFor(Role.ADMIN), {
    name: 'G', planId: 1, validityDays: 7, isActive: false, notes: 'n',
    lines: [{ productId: 10, variantId: 100, quantity: 2 }, { productId: 11, quantity: 1 }],
  });
  const record = await s.service.getWithLines(1);
  assert.deepEqual(record, {
    id: 1, name: 'G', planId: 1, validityDays: 7, notes: 'n', isActive: false,
    lines: [
      { productId: 10, variantId: 100, quantity: 2, sortOrder: 0 },
      { productId: 11, variantId: null, quantity: 1, sortOrder: 1 },
    ],
  });
  assert.equal(await s.service.getWithLines(42), null);
  await s.service.remove(actorFor(Role.ADMIN), 1);
  assert.equal(await s.service.getWithLines(1), null);
});

test('service enforces roles itself', async () => {
  const s = setup();
  await seedTemplate(s);
  const params: ListTemplatesParams = { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' };
  await assert.rejects(s.service.list(actorFor(Role.CUSTOMER), params), { status: 403 });
  await assert.rejects(s.service.get(actorFor(Role.CUSTOMER), 1), { status: 403 });
  await assert.rejects(s.service.update(actorFor(Role.STAFF), 1, { isActive: false }), { status: 403 });
  await assert.rejects(s.service.remove(actorFor(Role.STAFF), 1), { status: 403 });
  await assert.rejects(s.service.create(actorFor(Role.STAFF), { ...valid, isActive: true }), { status: 403 });
  assert.equal((await s.service.list(actorFor(Role.STAFF), params)).templates.length, 1);
  assert.equal(s.audit.entries.length, 0);
});
