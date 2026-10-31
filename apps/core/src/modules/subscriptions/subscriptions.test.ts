import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role, SubscriptionStatus, type SubscriptionDto } from '@brightloop/shared';
import { notFound } from '../../core/errors.js';
import { FakeAuthService, TEST_CUSTOMER_ID, actorFor } from '../../core/testing/test-auth.js';
import { FakeSequenceGateway, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import type { Actor } from '../../core/utils/actor.js';
import { toIsoDate } from '../../core/utils/dates.js';
import { planNotAvailable } from '../../core/utils/domain-errors.js';
import type { CustomerRecord, CustomersGateway } from '../customers/customers.gateway.js';
import type { DiscountsGateway } from '../discounts/discounts.gateway.js';
import type { PaymentTermRecord, PaymentTermsGateway } from '../payment-terms/payment-terms.gateway.js';
import type { PlanRecord, PlansGateway } from '../plans/plans.gateway.js';
import type { CatalogGateway } from '../products/products.gateway.js';
import type { TemplatesGateway, TemplateWithLines } from '../quotation-templates/quotation-templates.gateway.js';
import type { TaxRecord, TaxesGateway } from '../taxes/taxes.gateway.js';
import { ACTION_SOURCES, type TransitionAction } from './subscriptions.dto.js';
import type {
  InvoiceSummaryRow, LineWrite, StatusHistoryRow, SubscriptionLineRow, SubscriptionRow, SubscriptionsRepository,
} from './subscriptions.repository.js';
import { createSubscriptionsRouter } from './subscriptions.routes.js';
import type { ListSubscriptionsParams } from './subscriptions.schema.js';
import { SubscriptionsService } from './subscriptions.service.js';

const NOW = '2026-10-31T10:00:00.000Z';
const STAFF = actorFor(Role.STAFF);
const ADMIN = actorFor(Role.ADMIN);
const CUSTOMER = actorFor(Role.CUSTOMER);
const ALL_STATUSES = Object.values(SubscriptionStatus);
type Status = SubscriptionStatus;

interface World {
  rows: SubscriptionRow[];
  deleted: Set<number>;
  lines: SubscriptionLineRow[];
  history: StatusHistoryRow[];
  invoices: InvoiceSummaryRow[];
  listCalls: { query: ListSubscriptionsParams; scope: unknown }[];
  failNextCreate: { error: unknown };
  failNextReplace: { value: boolean };
}

interface Setup {
  world: World;
  audit: RecordingAudit;
  service: SubscriptionsService;
  clock: { value: Date };
  plans: Map<number, PlanRecord>;
  prices: Map<number, { name: string; price: number; active: boolean }>;
  taxes: Map<number, TaxRecord>;
  terms: Map<number, PaymentTermRecord>;
  templates: Map<number, TemplateWithLines>;
  customerIds: Set<number>;
  defaultTermId: { value: number | null };
}

function plan(over: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 1, name: 'Pro', price: 1000, billingPeriod: 'MONTHLY', minQuantity: 1,
    availableFrom: '2026-01-01T00:00:00.000Z', availableTo: '2030-12-31T00:00:00.000Z',
    autoClose: false, closable: true, pausable: true, renewable: true, isActive: true, ...over,
  };
}

function customerRecord(id: number): CustomerRecord {
  return {
    id, userId: null, name: `Customer ${id}`, companyName: null, email: `c${id}@x.test`, phone: null, taxId: null,
    addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null,
  };
}

