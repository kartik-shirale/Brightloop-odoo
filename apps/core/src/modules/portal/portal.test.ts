import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role, type InvoiceStatus, type SubscriptionStatus } from '@brightloop/shared';
import { RecordingAudit, FakeSequenceGateway, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { FakeAuthService, TEST_USERS } from '../../core/testing/test-auth.js';
import { startTestServer, type ApiBody, type TestServer } from '../../core/testing/test-server.js';
import type { InvoiceMailer } from '../../core/mail/emailjs.js';
import type { CustomersGateway } from '../customers/customers.gateway.js';
import type { CustomerRow, CustomersRepository } from '../customers/customers.repository.js';
import { CustomersService } from '../customers/customers.service.js';
import type { DiscountsGateway } from '../discounts/discounts.gateway.js';
import type { InvoiceRow, InvoicesRepository, Names } from '../invoices/invoices.repository.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import type { PaymentTermsGateway } from '../payment-terms/payment-terms.gateway.js';
import type { PaymentRecord, PaymentsRepository } from '../payments/payments.repository.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { PlanRecord, PlansGateway } from '../plans/plans.gateway.js';
import type { CatalogGateway } from '../products/products.gateway.js';
import type { TemplatesGateway } from '../quotation-templates/quotation-templates.gateway.js';
import type { SubscriptionsGateway } from '../subscriptions/subscriptions.gateway.js';
import type {
  StatusHistoryRow, SubscriptionLineRow, SubscriptionRow, SubscriptionsRepository,
} from '../subscriptions/subscriptions.repository.js';
import { createSubscriptionsRouter } from '../subscriptions/subscriptions.routes.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { TaxesGateway } from '../taxes/taxes.gateway.js';
import type { PortalSummaryRow } from './portal.repository.js';
import { createPortalProfileRouter, createPortalRouter } from './portal.routes.js';
import { PortalService } from './portal.service.js';

const NOW = '2026-10-31T10:00:00.000Z';
const CLOCK = (): Date => new Date(NOW);
/** Customer A owns the "foreign" records. The CUSTOMER test user is customer B. */
const CUSTOMER_A = 501;
const CUSTOMER_B = 502;
const CUSTOMER_USER_ID = TEST_USERS.CUSTOMER.id;

function plan(over: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 1, name: 'Pro', price: 1000, billingPeriod: 'MONTHLY', minQuantity: 1,
    availableFrom: '2026-01-01T00:00:00.000Z', availableTo: '2030-12-31T00:00:00.000Z',
    autoClose: false, closable: true, pausable: true, renewable: true, isActive: true, ...over,
  };
}

function customerRow(id: number, userId: number | null): CustomerRow {
  return {
    id, userId, name: `Customer ${id}`, companyName: null, email: `c${id}@x.test`, phone: null, taxId: null,
    addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null,
    notes: 'staff-only customer note', deletedAt: null, createdAt: NOW, updatedAt: NOW,
  };
}

function subRow(id: number, customerId: number, status: SubscriptionStatus, planId = 1): SubscriptionRow {
  return {
    id, number: `SUB-2026-00000${id}`, customerId, planId, templateId: null, paymentTermId: null, status,
    startDate: '2026-01-01T00:00:00.000Z', expiryDate: '2027-01-01T00:00:00.000Z', quotationValidUntil: null,
    nextBillingDate: status === 'ACTIVE' ? '2026-11-01T00:00:00.000Z' : null, lastBilledUntil: null,
    confirmedAt: null, activatedAt: null, pausedAt: null, closedAt: null, closeReason: null, renewedFromId: null,
    subtotal: 10000, taxTotal: 0, total: 10000, recurringAmount: 10000,
    notes: 'internal staff note', createdById: 2, createdAt: NOW, updatedAt: NOW,
  };
}