function subscriptionRow(over: Partial<SubscriptionRow> = {}): Omit<SubscriptionRow, 'id'> {
  return {
    number: 'SUB-SEED', customerId: TEST_CUSTOMER_ID, planId: 1, templateId: null, paymentTermId: null,
    status: 'DRAFT', startDate: '2026-01-31T00:00:00.000Z', expiryDate: '2027-01-31T00:00:00.000Z',
    quotationValidUntil: null, nextBillingDate: null, lastBilledUntil: null, confirmedAt: null, activatedAt: null,
    pausedAt: null, closedAt: null, closeReason: null, renewedFromId: null, subtotal: 20000, taxTotal: 0,
    total: 20000, recurringAmount: 20000, notes: null, createdById: 1, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

function setup(): Setup {
  const world: World = {
    rows: [], deleted: new Set(), lines: [], history: [], invoices: [], listCalls: [],
    failNextCreate: { error: null }, failNextReplace: { value: false },
  };
  let nextLineId = 1_000;
  let nextHistoryId = 1;
  const audit = new RecordingAudit();
  const clock = { value: new Date(NOW) };
  const plans = new Map<number, PlanRecord>([
    [1, plan()],
    [2, plan({ id: 2, name: 'Locked', closable: false, pausable: false, renewable: false })],
    [3, plan({ id: 3, name: 'Bulk', minQuantity: 5 })],
    [4, plan({ id: 4, name: 'Auto', autoClose: true })],
  ]);
  const prices = new Map([
    [10, { name: 'Odoo ERP', price: 10000, active: true }],
    [11, { name: 'Old', price: 500, active: false }],
    [12, { name: 'Support', price: 33333, active: true }],
  ]);
  const taxes = new Map<number, TaxRecord>([
    [1, { id: 1, name: 'GST 18%', type: 'PERCENTAGE', rate: 1800, isActive: true }],
    [2, { id: 2, name: 'Env fee', type: 'FIXED', rate: 500, isActive: true }],
    [3, { id: 3, name: 'Old tax', type: 'PERCENTAGE', rate: 500, isActive: false }],
  ]);
  const terms = new Map<number, PaymentTermRecord>([
    [1, { id: 1, name: 'Net 30', dueDays: 30, isDefault: true, isActive: true }],
    [2, { id: 2, name: 'Old', dueDays: 7, isDefault: false, isActive: false }],
  ]);
  const templates = new Map<number, TemplateWithLines>([
    [1, { id: 1, name: 'Starter', planId: 1, validityDays: 14, notes: 'from template', isActive: true, lines: [
      { productId: 10, variantId: null, quantity: 2, sortOrder: 0 }, { productId: 12, variantId: null, quantity: 1, sortOrder: 1 },
    ] }],
    [2, { id: 2, name: 'Dead', planId: 1, validityDays: 5, notes: null, isActive: false, lines: [] }],
  ]);
  const customerIds = new Set<number>([1, TEST_CUSTOMER_ID, 2002]);
  const defaultTermId = { value: 1 as number | null };

  const live = (row: SubscriptionRow): boolean => !world.deleted.has(row.id);
  const sortedLines = (id: number): SubscriptionLineRow[] =>
    world.lines.filter((line) => line.subscriptionId === id).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const insertLines = (id: number, writes: readonly LineWrite[]): void => {
    for (const write of writes) {
      world.lines.push({ id: nextLineId, subscriptionId: id, ...write });
      nextLineId += 1;
    }
  };
  const iso = (value: Date | null | undefined): string | null => (value === undefined || value === null ? null : value.toISOString());

  const repository = fakeRepository<SubscriptionsRepository>({
    async list(query, scope) {
      world.listCalls.push({ query, scope });
      const rows = world.rows.filter((row) => live(row)
        && (scope.customerId ?? query.customerId ?? row.customerId) === row.customerId
        && !(scope.hideDrafts === true && row.status === 'DRAFT')
        && (query.status === undefined || query.status.includes(row.status))
        && (query.search === undefined || row.number.toLowerCase().includes(query.search.toLowerCase())))
        .sort((a, b) => b.id - a.id);
      return paginateRows(rows, query.page, query.limit).data.map((row) => ({ ...row }));
    },
    async count(query, scope) {
      return world.rows.filter((row) => live(row)
        && (scope.customerId ?? query.customerId ?? row.customerId) === row.customerId
        && !(scope.hideDrafts === true && row.status === 'DRAFT')).length;
    },
    async findById(id, scope = {}) {
      const row = world.rows.find((candidate) => candidate.id === id);
      if (row === undefined || !live(row)) return null;
      if (scope.customerId !== undefined && row.customerId !== scope.customerId) return null;
      if (scope.hideDrafts === true && row.status === 'DRAFT') return null;
      return { ...row };
    },
    async listLines(id) { return sortedLines(id).map((line) => ({ ...line })); },
    async listLinesFor(ids) { return world.lines.filter((line) => ids.includes(line.subscriptionId)).map((line) => ({ ...line })); },
    async countLines(id) { return sortedLines(id).length; },
    async listHistory(id) { return world.history.filter((entry) => entry.subscriptionId === id).map((entry) => ({ ...entry })); },
    async listRecentInvoices(id, limit) { return world.invoices.filter((invoice) => invoice.id % 1000 === id).slice(0, limit); },
    async hasOpenRenewal(id) {
      return world.rows.some((row) => row.renewedFromId === id && live(row) && row.status !== 'CLOSED');
    },
    async findPaymentTerm(id) {
      const term = terms.get(id);
      return term === undefined ? null : { ...term, createdAt: NOW, updatedAt: NOW };
    },
    async lookupLabels(request) {
      const wanted = <T>(source: readonly number[] | undefined, map: Map<number, T>): [number, T][] =>
        [...new Set(source ?? [])].flatMap((id) => { const value = map.get(id); return value === undefined ? [] : [[id, value] as [number, T]]; });
      return {
        customers: new Map(wanted(request.customerIds, new Map([...customerIds].map((id) => [id, customerRecord(id)] as const)))
          .map(([id, c]) => [id, { id, name: c.name, companyName: c.companyName, email: c.email }])),
        plans: new Map(wanted(request.planIds, plans).map(([id, p]) => [id, {
          id, name: p.name, billingPeriod: p.billingPeriod, minQuantity: p.minQuantity, autoClose: p.autoClose,
          pausable: p.pausable, closable: p.closable, renewable: p.renewable,
        }])),
        products: new Map(wanted(request.productIds, prices).map(([id, p]) => [id, p.name])),
        variants: new Map(),
        taxes: new Map(wanted(request.taxIds, taxes).map(([id, tax]) => [id, tax.name])),
        users: new Map((request.userIds ?? []).map((id) => [id, `User ${id}`])),
      };
    },
    async create(data, lines, history) {
      const failure = world.failNextCreate.error;
      if (failure !== null) {
        world.failNextCreate.error = null;
        throw failure;
      }
      const row: SubscriptionRow = {
        id: world.rows.length + 1, number: data.number, customerId: data.customerId, planId: data.planId, templateId: data.templateId,
        paymentTermId: data.paymentTermId, status: data.status, startDate: data.startDate.toISOString(),
        expiryDate: iso(data.expiryDate), quotationValidUntil: iso(data.quotationValidUntil),
        nextBillingDate: iso(data.nextBillingDate), lastBilledUntil: null, confirmedAt: iso(data.confirmedAt),
        activatedAt: iso(data.activatedAt), pausedAt: null, closedAt: null, closeReason: null,
        renewedFromId: data.renewedFromId, subtotal: data.subtotal, taxTotal: data.taxTotal, total: data.total,
        recurringAmount: data.recurringAmount, notes: data.notes, createdById: data.createdById,
        createdAt: NOW, updatedAt: NOW,
      };
      world.rows.push(row);
      insertLines(row.id, lines);
      world.history.push({ id: nextHistoryId, subscriptionId: row.id, createdAt: NOW, ...history });
      nextHistoryId += 1;
      return { ...row };
    },
    // Check-and-set with no await in between, like the real conditional UPDATE.
    async transition(id, expected, toStatus, fields, history) {
      const row = world.rows.find((candidate) => candidate.id === id);
      if (row === undefined || !live(row) || row.status !== expected) return null;
      row.status = toStatus;
      if (fields.quotationValidUntil !== undefined) row.quotationValidUntil = iso(fields.quotationValidUntil);
      if (fields.confirmedAt !== undefined) row.confirmedAt = iso(fields.confirmedAt);
      if (fields.activatedAt !== undefined) row.activatedAt = iso(fields.activatedAt);
      if (fields.pausedAt !== undefined) row.pausedAt = iso(fields.pausedAt);
      if (fields.closedAt !== undefined) row.closedAt = iso(fields.closedAt);
      if (fields.closeReason !== undefined) row.closeReason = fields.closeReason;
      if (fields.nextBillingDate !== undefined) row.nextBillingDate = iso(fields.nextBillingDate);
      world.history.push({ id: nextHistoryId, subscriptionId: id, createdAt: NOW, ...history });
      nextHistoryId += 1;
      return { ...row };
    },
    async update(id, expected, fields, replacement) {
      const row = world.rows.find((candidate) => candidate.id === id);
      if (row === undefined || !live(row) || row.status !== expected) return null;
      if (replacement !== undefined && world.failNextReplace.value) {
        world.failNextReplace.value = false;
        throw new Error('line insert failed');
      }
      if (fields.planId !== undefined) row.planId = fields.planId;
      if (fields.startDate !== undefined) row.startDate = fields.startDate.toISOString();
      if (fields.expiryDate !== undefined) row.expiryDate = iso(fields.expiryDate);
      if (fields.paymentTermId !== undefined) row.paymentTermId = fields.paymentTermId;
      if (fields.notes !== undefined) row.notes = fields.notes;
      if (replacement !== undefined) {
        world.lines = world.lines.filter((line) => line.subscriptionId !== id);
        insertLines(id, replacement.lines);
        Object.assign(row, replacement.totals);
      }
      return { ...row };
    },
    async softDeleteDraft(id) {
      const row = world.rows.find((candidate) => candidate.id === id);
      if (row === undefined || !live(row) || row.status !== 'DRAFT') return null;
      world.deleted.add(id);
      return { ...row };
    },
    async listDueRows(asOf, afterId, limit) {
      return world.rows
        .filter((row) => live(row) && row.status === 'ACTIVE' && row.nextBillingDate !== null
          && new Date(row.nextBillingDate).getTime() <= asOf.getTime() && row.id > afterId)
        .sort((a, b) => a.id - b.id).slice(0, limit)
        .map((row) => ({ id: row.id, nextBillingDate: row.nextBillingDate, expiryDate: row.expiryDate }));
    },
    async listAutoCloseIds(before) {
      return world.rows
        .filter((row) => live(row) && row.status === 'ACTIVE' && row.expiryDate !== null
          && new Date(row.expiryDate).getTime() < before.getTime() && plans.get(row.planId)?.autoClose === true)
        .map((row) => row.id);
    },
  });

  const customers: CustomersGateway = {
    async getById(id) { return customerIds.has(id) ? customerRecord(id) : null; },
    async getOrCreateForUser() { throw notFound(); },
    async snapshot() { throw notFound(); },
  };
  const catalog: CatalogGateway = {
    async getPricedItem(productId, variantId) {
      const product = prices.get(productId);
      if (product === undefined || variantId !== undefined) throw notFound('Product not found');
      return { productId, variantId: null, name: product.name, unitPrice: product.price, isActive: product.active };
    },
  };
  const taxesGateway: TaxesGateway = {
    async getByIds(ids) { return ids.flatMap((id) => { const tax = taxes.get(id); return tax === undefined ? [] : [tax]; }); },
  };
  const paymentTerms: PaymentTermsGateway = {
    async getById(id) { return terms.get(id) ?? null; },
    async getDefault() { return defaultTermId.value === null ? null : terms.get(defaultTermId.value) ?? null; },
  };
  const plansGateway: PlansGateway = {
    async getById(id) { return plans.get(id) ?? null; },
    async assertAvailable(id, date) {
      const found = plans.get(id);
      if (found === undefined) throw notFound('Plan not found');
      const day = toIsoDate(date);
      if (!found.isActive || day < found.availableFrom.slice(0, 10) || (found.availableTo !== null && day > found.availableTo.slice(0, 10))) {
        throw planNotAvailable();
      }
      return found;
    },
  };
  const templatesGateway: TemplatesGateway = { async getWithLines(id) { return templates.get(id) ?? null; } };
  const discounts: DiscountsGateway = {
    async evaluate() { return []; },
    async listAttachedForSubscription() {
      return [{ id: 7, name: 'Loyalty', code: 'LOYAL', type: 'PERCENTAGE', value: 500, scope: 'SUBSCRIPTION' }];
    },
  };

  return {
    world, audit, clock, plans, prices, taxes, terms, templates, customerIds, defaultTermId,
    service: new SubscriptionsService(
      repository, audit, new FakeSequenceGateway(2026), customers, catalog, taxesGateway, paymentTerms,
      plansGateway, templatesGateway, discounts, () => new Date(clock.value),
    ),
  };
}

/** Inserts a subscription directly (with `lineCount` lines of quantity `quantity`), bypassing the service. */
function seed(s: Setup, over: Partial<SubscriptionRow> = {}, lineCount = 1, quantity = 2): SubscriptionRow {
  const id = s.world.rows.length + 1;
  const row: SubscriptionRow = { id, ...subscriptionRow(over), ...over };
  s.world.rows.push(row);
  for (let i = 0; i < lineCount; i += 1) {
    s.world.lines.push({
      id: s.world.lines.length + 1, subscriptionId: id, productId: 10, variantId: null, taxId: 1,
      description: 'Odoo ERP', quantity, unitPrice: 10000, taxRate: 1800, taxAmount: 3600, amount: 20000, sortOrder: i,
    });
  }
  return row;
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/subscriptions', createSubscriptionsRouter({
    authService: auth.asAuthService(), subscriptionsService: s.service,
  })));
}

const createBody = {
  customerId: TEST_CUSTOMER_ID, planId: 1, startDate: '2026-11-01', expiryDate: '2027-11-01',
  lines: [{ productId: 10, taxId: 1, quantity: 2 }],
};

const listParams: ListSubscriptionsParams = { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' };

const ACTIONS: Record<TransitionAction, (s: Setup, id: number, actor?: Actor) => Promise<unknown>> = {
  SEND_QUOTATION: (s, id, actor = STAFF) => s.service.sendQuotation(actor, id),
  CONFIRM: (s, id, actor = STAFF) => s.service.confirm(actor, id),
  ACTIVATE: (s, id, actor = STAFF) => s.service.activate(actor, id),
  PAUSE: (s, id, actor = STAFF) => s.service.pause(actor, id),
  RESUME: (s, id, actor = STAFF) => s.service.resume(actor, id),
  CLOSE: (s, id, actor = STAFF) => s.service.close(actor, id, { reason: 'because' }),
  RENEW: (s, id, actor = STAFF) => s.service.renew(actor, id, {}),
};

const TARGET: Record<Exclude<TransitionAction, 'RENEW'>, Status> = {
  SEND_QUOTATION: 'QUOTATION', CONFIRM: 'CONFIRMED', ACTIVATE: 'ACTIVE', PAUSE: 'PAUSED', RESUME: 'ACTIVE', CLOSE: 'CLOSED',
};

async function failure(promise: Promise<unknown>): Promise<{ status?: number; code?: string; details?: { field: string }[] }> {
  try {
    await promise;
  } catch (error) {
    return error as { status?: number; code?: string };
  }
  throw new Error('Expected the promise to reject');
}

test('RBAC matrix: A and S use every route, DELETE is A only, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  for (let i = 0; i < 4; i += 1) seed(s);
  const body = { reason: 'x' };
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/subscriptions', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/subscriptions/from-template', allowed: [Role.ADMIN, Role.STAFF], body: { templateId: 1, customerId: TEST_CUSTOMER_ID, startDate: '2026-11-01' }, expectedAllowedStatus: 201 },
    { method: 'POST', path: '/subscriptions', allowed: [Role.ADMIN, Role.STAFF], body: createBody, expectedAllowedStatus: 201 },
    { method: 'GET', path: '/subscriptions/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'PATCH', path: '/subscriptions/1', allowed: [Role.ADMIN, Role.STAFF], body: { notes: 'n' }, expectedAllowedStatus: 200 },
    { method: 'POST', path: '/subscriptions/2/send-quotation', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/subscriptions/2/confirm', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/subscriptions/2/activate', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/subscriptions/2/pause', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/subscriptions/2/resume', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/subscriptions/2/close', allowed: [Role.ADMIN, Role.STAFF], body },
    { method: 'POST', path: '/subscriptions/2/renew', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'DELETE', path: '/subscriptions/3', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create: DRAFT with history, createdById, number from the sequence, default payment term, snapshots and totals', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: SubscriptionDto }>('/subscriptions', {
    method: 'POST', role: Role.STAFF,
    body: { ...createBody, lines: [{ productId: 12, taxId: 1, quantity: 1 }, { productId: 10, taxId: 2, quantity: 3, description: 'Custom' }, { productId: 10, quantity: 1 }] },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/subscriptions\/1$/);
  const sub = response.body.data;
  assert.equal(sub.number, 'SUB-2026-000001');
  assert.equal(sub.status, 'DRAFT');
  assert.equal(sub.createdById, actorFor(Role.STAFF).userId);
  assert.equal(sub.paymentTermId, 1);
  assert.equal(sub.paymentTerm?.name, 'Net 30');
  assert.equal(sub.nextBillingDate, null);
  assert.equal(sub.startDate, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(sub.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.changedById]), [[null, 'DRAFT', actorFor(Role.STAFF).userId]]);
  // 18% of 33333 = 5999.94 -> 6000 (rounded per line); FIXED 500/unit * 3 = 1500; no tax on the third line.
  assert.deepEqual(sub.lines.map((l) => [l.unitPrice, l.taxRate, l.taxAmount, l.amount, l.sortOrder]), [
    [33333, 1800, 6000, 33333, 0], [10000, 500, 1500, 30000, 1], [10000, 0, 0, 10000, 2],
  ]);
  assert.equal(sub.lines[1]?.description, 'Custom');
  assert.equal(sub.lines[0]?.description, 'Support');
  assert.equal(sub.subtotal, 73333);
  assert.equal(sub.taxTotal, 7500);
  assert.equal(sub.total, 80833);
  assert.equal(sub.recurringAmount, sub.total);
  assert.equal(sub.total, sub.lines.reduce((sum, l) => sum + l.amount + l.taxAmount, 0));
  assert.equal(sub.discounts[0]?.code, 'LOYAL');
  assert.deepEqual(s.audit.actions(), ['subscription.create']);
  assert.equal(s.audit.entries[0]?.entityId, 1);

  s.defaultTermId.value = null;
  const none = await s.service.create(STAFF, { ...createBody, startDate: new Date('2026-11-01T00:00:00Z'), expiryDate: null, lines: [] });
  assert.equal(none.paymentTermId, null);
  const explicit = await s.service.create(STAFF, { ...createBody, startDate: new Date('2026-11-01T00:00:00Z'), expiryDate: null, paymentTermId: null, lines: [] });
  assert.equal(explicit.paymentTermId, null);
});