function invoiceRow(id: number, customerId: number, subscriptionId: number, status: InvoiceStatus): InvoiceRow {
  const confirmed = status === 'CONFIRMED';
  return {
    id, number: `INV-2026-00000${id}`, subscriptionId, customerId, paymentTermId: null, status, currency: 'INR',
    periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z',
    issueDate: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-16T00:00:00.000Z',
    customerName: `Customer ${customerId}`, customerEmail: `c${customerId}@x.test`, customerTaxId: null, billingAddress: null,
    subtotal: 10000, discountTotal: 0, taxTotal: 0, total: 10000,
    amountPaid: status === 'PAID' ? 10000 : 0, amountDue: confirmed ? 10000 : 0,
    confirmedAt: confirmed || status === 'PAID' ? NOW : null, sentAt: null, paidAt: status === 'PAID' ? NOW : null,
    cancelledAt: status === 'CANCELLED' ? NOW : null, cancelReason: status === 'CANCELLED' ? 'internal reason' : null,
    notes: 'internal invoice note', billingRunId: 7, createdById: 2, createdAt: NOW, updatedAt: NOW,
  };
}

function paymentRecord(id: number, invoice: InvoiceRow): PaymentRecord {
  return {
    id, invoiceId: invoice.id, customerId: invoice.customerId, method: 'UPI', amount: 10000, paymentDate: NOW,
    reference: `UTR-${id}`, note: 'internal payment note', recordedById: 2, createdAt: NOW, updatedAt: NOW,
    invoiceNumber: invoice.number, customerName: invoice.customerName, recordedByName: 'Test Staff',
  };
}

interface World {
  customers: Map<number, CustomerRow>;
  subs: SubscriptionRow[];
  lines: SubscriptionLineRow[];
  history: StatusHistoryRow[];
  invoices: InvoiceRow[];
  payments: PaymentRecord[];
  plans: Map<number, PlanRecord>;
  summaryCalls: { customerId: number; today: Date }[];
}

interface Setup {
  world: World;
  audit: RecordingAudit;
  portal: PortalService;
  subscriptions: SubscriptionsService;
}