test('validation: strict bodies (no unitPrice/taxRate), dates, ids, inactive or unknown references', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/subscriptions', { method: 'POST', role: Role.STAFF, body });
  for (const body of [
    { ...createBody, lines: [{ productId: 10, quantity: 1, unitPrice: 1 }] },
    { ...createBody, lines: [{ productId: 10, quantity: 1, taxRate: 0 }] },
    { ...createBody, total: 5 }, { ...createBody, status: 'ACTIVE' }, { ...createBody, number: 'X' },
    { ...createBody, lines: [{ productId: 10, quantity: 0 }] }, { ...createBody, lines: [{ productId: 10, quantity: 1.5 }] },
    { ...createBody, startDate: 'tomorrow' }, { ...createBody, startDate: '2026-02-30' },
    { ...createBody, expiryDate: '2026-11-01' }, { ...createBody, expiryDate: '2026-10-01' },
    { ...createBody, customerId: 0 }, { ...createBody, planId: undefined }, { ...createBody, lines: undefined },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const semantic = async (body: unknown, field: string) => {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(response.body.error?.details?.some((d) => d.field === field), `${field} in ${JSON.stringify(response.body.error)}`);
  };
  await semantic({ ...createBody, customerId: 99 }, 'customerId');
  await semantic({ ...createBody, planId: 99 }, 'planId');
  await semantic({ ...createBody, paymentTermId: 2 }, 'paymentTermId');
  await semantic({ ...createBody, paymentTermId: 99 }, 'paymentTermId');
  await semantic({ ...createBody, lines: [{ productId: 11, quantity: 1 }] }, 'lines.0.productId');
  await semantic({ ...createBody, lines: [{ productId: 99, quantity: 1 }] }, 'lines.0.productId');
  await semantic({ ...createBody, lines: [{ productId: 10, variantId: 5, quantity: 1 }] }, 'lines.0.variantId');
  await semantic({ ...createBody, lines: [{ productId: 10, taxId: 3, quantity: 1 }] }, 'lines.0.taxId');
  await semantic({ ...createBody, lines: [{ productId: 10, taxId: 99, quantity: 1 }] }, 'lines.0.taxId');
  await semantic({ ...createBody, lines: [{ productId: 10, quantity: 1 }, { productId: 11, quantity: 1 }] }, 'lines.1.productId');
  await semantic({ ...createBody, lines: [{ productId: 12, quantity: 2147483647 }] }, 'lines.0.quantity');
  assert.equal(s.world.rows.length, 0);
  assert.deepEqual(s.audit.actions(), []);
});

test('plan rules on create: autoClose needs an expiry date, availability window, minimum quantity per line', async () => {
  const s = setup();
  const base = { ...createBody, startDate: new Date('2026-11-01T00:00:00Z'), expiryDate: new Date('2027-11-01T00:00:00Z') };
  const noExpiry = await failure(s.service.create(STAFF, { ...base, planId: 4, expiryDate: null }));
  assert.equal(noExpiry.status, 400);
  assert.equal(noExpiry.details?.[0]?.field, 'expiryDate');
  assert.equal((await s.service.create(STAFF, { ...base, planId: 4 })).planId, 4);

  const early = await failure(s.service.create(STAFF, { ...base, startDate: new Date('2025-12-31T00:00:00Z') }));
  assert.deepEqual([early.status, early.code], [409, 'PLAN_NOT_AVAILABLE']);
  assert.equal((await s.service.create(STAFF, { ...base, startDate: new Date('2026-01-01T00:00:00Z') })).status, 'DRAFT');
  assert.equal((await s.service.create(STAFF, { ...base, startDate: new Date('2030-12-31T00:00:00Z'), expiryDate: null })).status, 'DRAFT');
  const late = await failure(s.service.create(STAFF, { ...base, startDate: new Date('2031-01-01T00:00:00Z'), expiryDate: null }));
  assert.equal(late.code, 'PLAN_NOT_AVAILABLE');
  s.plans.set(1, plan({ isActive: false }));
  assert.equal((await failure(s.service.create(STAFF, base))).code, 'PLAN_NOT_AVAILABLE');
  s.plans.set(1, plan());

  const small = await failure(s.service.create(STAFF, { ...base, planId: 3, lines: [{ productId: 10, quantity: 5 }, { productId: 10, quantity: 4 }] }));
  assert.equal(small.status, 400);
  assert.deepEqual(small.details?.map((d) => d.field), ['lines.1.quantity']);
  assert.equal((await s.service.create(STAFF, { ...base, planId: 3, lines: [{ productId: 10, quantity: 5 }] })).planId, 3);
});

test('create-from-template copies plan and lines, stores templateId, rejects inactive or missing templates', async () => {
  const s = setup();
  const sub = await s.service.createFromTemplate(STAFF, {
    templateId: 1, customerId: TEST_CUSTOMER_ID, startDate: new Date('2026-11-01T00:00:00Z'),
  });
  assert.equal(sub.templateId, 1);
  assert.equal(sub.planId, 1);
  assert.equal(sub.notes, 'from template');
  assert.deepEqual(sub.lines.map((l) => [l.productId, l.quantity, l.taxId, l.unitPrice]), [[10, 2, null, 10000], [12, 1, null, 33333]]);
  assert.equal(sub.total, 53333);
  assert.equal((await failure(s.service.createFromTemplate(STAFF, { templateId: 2, customerId: 1, startDate: new Date('2026-11-01T00:00:00Z') }))).status, 400);
  assert.equal((await failure(s.service.createFromTemplate(STAFF, { templateId: 9, customerId: 1, startDate: new Date('2026-11-01T00:00:00Z') }))).status, 404);
});

test('database errors become domain errors; unknown failures are not leaked', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  s.world.failNextCreate.error = Object.assign(new Error('duplicate key value violates unique constraint "Subscription_number_key"'), { sqlState: '23505' });
  const dup = await srv.request<ApiBody>('/subscriptions', { method: 'POST', role: Role.STAFF, body: createBody });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error?.code, 'DUPLICATE');
  assert.ok(!JSON.stringify(dup.body).includes('Subscription_number_key'));
  s.world.failNextCreate.error = Object.assign(new Error('insert or update violates foreign key constraint "secret_fk"'), { sqlState: '23503' });
  const fk = await srv.request<ApiBody>('/subscriptions', { method: 'POST', role: Role.STAFF, body: createBody });
  assert.equal(fk.body.error?.code, 'IN_USE');
  s.world.failNextCreate.error = new Error('connection string postgres://user:pw@host');
  const raw = await srv.request<ApiBody>('/subscriptions', { method: 'POST', role: Role.STAFF, body: createBody });
  assert.equal(raw.status, 500);
  assert.ok(!JSON.stringify(raw.body).includes('postgres://'));
});

test('state machine: every action from every status (table-driven), history and audit written on success', async () => {
  const actions = Object.keys(ACTION_SOURCES) as TransitionAction[];
  let combinations = 0;
  for (const action of actions) {
    for (const status of ALL_STATUSES) {
      const s = setup();
      const row = seed(s, { status, nextBillingDate: status === 'ACTIVE' ? '2026-10-01T00:00:00.000Z' : null });
      const historyBefore = s.world.history.length;
      const rowsBefore = s.world.rows.length;
      combinations += 1;
      const label = `${action} from ${status}`;
      if (ACTION_SOURCES[action].includes(status)) {
        await ACTIONS[action](s, row.id);
        assert.deepEqual(s.audit.actions(), [action === 'SEND_QUOTATION' ? 'subscription.sendQuotation' : `subscription.${action.toLowerCase()}`], label);
        if (action === 'RENEW') {
          assert.equal(s.world.rows.length, rowsBefore + 1, label);
          assert.equal(s.world.rows.at(-1)?.status, 'DRAFT', label);
          assert.equal(s.world.rows.at(-1)?.renewedFromId, row.id, label);
          assert.equal(s.world.rows.find((r) => r.id === row.id)?.status, status, label);
        } else {
          assert.equal(s.world.rows.find((r) => r.id === row.id)?.status, TARGET[action], label);
          const entry = s.world.history.at(-1);
          assert.deepEqual([s.world.history.length, entry?.fromStatus, entry?.toStatus, entry?.changedById], [historyBefore + 1, status, TARGET[action], STAFF.userId], label);
        }
      } else {
        const error = await failure(ACTIONS[action](s, row.id));
        assert.deepEqual([error.status, error.code], [409, 'INVALID_STATE_TRANSITION'], label);
        assert.equal(s.world.history.length, historyBefore, label);
        assert.equal(s.world.rows.length, rowsBefore, label);
        assert.equal(s.world.rows.find((r) => r.id === row.id)?.status, status, label);
        assert.deepEqual(s.audit.actions(), [], label);
      }
    }
  }
  assert.equal(combinations, 7 * 6);
});

test('transition side effects: confirmedAt, activate sets nextBillingDate = startDate, close clears it and stores the reason', async () => {
  const s = setup();
  const sub = await s.service.create(STAFF, { ...createBody, startDate: new Date('2026-11-15T00:00:00Z'), expiryDate: null, lines: [{ productId: 10, quantity: 1 }] });
  const sent = await s.service.sendQuotation(STAFF, sub.id);
  assert.equal(sent.status, 'QUOTATION');
  assert.equal(sent.quotationValidUntil, null);
  const confirmed = await s.service.confirm(STAFF, sub.id);
  assert.equal(confirmed.confirmedAt, NOW);
  assert.equal(confirmed.nextBillingDate, null);
  const active = await s.service.activate(STAFF, sub.id);
  assert.equal(active.activatedAt, NOW);
  assert.equal(active.nextBillingDate, '2026-11-15T00:00:00.000Z');
  const paused = await s.service.pause(STAFF, sub.id);
  assert.equal(paused.pausedAt, NOW);
  const closed = await s.service.close(STAFF, sub.id, { reason: 'Customer left' });
  assert.deepEqual([closed.status, closed.closeReason, closed.closedAt, closed.nextBillingDate], ['CLOSED', 'Customer left', NOW, null]);
  assert.deepEqual(closed.statusHistory.map((h) => h.toStatus), ['DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED']);
  assert.equal(closed.statusHistory.at(-1)?.reason, 'Customer left');
  assert.equal(closed.statusHistory.at(-1)?.changedByName, `User ${STAFF.userId}`);
  assert.equal(s.audit.entries.length, 6);
});