function setup(): Setup {
  const world: World = {
    customers: new Map([
      [CUSTOMER_A, customerRow(CUSTOMER_A, 99)],
      [CUSTOMER_B, customerRow(CUSTOMER_B, CUSTOMER_USER_ID)],
    ]),
    subs: [
      subRow(1, CUSTOMER_A, 'ACTIVE'),
      subRow(2, CUSTOMER_B, 'ACTIVE'),
      subRow(3, CUSTOMER_B, 'DRAFT'),
      subRow(4, CUSTOMER_B, 'ACTIVE', 2),
      subRow(5, CUSTOMER_B, 'PAUSED'),
      subRow(6, CUSTOMER_A, 'PAUSED'),
    ],
    lines: [{
      id: 1, subscriptionId: 2, productId: 10, variantId: null, taxId: null, description: null, quantity: 2,
      unitPrice: 5000, taxRate: 0, taxAmount: 0, amount: 10000, sortOrder: 0,
    }],
    history: [],
    invoices: [],
    payments: [],
    plans: new Map([
      [1, plan()],
      [2, plan({ id: 2, name: 'Locked', pausable: false, closable: false, renewable: false })],
    ]),
    summaryCalls: [],
  };
  world.invoices.push(
    invoiceRow(1, CUSTOMER_A, 1, 'CONFIRMED'),
    invoiceRow(2, CUSTOMER_B, 2, 'CONFIRMED'),
    invoiceRow(3, CUSTOMER_B, 2, 'DRAFT'),
    invoiceRow(4, CUSTOMER_B, 2, 'CANCELLED'),
    invoiceRow(5, CUSTOMER_B, 2, 'PAID'),
  );
  world.payments.push(paymentRecord(1, world.invoices[0]!), paymentRecord(2, world.invoices[4]!));
  const audit = new RecordingAudit();

  // ---- customers: real service, fake repository
  const customersRepository = fakeRepository<CustomersRepository>({
    async findByUserId(userId) {
      return [...world.customers.values()].find((row) => row.userId === userId) ?? null;
    },
    async findById(id) { return world.customers.get(id) ?? null; },
    async update(id, patch) {
      const row = world.customers.get(id);
      if (row === undefined) return null;
      Object.assign(row, patch);
      return { ...row };
    },
  });
  const customers = new CustomersService(customersRepository, audit, CLOCK);

  // ---- subscriptions: real service, fake repository enforcing the scope it receives
  const visibleSub = (row: SubscriptionRow, scope: { customerId?: number; hideDrafts?: boolean }): boolean =>
    (scope.customerId === undefined || row.customerId === scope.customerId)
    && !(scope.hideDrafts === true && row.status === 'DRAFT');
  const subsRepository = fakeRepository<SubscriptionsRepository>({
    async list(query, scope) {
      const rows = world.subs
        .filter((row) => visibleSub(row, scope))
        .filter((row) => query.status === undefined || query.status.includes(row.status))
        .filter((row) => query.planId === undefined || row.planId === query.planId)
        .sort((a, b) => b.id - a.id);
      return paginateRows(rows, query.page, query.limit).data.map((row) => ({ ...row }));
    },
    async count(query, scope) {
      return world.subs.filter((row) => visibleSub(row, scope))
        .filter((row) => query.status === undefined || query.status.includes(row.status)).length;
    },
    async findById(id, scope = {}) {
      const row = world.subs.find((candidate) => candidate.id === id);
      return row === undefined || !visibleSub(row, scope) ? null : { ...row };
    },
    async listLines(id) { return world.lines.filter((line) => line.subscriptionId === id); },
    async listLinesFor(ids) { return world.lines.filter((line) => ids.includes(line.subscriptionId)); },
    async listHistory(id) { return world.history.filter((entry) => entry.subscriptionId === id); },
    async listRecentInvoices() { return []; },
    async hasOpenRenewal(id) { return world.subs.some((row) => row.renewedFromId === id && row.status !== 'CLOSED'); },
    async findPaymentTerm() { return null; },
    async lookupLabels(request) {
      return {
        customers: new Map((request.customerIds ?? []).map((id) => [id, { id, name: `Customer ${id}`, companyName: null, email: `c${id}@x.test` }])),
        plans: new Map((request.planIds ?? []).flatMap((id) => {
          const p = world.plans.get(id);
          return p === undefined ? [] : [[id, {
            id, name: p.name, billingPeriod: p.billingPeriod, minQuantity: p.minQuantity, autoClose: p.autoClose,
            pausable: p.pausable, closable: p.closable, renewable: p.renewable,
          }] as const];
        })),
        products: new Map((request.productIds ?? []).map((id) => [id, `Product ${id}`])),
        variants: new Map(),
        taxes: new Map(),
        users: new Map((request.userIds ?? []).map((id) => [id, `User ${id}`])),
      };
    },
    async transition(id, expected, toStatus, fields, history) {
      const row = world.subs.find((candidate) => candidate.id === id);
      if (row === undefined || row.status !== expected) return null;
      row.status = toStatus;
      if (fields.closeReason !== undefined) row.closeReason = fields.closeReason;
      if (fields.nextBillingDate !== undefined) row.nextBillingDate = fields.nextBillingDate?.toISOString() ?? null;
      world.history.push({ id: world.history.length + 1, subscriptionId: id, createdAt: NOW, ...history });
      return { ...row };
    },
    async create(data, lines, history) {
      const id = world.subs.length + 1;
      const row: SubscriptionRow = {
        ...subRow(id, data.customerId, data.status, data.planId),
        number: data.number, startDate: data.startDate.toISOString(),
        expiryDate: data.expiryDate?.toISOString() ?? null, nextBillingDate: data.nextBillingDate?.toISOString() ?? null,
        renewedFromId: data.renewedFromId, notes: data.notes, createdById: data.createdById,
        subtotal: data.subtotal, taxTotal: data.taxTotal, total: data.total, recurringAmount: data.recurringAmount,
      };
      world.subs.push(row);
      lines.forEach((line, index) => world.lines.push({ id: 100 + index, subscriptionId: id, ...line }));
      world.history.push({ id: world.history.length + 1, subscriptionId: id, createdAt: NOW, ...history });
      return { ...row };
    },
  });
  const subscriptions = new SubscriptionsService(
    subsRepository,
    audit,
    new FakeSequenceGateway(),
    fakeRepository<CustomersGateway>({ async getById(id) { const c = world.customers.get(id); return c === undefined ? null : { ...c }; } }),
    fakeRepository<CatalogGateway>({
      async getPricedItem(productId) { return { productId, variantId: null, name: `Product ${productId}`, unitPrice: 6000, isActive: true }; },
    }),
    fakeRepository<TaxesGateway>({}),
    fakeRepository<PaymentTermsGateway>({ async getDefault() { return null; } }),
    fakeRepository<PlansGateway>({
      async getById(id) { return world.plans.get(id) ?? null; },
      async assertAvailable(id) {
        const found = world.plans.get(id);
        if (found === undefined) throw new Error("unknown plan");
        return found;
      },
    }),
    fakeRepository<TemplatesGateway>({}),
    fakeRepository<DiscountsGateway>({ async listAttachedForSubscription() { return []; } }),
    CLOCK,
  );

  // ---- invoices: real service, fake repository enforcing the scope it receives
  const visibleInvoice = (row: InvoiceRow, scope: { customerId?: number; statuses?: readonly InvoiceStatus[] }): boolean =>
    (scope.customerId === undefined || row.customerId === scope.customerId)
    && (scope.statuses === undefined || scope.statuses.includes(row.status));
  const names = (): Names => ({
    subscriptions: new Map(world.subs.map((row) => [row.id, row.number])),
    products: new Map(), variants: new Map(), taxes: new Map(), discounts: new Map(), paymentTerms: new Map(),
    users: new Map([[2, 'Test Staff']]),
  });
  const invoicesRepository = fakeRepository<InvoicesRepository>({
    async list(query, scope) {
      const rows = world.invoices
        .filter((row) => visibleInvoice(row, scope))
        .filter((row) => query.status === undefined || query.status.includes(row.status))
        .filter((row) => query.subscriptionId === undefined || row.subscriptionId === query.subscriptionId);
      return paginateRows(rows, query.page, query.limit).data;
    },
    async count(query, scope) {
      return world.invoices.filter((row) => visibleInvoice(row, scope))
        .filter((row) => query.status === undefined || query.status.includes(row.status))
        .filter((row) => query.subscriptionId === undefined || row.subscriptionId === query.subscriptionId).length;
    },
    async findById(id, scope = {}) {
      const row = world.invoices.find((candidate) => candidate.id === id);
      return row === undefined || !visibleInvoice(row, scope) ? null : row;
    },
    async listLines(invoiceId) {
      return invoiceId === 2
        ? [{
          id: 1, invoiceId, productId: 10, variantId: null, taxId: null, discountId: null, description: 'Seats',
          quantity: 2, unitPrice: 5000, discountAmount: 0, taxRate: 0, taxAmount: 0, amount: 10000, sortOrder: 0,
        }]
        : [];
    },
    async listPayments(invoiceId) {
      return world.payments.filter((payment) => payment.invoiceId === invoiceId);
    },
    async listDiscountUsages() { return []; },
    async lookupNames() { return names(); },
  });
  const invoices = new InvoicesService(
    invoicesRepository,
    fakeRepository<SubscriptionsGateway>({}),
    fakeRepository<DiscountsGateway>({}),
    fakeRepository<PaymentTermsGateway>({}),
    fakeRepository({}),
    audit,
    fakeRepository<InvoiceMailer>({}),
    CLOCK,
  );

  // ---- payments: real service, fake repository enforcing the scope it receives
  const visiblePayment = (row: PaymentRecord, scope: { customerId?: number; visibleInvoicesOnly?: boolean }): boolean => {
    if (scope.customerId !== undefined && row.customerId !== scope.customerId) return false;
    if (scope.visibleInvoicesOnly === true) {
      const status = world.invoices.find((invoice) => invoice.id === row.invoiceId)?.status;
      return status === 'CONFIRMED' || status === 'PAID';
    }
    return true;
  };
  const paymentsRepository = fakeRepository<PaymentsRepository>({
    async list(query, scope) {
      const rows = world.payments.filter((row) => visiblePayment(row, scope))
        .filter((row) => query.invoiceId === undefined || row.invoiceId === query.invoiceId);
      return paginateRows(rows, query.page, query.limit).data;
    },
    async count(query, scope) {
      return world.payments.filter((row) => visiblePayment(row, scope))
        .filter((row) => query.invoiceId === undefined || row.invoiceId === query.invoiceId).length;
    },
  });
  const payments = new PaymentsService(paymentsRepository, audit, CLOCK);

  const summaries = {
    async summary(customerId: number, today: Date): Promise<PortalSummaryRow> {
      world.summaryCalls.push({ customerId, today });
      return {
        activeSubscriptions: 2, nextBillingDate: '2026-11-01T00:00:00.000Z',
        outstandingAmount: 10000, overdueCount: 1, overdueAmount: 10000,
      };
    },
  };

  const portal = new PortalService(customers, subscriptions, invoices, payments, summaries, CLOCK);
  return { world, audit, portal, subscriptions };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup): Promise<TestServer> {
  const authService = new FakeAuthService().asAuthService();
  return startTestServer(t, (v1) => {
    v1.use('/portal', createPortalRouter({ authService, portalService: s.portal }));
    v1.use('/me', createPortalProfileRouter({ authService, portalService: s.portal }));
    v1.use('/subscriptions', createSubscriptionsRouter({ authService, subscriptionsService: s.subscriptions }));
  });
}

interface ListBody<T> extends ApiBody { data: T[] }
interface ItemBody<T> extends ApiBody { data: T }
type Json = Record<string, unknown>;

const keys = (value: unknown): string[] => Object.keys(value as Json).sort();

test('RBAC: every portal and /me route is CUSTOMER only; STAFF and ADMIN get 403, anonymous 401', async (t) => {
  const s = setup();
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/me', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'PATCH', path: '/me', allowed: [Role.CUSTOMER], body: { name: 'B' }, expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/summary', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/subscriptions', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/subscriptions/2', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/portal/subscriptions/2/pause', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/portal/subscriptions/2/resume', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/portal/subscriptions/2/renew', allowed: [Role.CUSTOMER], expectedAllowedStatus: 201 },
    { method: 'POST', path: '/portal/subscriptions/2/close', allowed: [Role.CUSTOMER], body: { reason: 'done' }, expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/invoices', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/invoices/2', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/invoices/2/print', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/portal/payments', allowed: [Role.CUSTOMER], expectedAllowedStatus: 200 },
  ]);
});

test('a CUSTOMER token on the staff /subscriptions router is refused with 403', async (t) => {
  const srv = await server(t, setup());
  assert.equal((await srv.request('/subscriptions', { role: Role.CUSTOMER })).status, 403);
  assert.equal((await srv.request('/subscriptions/2', { role: Role.CUSTOMER })).status, 403);
});