test('send-quotation needs a line; quotationValidUntil = today + template validityDays, null without a template', async () => {
  const s = setup();
  const empty = seed(s, {}, 0);
  const noLines = await failure(s.service.sendQuotation(STAFF, empty.id));
  assert.equal(noLines.status, 400);
  assert.equal(noLines.details?.[0]?.field, 'lines');
  assert.equal(s.world.rows[0]?.status, 'DRAFT');

  const withTemplate = seed(s, { templateId: 1 });
  const sent = await s.service.sendQuotation(STAFF, withTemplate.id);
  assert.equal(sent.quotationValidUntil, '2026-11-14T00:00:00.000Z');
  const without = seed(s);
  assert.equal((await s.service.sendQuotation(STAFF, without.id)).quotationValidUntil, null);
  const deletedTemplate = seed(s, { templateId: 99 });
  assert.equal((await s.service.sendQuotation(STAFF, deletedTemplate.id)).quotationValidUntil, null);
});

test('confirm: a quotation valid until today is still valid, the day after it is expired', async () => {
  const s = setup();
  const today = seed(s, { status: 'QUOTATION', quotationValidUntil: '2026-10-31T00:00:00.000Z' });
  assert.equal((await s.service.confirm(STAFF, today.id) as SubscriptionDto).status, 'CONFIRMED');
  const expired = seed(s, { status: 'QUOTATION', quotationValidUntil: '2026-10-30T00:00:00.000Z' });
  const error = await failure(s.service.confirm(STAFF, expired.id));
  assert.deepEqual([error.status, error.code], [409, 'QUOTATION_EXPIRED']);
  assert.equal(s.world.rows.find((r) => r.id === expired.id)?.status, 'QUOTATION');
  s.clock.value = new Date('2026-11-01T00:00:00.000Z');
  const later = seed(s, { status: 'QUOTATION', quotationValidUntil: '2026-10-31T00:00:00.000Z' });
  assert.equal((await failure(s.service.confirm(STAFF, later.id))).code, 'QUOTATION_EXPIRED');
});

test('confirm checks plan availability on startDate and the plan minimum quantity of every line', async () => {
  const s = setup();
  const early = seed(s, { status: 'QUOTATION', startDate: '2025-06-01T00:00:00.000Z', expiryDate: null });
  assert.equal((await failure(s.service.confirm(STAFF, early.id))).code, 'PLAN_NOT_AVAILABLE');
  const small = seed(s, { status: 'QUOTATION', planId: 3 }, 2, 4);
  const error = await failure(s.service.confirm(STAFF, small.id));
  assert.equal(error.status, 400);
  assert.deepEqual(error.details?.map((d) => d.field), ['lines.0.quantity', 'lines.1.quantity']);
  assert.equal(s.world.rows.find((r) => r.id === small.id)?.status, 'QUOTATION');
  const exact = seed(s, { status: 'QUOTATION', planId: 3 }, 1, 5);
  assert.equal((await s.service.confirm(STAFF, exact.id) as SubscriptionDto).status, 'CONFIRMED');
});

test('parallel double confirm: exactly one succeeds, the other gets 409 INVALID_STATE_TRANSITION', async () => {
  const s = setup();
  const row = seed(s, { status: 'QUOTATION' });
  const results = await Promise.allSettled([s.service.confirm(STAFF, row.id), s.service.confirm(ADMIN, row.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert.ok(rejected !== undefined && rejected.status === 'rejected');
  assert.deepEqual([(rejected.reason as { status: number }).status, (rejected.reason as { code: string }).code], [409, 'INVALID_STATE_TRANSITION']);
  assert.equal(s.world.history.filter((h) => h.toStatus === 'CONFIRMED').length, 1);
  assert.deepEqual(s.audit.actions(), ['subscription.confirm']);
});

test('plan flags: pause, close (ACTIVE or PAUSED) and renew are blocked with ACTION_NOT_ALLOWED_BY_PLAN; close before activation is always allowed', async () => {
  const s = setup();
  const blocked = async (promise: Promise<unknown>) => {
    const error = await failure(promise);
    assert.deepEqual([error.status, error.code], [409, 'ACTION_NOT_ALLOWED_BY_PLAN']);
  };
  const active = seed(s, { status: 'ACTIVE', planId: 2 });
  const paused = seed(s, { status: 'PAUSED', planId: 2 });
  const closed = seed(s, { status: 'CLOSED', planId: 2 });
  await blocked(s.service.pause(STAFF, active.id));
  await blocked(s.service.close(STAFF, active.id, { reason: 'x' }));
  await blocked(s.service.close(STAFF, paused.id, { reason: 'x' }));
  await blocked(s.service.renew(STAFF, active.id, {}));
  await blocked(s.service.renew(STAFF, closed.id, {}));
  assert.equal(s.world.history.length, 0);
  // Resume is not plan-gated, and the invalid-status error wins over a plan flag.
  assert.equal((await s.service.resume(STAFF, paused.id) as SubscriptionDto).status, 'ACTIVE');
  assert.equal((await failure(s.service.pause(STAFF, seed(s, { status: 'DRAFT', planId: 2 }).id))).code, 'INVALID_STATE_TRANSITION');
  for (const status of ['DRAFT', 'QUOTATION', 'CONFIRMED'] as const) {
    const row = seed(s, { status, planId: 2 });
    assert.equal((await s.service.close(STAFF, row.id, { reason: 'changed mind' })).status, 'CLOSED');
  }
});

test('resume sets nextBillingDate to the first period boundary on or after today (month-end anchored), never before lastBilledUntil', async () => {
  const s = setup();
  s.clock.value = new Date('2026-03-15T08:00:00.000Z');
  const row = seed(s, { status: 'PAUSED', startDate: '2026-01-31T00:00:00.000Z', nextBillingDate: '2026-02-28T00:00:00.000Z' });
  const resumed = await s.service.resume(STAFF, row.id);
  assert.equal(resumed.nextBillingDate, '2026-03-31T00:00:00.000Z');
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.status, 'ACTIVE');

  s.clock.value = new Date('2026-02-28T10:00:00.000Z');
  const exact = seed(s, { status: 'PAUSED', startDate: '2026-01-31T00:00:00.000Z' });
  assert.equal((await s.service.resume(STAFF, exact.id)).nextBillingDate, '2026-02-28T00:00:00.000Z');

  const billed = seed(s, { status: 'PAUSED', startDate: '2026-01-31T00:00:00.000Z', lastBilledUntil: '2026-04-30T00:00:00.000Z' });
  assert.equal((await s.service.resume(STAFF, billed.id)).nextBillingDate, '2026-04-30T00:00:00.000Z');

  s.clock.value = new Date('2025-12-01T00:00:00.000Z');
  const early = seed(s, { status: 'PAUSED', startDate: '2026-01-31T00:00:00.000Z' });
  assert.equal((await s.service.resume(STAFF, early.id)).nextBillingDate, '2026-01-31T00:00:00.000Z');
});

test('price snapshot: a later product price or tax change never touches stored lines; replacing lines reprices', async () => {
  const s = setup();
  const sub = await s.service.create(STAFF, { ...createBody, startDate: new Date('2026-11-01T00:00:00Z'), expiryDate: null, lines: [{ productId: 10, taxId: 1, quantity: 2 }] });
  assert.equal(sub.total, 23600);
  s.prices.set(10, { name: 'Odoo ERP', price: 99999, active: true });
  s.taxes.set(1, { id: 1, name: 'GST 18%', type: 'PERCENTAGE', rate: 2800, isActive: true });
  let current = await s.service.get(STAFF, sub.id);
  assert.deepEqual([current.lines[0]?.unitPrice, current.lines[0]?.taxRate, current.lines[0]?.amount, current.total], [10000, 1800, 20000, 23600]);
  current = await s.service.update(STAFF, sub.id, { notes: 'only notes' });
  assert.deepEqual([current.lines[0]?.unitPrice, current.total], [10000, 23600]);
  s.taxes.set(1, { id: 1, name: 'GST 18%', type: 'PERCENTAGE', rate: 1800, isActive: false });
  await s.service.sendQuotation(STAFF, sub.id);
  await s.service.confirm(STAFF, sub.id);
  assert.equal((await s.service.get(STAFF, sub.id)).lines[0]?.unitPrice, 10000);
  assert.equal(s.world.rows[0]?.total, 23600);
});

test('PATCH: DRAFT/QUOTATION replace header and lines with totals recomputed; one transaction keeps the old lines on failure', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const sub = await s.service.create(STAFF, { ...createBody, startDate: new Date('2026-11-01T00:00:00Z'), expiryDate: null, lines: [{ productId: 10, taxId: 1, quantity: 2 }] });
  const patch = (body: unknown, id = sub.id) => srv.request<ApiBody & { data: SubscriptionDto }>(`/subscriptions/${id}`, { method: 'PATCH', role: Role.STAFF, body });

  const replaced = await patch({ lines: [{ productId: 12, quantity: 1, taxId: 1 }, { productId: 10, quantity: 4 }], notes: 'n', paymentTermId: null });
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.body.data.lines.map((l) => [l.productId, l.sortOrder, l.amount, l.taxAmount]), [[12, 0, 33333, 6000], [10, 1, 40000, 0]]);
  assert.deepEqual([replaced.body.data.subtotal, replaced.body.data.taxTotal, replaced.body.data.total, replaced.body.data.recurringAmount], [73333, 6000, 79333, 79333]);
  assert.equal(replaced.body.data.notes, 'n');
  assert.equal(replaced.body.data.paymentTermId, null);

  s.world.failNextReplace.value = true;
  assert.equal((await patch({ lines: [{ productId: 10, quantity: 1 }] })).status, 500);
  assert.equal(s.world.lines.length, 2);
  assert.equal(s.world.rows[0]?.total, 79333);

  assert.equal((await patch({ lines: [{ productId: 11, quantity: 1 }] })).status, 400);
  assert.equal(s.world.lines.length, 2);
  const cleared = await patch({ lines: [] });
  assert.equal(cleared.body.data.total, 0);

  const dated = await patch({ startDate: '2026-12-01', expiryDate: '2027-12-01', planId: 3, lines: [{ productId: 10, quantity: 5 }] });
  assert.equal(dated.body.data.planId, 3);
  assert.equal(dated.body.data.expiryDate, '2027-12-01T00:00:00.000Z');
  assert.equal((await patch({ expiryDate: '2026-12-01' })).status, 400);
  assert.equal((await patch({ planId: 4, expiryDate: null })).status, 400);
  assert.equal((await patch({ planId: 3, lines: [{ productId: 10, quantity: 2 }] })).status, 400);
  assert.equal((await patch({ startDate: '2025-01-01' })).status, 409);
  for (const body of [{}, { customerId: 2 }, { unitPrice: 1 }, { lines: [{ productId: 10, quantity: 1, unitPrice: 5 }] }, { status: 'ACTIVE' }]) {
    assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await patch({ notes: 'x' }, 99)).status, 404);

  // Changing only the plan re-checks the stored lines against the new plan minimum.
  const small = seed(s, {}, 1, 2);
  assert.equal((await patch({ planId: 3 }, small.id)).status, 400);
  assert.ok(s.audit.actions().every((a) => a === 'subscription.create' || a === 'subscription.update'));
});