test("customer B gets 404 on every one of customer A's ids, and A's records are untouched", async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const attempts: { method: string; path: string; body?: unknown }[] = [
    { method: 'GET', path: '/portal/subscriptions/1' },
    { method: 'POST', path: '/portal/subscriptions/1/pause' },
    { method: 'POST', path: '/portal/subscriptions/6/resume' },
    { method: 'POST', path: '/portal/subscriptions/1/close', body: { reason: 'x' } },
    { method: 'POST', path: '/portal/subscriptions/1/renew' },
    { method: 'GET', path: '/portal/invoices/1' },
    { method: 'GET', path: '/portal/invoices/1/print' },
  ];
  for (const attempt of attempts) {
    const response = await srv.request<ApiBody>(attempt.path, {
      method: attempt.method, role: Role.CUSTOMER, ...(attempt.body === undefined ? {} : { body: attempt.body }),
    });
    assert.equal(response.status, 404, `${attempt.method} ${attempt.path}`);
    assert.equal(response.body.error?.code, 'NOT_FOUND');
  }
  assert.equal(s.world.subs.find((row) => row.id === 1)?.status, 'ACTIVE');
  assert.equal(s.world.subs.find((row) => row.id === 6)?.status, 'PAUSED');
  assert.equal(s.world.subs.length, 6, 'no renewal was created');

  // Lists never include A's rows, even when filtered by A's ids.
  const subs = await srv.request<ListBody<Json>>('/portal/subscriptions?limit=100', { role: Role.CUSTOMER });
  assert.deepEqual(subs.body.data.map((row) => row.id), [5, 4, 2]);
  const invoices = await srv.request<ListBody<Json>>('/portal/invoices?subscriptionId=1', { role: Role.CUSTOMER });
  assert.deepEqual(invoices.body.data, []);
  const payments = await srv.request<ListBody<Json>>('/portal/payments?invoiceId=1', { role: Role.CUSTOMER });
  assert.deepEqual(payments.body.data, []);
  const allPayments = await srv.request<ListBody<Json>>('/portal/payments', { role: Role.CUSTOMER });
  assert.deepEqual(allPayments.body.data.map((row) => row.id), [2]);
});

test('DRAFT subscriptions and DRAFT or CANCELLED invoices are invisible, and cannot be asked for by status', async (t) => {
  const srv = await server(t, setup());
  assert.equal((await srv.request('/portal/subscriptions/3', { role: Role.CUSTOMER })).status, 404);
  assert.equal((await srv.request('/portal/subscriptions/3/pause', { method: 'POST', role: Role.CUSTOMER })).status, 404);
  for (const id of [3, 4]) {
    assert.equal((await srv.request(`/portal/invoices/${id}`, { role: Role.CUSTOMER })).status, 404);
    assert.equal((await srv.request(`/portal/invoices/${id}/print`, { role: Role.CUSTOMER })).status, 404);
  }
  const list = await srv.request<ListBody<Json>>('/portal/invoices', { role: Role.CUSTOMER });
  assert.deepEqual(list.body.data.map((row) => row.status), ['CONFIRMED', 'PAID']);
  assert.equal(list.body.meta?.total, 2);

  for (const path of ['/portal/subscriptions?status=DRAFT', '/portal/invoices?status=DRAFT', '/portal/invoices?status=CANCELLED']) {
    const response = await srv.request<ApiBody>(path, { role: Role.CUSTOMER });
    assert.equal(response.status, 400, path);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
});

test('plan flags still apply: a locked plan blocks pause, close and renew with 409 ACTION_NOT_ALLOWED_BY_PLAN', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  for (const action of ['pause', 'close', 'renew']) {
    const response = await srv.request<ApiBody>(`/portal/subscriptions/4/${action}`, { method: 'POST', role: Role.CUSTOMER });
    assert.equal(response.status, 409, action);
    assert.equal(response.body.error?.code, 'ACTION_NOT_ALLOWED_BY_PLAN', action);
  }
  assert.equal(s.world.subs.find((row) => row.id === 4)?.status, 'ACTIVE');
  const detail = await srv.request<ItemBody<Json>>('/portal/subscriptions/4', { role: Role.CUSTOMER });
  assert.deepEqual(detail.body.data.allowedActions, []);
  const open = await srv.request<ItemBody<Json>>('/portal/subscriptions/2', { role: Role.CUSTOMER });
  assert.deepEqual(open.body.data.allowedActions, ['PAUSE', 'CLOSE', 'RENEW']);
});

test('illegal transitions keep their 409 INVALID_STATE_TRANSITION', async (t) => {
  const srv = await server(t, setup());
  const response = await srv.request<ApiBody>('/portal/subscriptions/2/resume', { method: 'POST', role: Role.CUSTOMER });
  assert.equal(response.status, 409);
  assert.equal(response.body.error?.code, 'INVALID_STATE_TRANSITION');
});

test('renew from the portal takes the auto-activate path and returns 201 with Location', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ItemBody<Json>>('/portal/subscriptions/2/renew', { method: 'POST', role: Role.CUSTOMER });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'ACTIVE');
  assert.equal(response.body.data.id, 7);
  assert.match(response.headers.get('location') ?? '', /\/portal\/subscriptions\/7$/);
  const entry = s.audit.entries.find((candidate) => candidate.action === 'subscription.renew');
  assert.equal(entry?.metadata?.autoActivated, true);
  assert.equal(entry?.actor?.customerId, CUSTOMER_B);
  assert.equal(s.world.subs.find((row) => row.id === 7)?.customerId, CUSTOMER_B);
});