test('PATCH after CONFIRMED: only notes and paymentTermId; header and lines are 409', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const patch = (id: number, body: unknown) => srv.request<ApiBody & { data: SubscriptionDto }>(`/subscriptions/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  for (const status of ['CONFIRMED', 'ACTIVE', 'PAUSED', 'CLOSED'] as const) {
    const row = seed(s, { status });
    const ok = await patch(row.id, { notes: `n-${status}`, paymentTermId: 1 });
    assert.equal(ok.status, 200, status);
    assert.equal(ok.body.data.notes, `n-${status}`);
    assert.equal(ok.body.data.paymentTermId, 1);
    for (const body of [{ planId: 3 }, { startDate: '2026-12-01' }, { expiryDate: null }, { lines: [] }]) {
      const response = await patch(row.id, { ...body, notes: 'x' });
      assert.equal(response.status, 409, `${status} ${JSON.stringify(body)}`);
      assert.equal(response.body.error?.code, 'INVALID_STATE_TRANSITION');
    }
    assert.equal(s.world.rows.find((r) => r.id === row.id)?.notes, `n-${status}`);
  }
  assert.equal((await patch(1, { paymentTermId: 2 })).status, 400);
  const quotation = seed(s, { status: 'QUOTATION' });
  assert.equal((await patch(quotation.id, { lines: [{ productId: 10, quantity: 3 }] })).status, 200);
});

test('DELETE: ADMIN only, DRAFT only, soft delete hides the subscription everywhere', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const draft = seed(s);
  const quotation = seed(s, { status: 'QUOTATION' });
  assert.equal((await srv.request(`/subscriptions/${draft.id}`, { method: 'DELETE', role: Role.STAFF })).status, 403);
  assert.equal((await srv.request(`/subscriptions/${quotation.id}`, { method: 'DELETE', role: Role.ADMIN })).status, 409);
  assert.equal((await srv.request(`/subscriptions/${draft.id}`, { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await srv.request(`/subscriptions/${draft.id}`, { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request(`/subscriptions/${draft.id}`, { role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request(`/subscriptions/${draft.id}/confirm`, { method: 'POST', role: Role.ADMIN })).status, 404);
  const list = await srv.request<ApiBody & { data: { id: number }[] }>('/subscriptions', { role: Role.ADMIN });
  assert.deepEqual(list.body.data.map((row) => row.id), [quotation.id]);
  assert.deepEqual(s.audit.actions(), ['subscription.delete']);
  assert.equal(await s.service.getForBilling(draft.id), null);
});

test('renew (staff): DRAFT repriced at current prices and taxes, start = old expiry, same duration, renewedFromId, term and lines kept', async () => {
  const s = setup();
  const sub = seed(s, { status: 'ACTIVE', startDate: '2026-06-01T00:00:00.000Z', expiryDate: '2026-12-01T00:00:00.000Z', paymentTermId: 1, templateId: 1, notes: 'internal' });
  s.prices.set(10, { name: 'Odoo ERP', price: 15000, active: true });
  s.taxes.set(1, { id: 1, name: 'GST 18%', type: 'PERCENTAGE', rate: 1200, isActive: true });
  const renewed = await s.service.renew(STAFF, sub.id, {}) as SubscriptionDto;
  assert.equal(renewed.status, 'DRAFT');
  assert.equal(renewed.renewedFromId, sub.id);
  assert.equal(renewed.number, 'SUB-2026-000001');
  assert.equal(renewed.startDate, '2026-12-01T00:00:00.000Z');
  // Same duration in days: 183 days between 2026-06-01 and 2026-12-01.
  assert.equal(renewed.expiryDate, '2027-06-02T00:00:00.000Z');
  assert.deepEqual([renewed.planId, renewed.customerId, renewed.paymentTermId, renewed.templateId, renewed.notes], [1, TEST_CUSTOMER_ID, 1, 1, null]);
  assert.deepEqual(renewed.lines.map((l) => [l.productId, l.quantity, l.unitPrice, l.taxRate, l.taxAmount, l.amount]), [[10, 2, 15000, 1200, 3600, 30000]]);
  assert.equal(renewed.total, 33600);
  assert.equal(renewed.nextBillingDate, null);
  assert.deepEqual(renewed.statusHistory.map((h) => [h.fromStatus, h.toStatus]), [[null, 'DRAFT']]);
  assert.equal(s.world.rows.find((r) => r.id === sub.id)?.status, 'ACTIVE');
  assert.equal(s.audit.entries.at(-1)?.entityId, renewed.id);
  assert.equal((s.audit.entries.at(-1)?.metadata as { renewedFromId: number }).renewedFromId, sub.id);

  const again = await failure(s.service.renew(STAFF, sub.id, {}));
  assert.deepEqual([again.status, again.code], [409, 'INVALID_STATE_TRANSITION']);
  s.world.rows.find((r) => r.id === renewed.id)!.status = 'CLOSED';
  assert.equal((await s.service.renew(STAFF, sub.id, {}) as SubscriptionDto).renewedFromId, sub.id);
});

test('renew: start is today when the old expiry is past or missing; inactive product or unavailable plan blocks it', async () => {
  const s = setup();
  const past = seed(s, { status: 'CLOSED', startDate: '2026-01-01T00:00:00.000Z', expiryDate: '2026-04-01T00:00:00.000Z' });
  const renewedPast = await s.service.renew(STAFF, past.id, {}) as SubscriptionDto;
  assert.equal(renewedPast.startDate, '2026-10-31T00:00:00.000Z');
  assert.equal(renewedPast.expiryDate, '2027-01-29T00:00:00.000Z');
  const open = seed(s, { status: 'ACTIVE', expiryDate: null });
  const renewedOpen = await s.service.renew(STAFF, open.id, {}) as SubscriptionDto;
  assert.deepEqual([renewedOpen.startDate, renewedOpen.expiryDate], ['2026-10-31T00:00:00.000Z', null]);

  const blockedProduct = seed(s, { status: 'ACTIVE' });
  s.prices.set(10, { name: 'Odoo ERP', price: 10000, active: false });
  assert.equal((await failure(s.service.renew(STAFF, blockedProduct.id, {}))).status, 400);
  s.prices.set(10, { name: 'Odoo ERP', price: 10000, active: true });
  s.plans.set(1, plan({ availableTo: '2026-12-31T00:00:00.000Z' }));
  const later = seed(s, { status: 'CLOSED', startDate: '2026-01-01T00:00:00.000Z', expiryDate: '2027-02-01T00:00:00.000Z' });
  assert.equal((await failure(s.service.renew(STAFF, later.id, {}))).code, 'PLAN_NOT_AVAILABLE');
});

test('renew with autoActivate (portal): created ACTIVE with confirmedAt, activatedAt, nextBillingDate = start and one null -> ACTIVE history row', async () => {
  const s = setup();
  const sub = seed(s, { status: 'ACTIVE', expiryDate: '2026-12-31T00:00:00.000Z' });
  const renewed = await s.service.renew(CUSTOMER, sub.id, {}, { autoActivate: true }) as SubscriptionDto;
  assert.equal(renewed.status, 'ACTIVE');
  assert.equal(renewed.startDate, '2026-12-31T00:00:00.000Z');
  assert.deepEqual([renewed.confirmedAt, renewed.activatedAt, renewed.nextBillingDate], [NOW, NOW, '2026-12-31T00:00:00.000Z']);
  assert.deepEqual(renewed.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.reason, h.changedById]), [[null, 'ACTIVE', 'Renewed', CUSTOMER.userId]]);
  assert.equal(renewed.createdById, CUSTOMER.userId);
  assert.ok(!renewed.allowedActions.includes('ACTIVATE'));

  // A CUSTOMER actor is always auto-activated, so the renewal is never an invisible DRAFT.
  const other = seed(s, { status: 'CLOSED' });
  assert.equal((await s.service.renew(CUSTOMER, other.id, {}) as SubscriptionDto).status, 'ACTIVE');
  const staffDefault = seed(s, { status: 'CLOSED' });
  assert.equal((await s.service.renew(STAFF, staffDefault.id, {}, { autoActivate: false }) as SubscriptionDto).status, 'DRAFT');
  const staffAuto = seed(s, { status: 'CLOSED' });
  assert.equal((await s.service.renew(STAFF, staffAuto.id, {}, { autoActivate: true }) as SubscriptionDto).status, 'ACTIVE');
});

test('customer actor: scoped list, DRAFT and foreign subscriptions are 404, writes are 403, own pause/resume/close/renew work', async () => {
  const s = setup();
  const own = seed(s, { status: 'ACTIVE' });
  const draft = seed(s, { status: 'DRAFT' });
  const foreign = seed(s, { status: 'ACTIVE', customerId: 2002 });

  const list = await s.service.list(CUSTOMER, { ...listParams, customerId: 2002 });
  assert.deepEqual(list.subscriptions.map((row) => row.id), [own.id]);
  assert.deepEqual(s.world.listCalls.at(-1)?.scope, { customerId: TEST_CUSTOMER_ID, hideDrafts: true, today: new Date('2026-10-31T00:00:00.000Z') });
  assert.equal(list.meta.total, 1);

  assert.equal((await s.service.get(CUSTOMER, own.id)).id, own.id);
  assert.deepEqual((await s.service.get(CUSTOMER, own.id)).allowedActions.sort(), ['CLOSE', 'PAUSE', 'RENEW']);
  for (const id of [draft.id, foreign.id, 999]) {
    assert.equal((await failure(s.service.get(CUSTOMER, id))).status, 404);
    for (const call of [
      () => s.service.pause(CUSTOMER, id), () => s.service.resume(CUSTOMER, id),
      () => s.service.close(CUSTOMER, id, {}), () => s.service.renew(CUSTOMER, id, {}, { autoActivate: true }),
    ]) assert.equal((await failure(call())).status, 404);
  }

  const forbiddenCalls: (() => Promise<unknown>)[] = [
    () => s.service.create(CUSTOMER, { ...createBody, startDate: new Date('2026-11-01T00:00:00Z'), expiryDate: null }),
    () => s.service.createFromTemplate(CUSTOMER, { templateId: 1, customerId: 1, startDate: new Date('2026-11-01T00:00:00Z') }),
    () => s.service.update(CUSTOMER, own.id, { notes: 'x' }),
    () => s.service.remove(CUSTOMER, draft.id),
    () => s.service.sendQuotation(CUSTOMER, draft.id),
    () => s.service.confirm(CUSTOMER, own.id),
    () => s.service.activate(CUSTOMER, own.id),
  ];
  for (const call of forbiddenCalls) assert.equal((await failure(call())).status, 403);
  assert.equal(s.audit.entries.length, 0);

  assert.equal((await s.service.pause(CUSTOMER, own.id)).status, 'PAUSED');
  assert.equal((await s.service.resume(CUSTOMER, own.id)).status, 'ACTIVE');
  const closed = await s.service.close(CUSTOMER, own.id, {});
  assert.deepEqual([closed.status, closed.closeReason], ['CLOSED', null]);
  assert.equal(s.world.history.at(-1)?.changedById, CUSTOMER.userId);
  assert.equal((await s.service.renew(CUSTOMER, own.id, {}, { autoActivate: true }) as SubscriptionDto).status, 'ACTIVE');
  const reasoned = seed(s, { status: 'ACTIVE' });
  assert.equal((await s.service.close(CUSTOMER, reasoned.id, { reason: 'too pricey' })).closeReason, 'too pricey');

  const noProfile: Actor = { userId: 3, role: 'CUSTOMER' };
  assert.equal((await failure(s.service.list(noProfile, listParams))).status, 403);
  assert.equal((await failure(s.service.get(noProfile, own.id))).status, 403);
});

test('customer actor still respects plan flags', async () => {
  const s = setup();
  const row = seed(s, { status: 'ACTIVE', planId: 2 });
  for (const call of [() => s.service.pause(CUSTOMER, row.id), () => s.service.close(CUSTOMER, row.id, {}), () => s.service.renew(CUSTOMER, row.id, {}, { autoActivate: true })]) {
    assert.equal((await failure(call())).code, 'ACTION_NOT_ALLOWED_BY_PLAN');
  }
});

test('list endpoint: bounded and strict, filters parsed, soft-deleted rows excluded, include=lines', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  seed(s, { number: 'SUB-A', status: 'ACTIVE' });
  seed(s, { number: 'SUB-B', status: 'PAUSED' });
  seed(s, { number: 'SUB-C', status: 'CLOSED' });
  const get = (query: string) => srv.request<ApiBody & { data: { number: string; lines?: unknown[]; allowedActions: string[] }[] }>(`/subscriptions${query}`, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?limit=0', '?page=0', '?sortBy=notes', '?sortBy=id', '?sortOrder=up', '?status=BOGUS', '?status=ACTIVE,NOPE',
    '?customerId=abc', '?planId=0', '?templateId=-1', '?startFrom=notadate', '?dueForBilling=yes', '?expiringWithinDays=0',
    '?expiringWithinDays=366', '?include=invoices', '?search=', '?bogus=1', '?minTotal=1',
  ]) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?status=ACTIVE,PAUSED&customerId=1001&planId=1&templateId=3&startFrom=2026-01-01&startTo=2026-01-31&expiryFrom=2027-01-01&expiryTo=2027-01-31'
    + '&nextBillingFrom=2026-01-01&nextBillingTo=2026-12-31&createdFrom=2026-01-01&createdTo=2026-12-31&dueForBilling=true&expiringWithinDays=30'
    + '&search=SUB&sortBy=nextBillingDate&sortOrder=asc&page=1&limit=2&include=lines');
  assert.equal(ok.status, 200);
  const query = s.world.listCalls.at(-1)?.query;
  assert.deepEqual(query?.status, ['ACTIVE', 'PAUSED']);
  assert.equal(query?.customerId, 1001);
  assert.equal(query?.planId, 1);
  assert.equal(query?.templateId, 3);
  assert.equal(query?.dueForBilling, true);
  assert.equal(query?.expiringWithinDays, 30);
  assert.equal(query?.sortBy, 'nextBillingDate');
  assert.deepEqual(query?.include, ['lines']);
  assert.equal(query?.startFrom?.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(query?.startTo?.toISOString(), '2026-01-31T23:59:59.999Z');
  assert.equal(query?.expiryTo?.toISOString(), '2027-01-31T23:59:59.999Z');
  assert.equal(query?.createdTo?.toISOString(), '2026-12-31T23:59:59.999Z');
  assert.equal(query?.limit, 2);

  const filtered = await get('?status=ACTIVE,PAUSED&include=lines');
  assert.deepEqual(filtered.body.data.map((row) => row.number), ['SUB-B', 'SUB-A']);
  assert.equal(filtered.body.data[0]?.lines?.length, 1);
  assert.equal((await get('')).body.data[0]?.lines, undefined);
  assert.deepEqual(filtered.body.meta?.total, 3);
  const past = await get('?page=9');
  assert.equal(past.body.data.length, 0);
  assert.equal(past.body.meta?.hasNext, false);
  s.world.deleted.add(1);
  assert.deepEqual((await get('?limit=100')).body.data.map((row) => row.number), ['SUB-C', 'SUB-B']);
  assert.deepEqual((await get('?limit=100&dueForBilling=false&expiringWithinDays=365')).status, 200);
});

test('detail: lines with names, history with user names, attached discounts, last invoices, allowed actions by plan flags', async () => {
  const s = setup();
  const row = seed(s, { status: 'ACTIVE', paymentTermId: 1 });
  s.world.history.push({ id: 1, subscriptionId: row.id, fromStatus: null, toStatus: 'DRAFT', changedById: 1, reason: null, createdAt: NOW });
  s.world.history.push({ id: 2, subscriptionId: row.id, fromStatus: 'DRAFT', toStatus: 'ACTIVE', changedById: null, reason: 'system', createdAt: NOW });
  s.world.invoices.push({ id: 1001 + row.id - 1, number: 'INV-1', status: 'CONFIRMED', total: 100, issueDate: NOW, dueDate: NOW });
  const detail = await s.service.get(STAFF, row.id);
  assert.equal(detail.customer.name, `Customer ${TEST_CUSTOMER_ID}`);
  assert.equal(detail.plan.name, 'Pro');
  assert.equal(detail.paymentTerm?.dueDays, 30);
  assert.equal(detail.lines[0]?.productName, 'Odoo ERP');
  assert.equal(detail.lines[0]?.taxName, 'GST 18%');
  assert.deepEqual(detail.statusHistory.map((h) => h.changedByName), ['User 1', null]);
  assert.deepEqual(detail.invoices, [{ id: 1001, number: 'INV-1', status: 'CONFIRMED', total: 100, issueDate: NOW, dueDate: NOW }]);
  assert.deepEqual(detail.allowedActions, ['EDIT', 'PAUSE', 'CLOSE', 'RENEW', 'GENERATE_INVOICE']);
  const locked = seed(s, { status: 'ACTIVE', planId: 2 });
  assert.deepEqual((await s.service.get(STAFF, locked.id)).allowedActions, ['EDIT', 'GENERATE_INVOICE']);
  const draft = seed(s);
  assert.deepEqual((await s.service.get(ADMIN, draft.id)).allowedActions, ['EDIT', 'SEND_QUOTATION', 'CLOSE', 'DELETE']);
  assert.deepEqual((await s.service.get(STAFF, draft.id)).allowedActions, ['EDIT', 'SEND_QUOTATION', 'CLOSE']);
});

test('SubscriptionsGateway: getForBilling shape, listDueIds keyset with expiry cut-off, closeBySystem, listAutoCloseIds', async () => {
  const s = setup();
  const active = seed(s, { status: 'ACTIVE', nextBillingDate: '2026-10-01T00:00:00.000Z' }, 2);
  s.world.lines[1]!.taxId = null;
  s.world.lines[1]!.taxRate = 0;
  s.taxes.set(2, { id: 2, name: 'Env fee', type: 'FIXED', rate: 500, isActive: true });
  s.world.lines[0]!.taxId = 2;
  s.world.lines[0]!.taxRate = 500;
  const billing = await s.service.getForBilling(active.id);
  assert.ok(billing !== null);
  assert.deepEqual(
    { id: billing.id, status: billing.status, planId: billing.planId, billingPeriod: billing.billingPeriod, paymentTermId: billing.paymentTermId },
    { id: active.id, status: 'ACTIVE', planId: 1, billingPeriod: 'MONTHLY', paymentTermId: null },
  );
  assert.ok(billing.startDate instanceof Date && billing.nextBillingDate instanceof Date && billing.expiryDate instanceof Date);
  assert.equal(billing.lastBilledUntil, null);
  assert.deepEqual(billing.lines.map((l) => [l.taxType, l.taxRate, l.productId, l.quantity, l.unitPrice, l.amount, l.variantId, l.description]), [
    ['FIXED', 500, 10, 2, 10000, 20000, null, 'Odoo ERP'], [null, 0, 10, 2, 10000, 20000, null, 'Odoo ERP'],
  ]);
  assert.equal(await s.service.getForBilling(999), null);

  const due2 = seed(s, { status: 'ACTIVE', nextBillingDate: '2026-10-31T00:00:00.000Z', expiryDate: null });
  seed(s, { status: 'ACTIVE', nextBillingDate: '2026-11-01T00:00:00.000Z' });
  seed(s, { status: 'PAUSED', nextBillingDate: '2026-09-01T00:00:00.000Z' });
  const beyondExpiry = seed(s, { status: 'ACTIVE', nextBillingDate: '2026-10-20T00:00:00.000Z', expiryDate: '2026-10-10T00:00:00.000Z' });
  const atExpiry = seed(s, { status: 'ACTIVE', nextBillingDate: '2026-10-10T00:00:00.000Z', expiryDate: '2026-10-10T00:00:00.000Z' });
  const asOf = new Date('2026-10-31T00:00:00.000Z');
  assert.deepEqual(await s.service.listDueIds(asOf, 0, 10), [active.id, due2.id, atExpiry.id]);
  assert.ok(!(await s.service.listDueIds(asOf, 0, 10)).includes(beyondExpiry.id));
  assert.deepEqual(await s.service.listDueIds(asOf, 0, 2), [active.id, due2.id]);
  assert.deepEqual(await s.service.listDueIds(asOf, due2.id, 2), [atExpiry.id]);
  assert.deepEqual(await s.service.listDueIds(asOf, atExpiry.id, 2), []);
  assert.deepEqual(await s.service.listDueIds(asOf, 0, 1), [active.id]);

  assert.equal(await s.service.closeBySystem(active.id, 'Plan ended'), true);
  const closed = s.world.rows.find((r) => r.id === active.id)!;
  assert.deepEqual([closed.status, closed.closeReason, closed.nextBillingDate, closed.closedAt], ['CLOSED', 'Plan ended', null, NOW]);
  const entry = s.world.history.at(-1);
  assert.deepEqual([entry?.fromStatus, entry?.toStatus, entry?.changedById, entry?.reason], ['ACTIVE', 'CLOSED', null, 'Plan ended']);
  assert.equal(s.audit.entries.at(-1)?.actor, null);
  assert.equal(s.audit.entries.at(-1)?.action, 'subscription.close');
  assert.equal(await s.service.closeBySystem(active.id, 'again'), false);
  assert.equal(await s.service.closeBySystem(999, 'x'), false);
  assert.equal(await s.service.closeBySystem(seed(s, { status: 'DRAFT' }).id, 'x'), false);
  const paused = seed(s, { status: 'PAUSED' });
  assert.equal(await s.service.closeBySystem(paused.id, 'Plan ended'), true);

  s.plans.set(4, plan({ id: 4, autoClose: true }));
  const expiredAuto = seed(s, { status: 'ACTIVE', planId: 4, expiryDate: '2026-10-30T00:00:00.000Z' });
  seed(s, { status: 'ACTIVE', planId: 4, expiryDate: '2026-10-31T00:00:00.000Z' });
  seed(s, { status: 'ACTIVE', planId: 1, expiryDate: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(await s.service.listAutoCloseIds(new Date('2026-10-31T15:00:00.000Z')), [expiredAuto.id]);
});

test('service enforces roles itself (not only the routes)', async () => {
  const s = setup();
  const row = seed(s);
  assert.equal((await failure(s.service.remove(STAFF, row.id))).status, 403);
  assert.equal((await failure(s.service.remove(CUSTOMER, row.id))).status, 403);
  assert.equal((await s.service.list(STAFF, listParams)).subscriptions.length, 1);
  assert.equal(s.audit.entries.length, 0);
  assert.equal(s.world.deleted.size, 0);
});