test('close works without a body (reason optional) and rejects unknown body keys', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const bad = await srv.request('/portal/subscriptions/5/close', { method: 'POST', role: Role.CUSTOMER, body: { reason: 'x', force: true } });
  assert.equal(bad.status, 400);
  const response = await srv.request<ItemBody<Json>>('/portal/subscriptions/5/close', { method: 'POST', role: Role.CUSTOMER });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'CLOSED');
  const renewBody = await srv.request('/portal/subscriptions/2/renew', { method: 'POST', role: Role.CUSTOMER, body: { startDate: '2027-01-01' } });
  assert.equal(renewBody.status, 400);
});

test('portal DTOs are explicit allowlists and leak no internal fields', async (t) => {
  const srv = await server(t, setup());
  const forbiddenKeys = ['notes', 'createdById', 'billingRunId', 'recordedById', 'recordedByName', 'note', 'customerId', 'cancelReason', 'statusHistory'];

  const sub = await srv.request<ItemBody<Json>>('/portal/subscriptions/2', { role: Role.CUSTOMER });
  assert.deepEqual(keys(sub.body.data), [
    'allowedActions', 'createdAt', 'expiryDate', 'id', 'invoices', 'lines', 'nextBillingDate', 'number', 'paymentTermName',
    'planId', 'planName', 'quotationValidUntil', 'recurringAmount', 'startDate', 'status', 'subtotal', 'taxTotal', 'total',
    'updatedAt',
  ]);
  const subLines = sub.body.data.lines as Json[];
  assert.deepEqual(keys(subLines[0]), [
    'amount', 'description', 'id', 'productName', 'quantity', 'sortOrder', 'taxAmount', 'taxName', 'taxRate', 'unitPrice', 'variantLabel',
  ]);
  const recent = sub.body.data.invoices as Json[];
  assert.deepEqual(recent.map((row) => row.id), [2, 5], 'recent invoices exclude DRAFT and CANCELLED');

  const invoice = await srv.request<ItemBody<Json>>('/portal/invoices/2', { role: Role.CUSTOMER });
  assert.deepEqual(keys(invoice.body.data), [
    'amountDue', 'amountPaid', 'billingAddress', 'confirmedAt', 'currency', 'customerEmail', 'customerName', 'customerTaxId',
    'daysOverdue', 'discountTotal', 'dueDate', 'id', 'isOverdue', 'issueDate', 'lines', 'number', 'paidAt', 'paymentTermName',
    'payments', 'periodEnd', 'periodStart', 'status', 'subscriptionId', 'subscriptionNumber', 'subtotal', 'taxTotal', 'total',
  ]);
  assert.equal(invoice.body.data.isOverdue, true);
  assert.equal(invoice.body.data.daysOverdue, 45);

  const paid = await srv.request<ItemBody<Json>>('/portal/invoices/5', { role: Role.CUSTOMER });
  const embedded = paid.body.data.payments as Json[];
  assert.deepEqual(keys(embedded[0]), ['amount', 'id', 'invoiceId', 'invoiceNumber', 'method', 'paymentDate', 'reference']);

  const payments = await srv.request<ListBody<Json>>('/portal/payments', { role: Role.CUSTOMER });
  assert.deepEqual(keys(payments.body.data[0]), ['amount', 'id', 'invoiceId', 'invoiceNumber', 'method', 'paymentDate', 'reference']);

  const print = await srv.request<ItemBody<Json>>('/portal/invoices/2/print', { role: Role.CUSTOMER });
  assert.equal(print.status, 200);
  assert.equal(print.body.data.status, 'CONFIRMED');

  const lists = [
    await srv.request<ListBody<Json>>('/portal/subscriptions', { role: Role.CUSTOMER }),
    await srv.request<ListBody<Json>>('/portal/invoices', { role: Role.CUSTOMER }),
  ];
  const everything = JSON.stringify([sub.body, invoice.body, paid.body, payments.body, print.body, ...lists.map((l) => l.body)]);
  for (const key of forbiddenKeys) assert.ok(!everything.includes(`"${key}"`), `leaked key ${key}`);
  for (const secret of ['internal staff note', 'internal invoice note', 'internal payment note', 'Test Staff']) {
    assert.ok(!everything.includes(secret), `leaked value ${secret}`);
  }
});

test('list contract: limit 101, unknown keys, foreign sort keys and payment search are 400; pages past the end are empty', async (t) => {
  const srv = await server(t, setup());
  const bad = [
    '/portal/subscriptions?limit=101', '/portal/invoices?limit=101', '/portal/payments?limit=101',
    '/portal/subscriptions?customerId=501', '/portal/invoices?customerId=501', '/portal/payments?customerId=501',
    '/portal/subscriptions?sortBy=number', '/portal/invoices?sortBy=number', '/portal/payments?sortBy=createdAt',
    '/portal/invoices?billingRunId=7', '/portal/payments?search=internal', '/portal/subscriptions?page=0',
    '/portal/invoices?overdue=yes',
  ];
  for (const path of bad) {
    const response = await srv.request<ApiBody>(path, { role: Role.CUSTOMER });
    assert.equal(response.status, 400, path);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR', path);
  }
  const past = await srv.request<ListBody<Json>>('/portal/subscriptions?page=5&limit=2', { role: Role.CUSTOMER });
  assert.equal(past.status, 200);
  assert.deepEqual(past.body.data, []);
  assert.deepEqual(past.body.meta, { page: 5, limit: 2, total: 3, totalPages: 2, hasNext: false, hasPrev: true });
  const ok = await srv.request<ListBody<Json>>('/portal/invoices?status=PAID&sortBy=dueDate&sortOrder=asc', { role: Role.CUSTOMER });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.map((row) => row.id), [5]);
});

test('GET /me returns the customer profile with the account email; PATCH /me updates allowed fields and audits', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const profile = await srv.request<ItemBody<Json>>('/me', { role: Role.CUSTOMER });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.id, CUSTOMER_B);
  assert.equal(profile.body.data.email, TEST_USERS.CUSTOMER.email);
  assert.deepEqual(keys(profile.body.data), [
    'addressLine1', 'addressLine2', 'city', 'companyName', 'country', 'email', 'id', 'name', 'phone', 'postalCode', 'state', 'taxId',
  ]);

  for (const body of [{ email: 'new@x.test' }, { notes: 'hi' }, {}, { name: '' }]) {
    const response = await srv.request<ApiBody>('/me', { method: 'PATCH', role: Role.CUSTOMER, body });
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  const updated = await srv.request<ItemBody<Json>>('/me', {
    method: 'PATCH', role: Role.CUSTOMER, body: { name: '  Bee Ltd  ', city: 'Pune', phone: null },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, 'Bee Ltd');
  assert.equal(updated.body.data.city, 'Pune');
  assert.equal(s.world.customers.get(CUSTOMER_B)?.email, `c${CUSTOMER_B}@x.test`, 'email unchanged');
  assert.equal(s.world.customers.get(CUSTOMER_A)?.name, `Customer ${CUSTOMER_A}`, 'other customer untouched');
  const entry = s.audit.entries.find((candidate) => candidate.action === 'customer.profile.update');
  assert.equal(entry?.entityId, CUSTOMER_B);
  assert.equal(entry?.actor?.customerId, CUSTOMER_B);
  assert.deepEqual(entry?.metadata?.changes, { name: 'Bee Ltd', city: 'Pune', phone: null });
});

test('summary is computed for the caller’s own customer id and business today', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ItemBody<Json>>('/portal/summary', { role: Role.CUSTOMER });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, {
    activeSubscriptions: 2, nextBillingDate: '2026-11-01T00:00:00.000Z',
    outstandingAmount: 10000, overdueCount: 1, overdueAmount: 10000,
  });
  assert.deepEqual(s.world.summaryCalls.map((call) => call.customerId), [CUSTOMER_B]);
  assert.equal(s.world.summaryCalls[0]?.today.toISOString(), '2026-10-31T00:00:00.000Z');
});

test('service layer refuses a non-CUSTOMER caller even if a route forgot requireRoles', async () => {
  const s = setup();
  await assert.rejects(
    s.portal.getProfile({ userId: TEST_USERS.STAFF.id, role: Role.STAFF, email: TEST_USERS.STAFF.email }),
    (error: unknown) => (error as { status?: number }).status === 403,
  );
});
