import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role, type InvoiceDto, type InvoicePreviewDto, type InvoicePrintDto } from '@brightloop/shared';
import { AppError } from '../../core/errors.js';
import { FakeAuthService, TEST_CUSTOMER_ID, actorFor } from '../../core/testing/test-auth.js';
import { RecordingAudit, fakeRepository } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import type { InvoiceMailer } from '../../core/mail/emailjs.js';
import { toIsoDate } from '../../core/utils/dates.js';
import { formatRupees } from '../../core/utils/money.js';
import { formatSequenceNumber } from '../../core/utils/sequence-sql.js';
import type { CustomersGateway } from '../customers/customers.gateway.js';
import type { DiscountApplication, DiscountEvaluationInput, DiscountsGateway } from '../discounts/discounts.gateway.js';
import type { PaymentTermRecord, PaymentTermsGateway } from '../payment-terms/payment-terms.gateway.js';
import type { BillingSubscription, BillingSubscriptionLine, SubscriptionsGateway } from '../subscriptions/subscriptions.gateway.js';
import type {
  DiscountUsageRow, InvoiceLineRow, InvoiceRow, InvoicesRepository, Names, PaymentRow,
} from './invoices.repository.js';
import { createInvoicesRouter } from './invoices.routes.js';
import type { ListInvoicesParams } from './invoices.schema.js';
import { InvoicesService, computeInvoice } from './invoices.service.js';

const NOW = '2026-10-31T10:00:00.000Z';
const TODAY = '2026-10-31';
const STAFF = actorFor(Role.STAFF);
const CUSTOMER = actorFor(Role.CUSTOMER);
const OTHER_CUSTOMER = 2002;
const D = (date: string): Date => new Date(`${date}T00:00:00.000Z`);
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

function line(over: Partial<BillingSubscriptionLine> = {}): BillingSubscriptionLine {
  return {
    id: 11, productId: 5, variantId: null, taxId: 1, taxType: 'PERCENTAGE', taxRate: 1800, description: 'Pro seats',
    quantity: 1, unitPrice: 100000, amount: 100000, sortOrder: 0, ...over,
  };
}

function makeSub(over: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: 1, number: 'SUB-2026-000001', status: 'ACTIVE', customerId: TEST_CUSTOMER_ID, planId: 1,
    billingPeriod: 'MONTHLY', paymentTermId: 1, startDate: D('2026-10-01'), expiryDate: D('2027-10-01'),
    nextBillingDate: D('2026-10-01'), lastBilledUntil: null, lines: [line()], ...over,
  };
}

interface World {
  subs: Map<number, BillingSubscription>;
  invoices: InvoiceRow[];
  lines: InvoiceLineRow[];
  usages: DiscountUsageRow[];
  payments: PaymentRow[];
  discounts: Map<number, { usageLimit: number | null; usedCount: number }>;
  terms: Map<number, PaymentTermRecord>;
  defaultTerm: { value: PaymentTermRecord | null };
  evaluate: (input: DiscountEvaluationInput) => DiscountApplication[];
  listCalls: { query: ListInvoicesParams; scope: unknown }[];
  counter: { value: number };
  customerSnapshots: number;
}

function seedInvoice(world: World, over: Partial<InvoiceRow> = {}): InvoiceRow {
  const id = world.invoices.length + 1;
  const row: InvoiceRow = {
    id, number: formatSequenceNumber('INVOICE', 2026, 900 + id), subscriptionId: 1, customerId: TEST_CUSTOMER_ID,
    paymentTermId: 1, status: 'DRAFT', currency: 'INR', periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z', issueDate: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-16T00:00:00.000Z',
    customerName: 'Acme Ltd', customerEmail: 'billing@acme.test', customerTaxId: null, billingAddress: null,
    subtotal: 100000, discountTotal: 0, taxTotal: 18000, total: 118000, amountPaid: 0, amountDue: 0,
    confirmedAt: null, sentAt: null, paidAt: null, cancelledAt: null, cancelReason: null, notes: null,
    billingRunId: null, createdById: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
  world.invoices.push(row);
  return row;
}

class FakeInvoiceMailer implements InvoiceMailer {
  readonly sent: Parameters<InvoiceMailer['sendInvoice']>[0][] = [];
  failure: Error | null = null;

  async sendInvoice(input: Parameters<InvoiceMailer['sendInvoice']>[0]): Promise<void> {
    if (this.failure !== null) throw this.failure;
    this.sent.push(input);
  }
}

function setup() {
  const world: World = {
    subs: new Map([[1, makeSub()]]),
    invoices: [], lines: [], usages: [], payments: [],
    discounts: new Map(),
    terms: new Map([[1, { id: 1, name: 'Net 15', dueDays: 15, isDefault: false, isActive: true }]]),
    defaultTerm: { value: { id: 9, name: 'Net 30', dueDays: 30, isDefault: true, isActive: true } },
    evaluate: () => [],
    listCalls: [],
    counter: { value: 0 },
    customerSnapshots: 0,
  };
  const audit = new RecordingAudit();
  const mailer = new FakeInvoiceMailer();

  const emptyNames = (): Names => ({
    subscriptions: new Map([...world.subs.values()].map((sub) => [sub.id, sub.number])),
    products: new Map([[5, 'Pro plan']]),
    variants: new Map(),
    taxes: new Map([[1, { name: 'GST 18%', type: 'PERCENTAGE' }], [2, { name: 'Flat levy', type: 'FIXED' }]]),
    discounts: new Map([[8, 'Spring'], [9, 'Loyalty']]),
    paymentTerms: new Map([[1, 'Net 15']]),
    users: new Map([[2, 'Test Staff']]),
  });

  const visible = (row: InvoiceRow, scope: { customerId?: number; statuses?: readonly string[] }): boolean =>
    (scope.customerId === undefined || row.customerId === scope.customerId)
    && (scope.statuses === undefined || scope.statuses.includes(row.status));

  const repository = fakeRepository<InvoicesRepository>({
    async list(query, scope) {
      world.listCalls.push({ query, scope });
      return world.invoices.filter((row) => visible(row, scope)).slice(0, query.limit);
    },
    async count(_query, scope) { return world.invoices.filter((row) => visible(row, scope)).length; },
    async findById(id, scope = {}) {
      const row = world.invoices.find((invoice) => invoice.id === id);
      return row !== undefined && visible(row, scope) ? { ...row } : null;
    },
    async listLines(invoiceId) { return world.lines.filter((l) => l.invoiceId === invoiceId); },
    async listPayments(invoiceId) { return world.payments.filter((p) => p.invoiceId === invoiceId); },
    async listDiscountUsages(invoiceId) { return world.usages.filter((u) => u.invoiceId === invoiceId); },
    async lookupNames() { return emptyNames(); },
    // No await inside: the whole method runs atomically, like the single database transaction.
    async generate(write) {
      const sub = world.subs.get(write.subscriptionId);
      if (sub === undefined || sub.status !== 'ACTIVE' || sub.nextBillingDate?.getTime() !== write.expectedNextBillingDate.getTime()) {
        return { kind: 'STALE' };
      }
      const discountIds = [...new Set(write.usages.map((usage) => usage.discountId))].sort((a, b) => a - b);
      for (const id of discountIds) {
        const discount = world.discounts.get(id);
        if (discount !== undefined && discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) {
          return { kind: 'DISCOUNT_LIMIT', discountId: id };
        }
      }
      const duplicate = world.invoices.some((row) => row.subscriptionId === write.subscriptionId
        && row.periodStart === write.periodStart.toISOString() && row.periodEnd === write.periodEnd.toISOString());
      if (duplicate) throw sqlError('23505');
      sub.nextBillingDate = write.periodEnd;
      sub.lastBilledUntil = write.periodEnd;
      for (const id of discountIds) {
        const discount = world.discounts.get(id);
        if (discount !== undefined) discount.usedCount += 1;
      }
      world.counter.value += 1;
      const invoice = seedInvoice(world, {
        number: formatSequenceNumber('INVOICE', write.year, world.counter.value),
        subscriptionId: write.subscriptionId, customerId: write.customerId, paymentTermId: write.paymentTermId,
        status: write.status, currency: write.currency, periodStart: write.periodStart.toISOString(),
        periodEnd: write.periodEnd.toISOString(), issueDate: write.issueDate.toISOString(),
        dueDate: write.dueDate.toISOString(), customerName: write.customerName, customerEmail: write.customerEmail,
        customerTaxId: write.customerTaxId, billingAddress: write.billingAddress, subtotal: write.subtotal,
        discountTotal: write.discountTotal, taxTotal: write.taxTotal, total: write.total, amountDue: write.amountDue,
        confirmedAt: write.confirmedAt?.toISOString() ?? null, paidAt: write.paidAt?.toISOString() ?? null,
        billingRunId: write.billingRunId, createdById: write.createdById,
      });
      write.lines.forEach((l, index) => world.lines.push({ id: world.lines.length + 1, invoiceId: invoice.id, ...l, sortOrder: index }));
      write.usages.forEach((u) => world.usages.push({
        id: world.usages.length + 1, discountId: u.discountId, invoiceId: invoice.id, subscriptionId: write.subscriptionId,
        amount: u.amount, createdAt: NOW,
      }));
      return { kind: 'CREATED', invoice: { ...invoice } };
    },
    async confirm(id, write) {
      const row = world.invoices.find((invoice) => invoice.id === id);
      if (row === undefined || row.status !== 'DRAFT' || row.total !== write.total) return null;
      Object.assign(row, {
        status: write.settled ? 'PAID' : 'CONFIRMED', confirmedAt: write.now.toISOString(),
        paidAt: write.settled ? write.now.toISOString() : null, amountDue: write.settled ? 0 : write.total,
      });
      return { ...row };
    },
    async cancel(id, reason, now) {
      const row = world.invoices.find((invoice) => invoice.id === id);
      if (row === undefined || (row.status !== 'DRAFT' && row.status !== 'CONFIRMED') || row.amountPaid > 0) return null;
      Object.assign(row, { status: 'CANCELLED', cancelledAt: now.toISOString(), cancelReason: reason, amountDue: 0 });
      for (const usage of world.usages.filter((u) => u.invoiceId === id)) {
        const discount = world.discounts.get(usage.discountId);
        if (discount !== undefined) discount.usedCount = Math.max(discount.usedCount - 1, 0);
      }
      for (let i = world.usages.length - 1; i >= 0; i -= 1) if (world.usages[i]!.invoiceId === id) world.usages.splice(i, 1);
      return { ...row };
    },
    async updateDraft(id, fields) {
      const row = world.invoices.find((invoice) => invoice.id === id);
      if (row === undefined || row.status !== 'DRAFT') return null;
      if (fields.notes !== undefined) row.notes = fields.notes;
      if (fields.dueDate !== undefined) row.dueDate = fields.dueDate.toISOString();
      return { ...row };
    },
    async markSent(id, now) {
      const row = world.invoices.find((invoice) => invoice.id === id);
      if (row === undefined || (row.status !== 'CONFIRMED' && row.status !== 'PAID')) return null;
      row.sentAt = now.toISOString();
      return { ...row };
    },
  });

  const subscriptions = {
    async getForBilling(id: number) {
      const sub = world.subs.get(id);
      return sub === undefined ? null : { ...sub, lines: [...sub.lines] };
    },
    async listDueIds() { return []; },
    async closeBySystem() { return false; },
    async listAutoCloseIds() { return []; },
  } satisfies SubscriptionsGateway;
  const discounts: DiscountsGateway = {
    async evaluate(input) { return world.evaluate(input); },
    async listAttachedForSubscription() { return []; },
  };
  const paymentTerms: PaymentTermsGateway = {
    async getById(id) { return world.terms.get(id) ?? null; },
    async getDefault() { return world.defaultTerm.value; },
  };
  const customers: CustomersGateway = {
    async getById() { return null; },
    async getOrCreateForUser() { throw new Error('unused'); },
    async snapshot() {
      world.customerSnapshots += 1;
      return { name: 'Acme Ltd', email: 'billing@acme.test', taxId: 'GSTIN123', billingAddress: '1 Road, Pune, India' };
    },
  };
  const service = new InvoicesService(
    repository, subscriptions, discounts, paymentTerms, customers, audit, mailer, () => new Date(NOW),
  );
  return { world, audit, mailer, service };
}

type Setup = ReturnType<typeof setup>;

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/invoices', createInvoicesRouter({
    authService: auth.asAuthService(), invoicesService: s.service,
  })));
}

const system = { actor: null };
const generateAsOf = (s: Setup, subscriptionId = 1, asOf = D(TODAY), extra: { autoConfirm?: boolean } = {}) =>
  s.service.generateForSubscription(subscriptionId, asOf, { ...system, ...extra });

test('RBAC matrix: ADMIN and STAFF on every route, CUSTOMER refused, anonymous 401', async (t) => {
  const s = setup();
  seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 118000 });
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/invoices', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/invoices/preview?subscriptionId=1', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/invoices/generate', allowed: [Role.ADMIN, Role.STAFF], body: { subscriptionId: 1 } },
    { method: 'GET', path: '/invoices/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'PATCH', path: '/invoices/1', allowed: [Role.ADMIN, Role.STAFF], body: { notes: 'x' } },
    { method: 'POST', path: '/invoices/1/confirm', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'POST', path: '/invoices/1/cancel', allowed: [Role.ADMIN, Role.STAFF], body: { reason: 'dup' } },
    { method: 'POST', path: '/invoices/1/send', allowed: [Role.ADMIN, Role.STAFF] },
    { method: 'GET', path: '/invoices/1/print', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
  ]);
});

test('20 parallel generate calls create exactly one invoice, the rest are ALREADY_BILLED, numbers stay consecutive', async () => {
  const s = setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => generateAsOf(s)));
  const created = results.filter((result) => result.status === 'CREATED');
  const skipped = results.filter((result) => result.status === 'SKIPPED');
  assert.equal(created.length, 1);
  assert.equal(skipped.length, 19);
  assert.ok(skipped.every((result) => result.status === 'SKIPPED' && result.reason === 'ALREADY_BILLED'));
  assert.equal(s.world.invoices.length, 1);
  assert.equal(s.world.invoices[0]?.number, 'INV-2026-000001');
  assert.equal(s.world.subs.get(1)?.nextBillingDate?.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(s.audit.actions().filter((action) => action === 'invoice.generate').length, 1);
  assert.equal(s.audit.entries[0]?.actor, null);
});

test('a duplicate period caught by the unique constraint is ALREADY_BILLED (409 over HTTP)', async (t) => {
  const s = setup();
  seedInvoice(s.world, { periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' });
  const outcome = await generateAsOf(s);
  assert.deepEqual(outcome, { status: 'SKIPPED', reason: 'ALREADY_BILLED', message: 'This billing period has already been invoiced' });
  const response = await (await server(t, s)).request<ApiBody>('/invoices/generate', { method: 'POST', role: Role.STAFF, body: { subscriptionId: 1 } });
  assert.equal(response.status, 409);
  assert.equal(response.body.error?.code, 'ALREADY_BILLED');
  assert.equal(s.world.invoices.length, 1);
});

test('POST /generate returns 201 with Location and the invoice, then the next call is NOTHING_TO_BILL', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: InvoiceDto }>('/invoices/generate', {
    method: 'POST', role: Role.STAFF, body: { subscriptionId: 1, asOf: TODAY },
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/invoices\/1$/);
  assert.equal(response.body.data.status, 'DRAFT');
  assert.equal(response.body.data.createdById, 2);
  assert.equal(response.body.data.lines.length, 1);
  assert.equal(response.body.data.lines[0]?.productName, 'Pro plan');
  assert.deepEqual(s.audit.actions(), ['invoice.generate']);
  assert.equal(s.audit.entries[0]?.actor?.userId, 2);
  const again = await srv.request<ApiBody>('/invoices/generate', { method: 'POST', role: Role.STAFF, body: { subscriptionId: 1 } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error?.code, 'NOTHING_TO_BILL');
});

test('generate validates the body: strict keys, date-only asOf not in the future, unknown subscription is 404', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/invoices/generate', { method: 'POST', role: Role.ADMIN, body });
  for (const body of [
    {}, { subscriptionId: 0 }, { subscriptionId: 1.5 }, { subscriptionId: 1, total: 5 },
    { subscriptionId: 1, asOf: '2026-10-31T10:00:00Z' }, { subscriptionId: 1, asOf: 'nope' }, { subscriptionId: 1, autoConfirm: 'yes' },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const future = await post({ subscriptionId: 1, asOf: '2026-11-01' });
  assert.equal(future.status, 400);
  assert.equal(future.body.error?.details?.[0]?.field, 'asOf');
  assert.equal((await post({ subscriptionId: 77 })).status, 404);
  assert.equal(s.world.invoices.length, 0);
});

test('totals equal the exact sum of the stored lines for awkward rates, fixed taxes and discounts', async () => {
  const s = setup();
  s.world.subs.set(1, makeSub({
    lines: [
      line({ id: 11, quantity: 1, unitPrice: 33333, taxId: 1, taxRate: 1800, description: 'A' }),
      line({ id: 12, quantity: 3, unitPrice: 1999, taxId: 2, taxType: 'FIXED', taxRate: 250, description: 'B' }),
      line({ id: 13, productId: 6, quantity: 7, unitPrice: 14285, taxId: 1, taxRate: 1250, description: 'C' }),
    ],
  }));
  s.world.discounts.set(8, { usageLimit: null, usedCount: 0 });
  s.world.discounts.set(9, { usageLimit: null, usedCount: 0 });
  s.world.evaluate = () => [
    { discountId: 8, lineId: 13, amount: 1000 }, { discountId: 9, lineId: 13, amount: 2333 },
  ];
  const outcome = await generateAsOf(s);
  assert.equal(outcome.status, 'CREATED');
  const invoice = s.world.invoices[0]!;
  const stored = s.world.lines.filter((l) => l.invoiceId === invoice.id);
  assert.deepEqual(stored.map((l) => [l.amount, l.taxAmount, l.discountAmount]), [
    [33333, 6000, 0], [5997, 750, 0], [96662, 12083, 3333],
  ]);
  assert.equal(stored[2]?.discountId, null, 'two discounts on a line leave discountId null');
  assert.equal(invoice.subtotal, 135992);
  assert.equal(invoice.discountTotal, 3333);
  assert.equal(invoice.taxTotal, 18833);
  assert.equal(invoice.total, 154825);
  assert.equal(invoice.subtotal, stored.reduce((sum, l) => sum + l.amount, 0));
  assert.equal(invoice.taxTotal, stored.reduce((sum, l) => sum + l.taxAmount, 0));
  assert.equal(invoice.total, invoice.subtotal + invoice.taxTotal);
  assert.deepEqual(s.world.usages.map((u) => [u.discountId, u.amount]), [[8, 1000], [9, 2333]]);
  for (const value of [invoice.subtotal, invoice.taxTotal, invoice.total, ...stored.flatMap((l) => [l.amount, l.taxAmount])]) {
    assert.ok(Number.isInteger(value));
  }
});

test('computeInvoice: one discount on a line sets discountId, rounding is per line, 18% of 33333 is 6000', () => {
  const computed = computeInvoice(
    [line({ id: 1, quantity: 1, unitPrice: 33333 }), line({ id: 2, quantity: 1, unitPrice: 33333, taxId: null, taxType: null, taxRate: 0 })],
    [{ discountId: 4, lineId: 1, amount: 3 }],
  );
  assert.equal(computed.lines[0]?.discountId, 4);
  assert.equal(computed.lines[0]?.amount, 33330);
  assert.equal(computed.lines[0]?.taxAmount, 5999);
  assert.equal(computed.lines[1]?.taxAmount, 0);
  assert.equal(computed.lines[1]?.taxRate, 0);
  assert.equal(computed.total, 33330 + 5999 + 33333);
  assert.deepEqual(computed.usages, [{ discountId: 4, amount: 3 }]);
  assert.throws(() => computeInvoice([line()], [{ discountId: 1, lineId: 99, amount: 1 }]));
  assert.throws(() => computeInvoice([line()], [{ discountId: 1, lineId: 11, amount: 100001 }]));
  assert.throws(() => computeInvoice([line({ unitPrice: 2147483647 })], []), (error: unknown) => error instanceof AppError && error.status === 400);
});

test('a discount used exactly up to its limit works, the next subscription gets none', async () => {
  const s = setup();
  s.world.subs.set(2, makeSub({ id: 2, number: 'SUB-2026-000002' }));
  s.world.discounts.set(9, { usageLimit: 2, usedCount: 1 });
  s.world.evaluate = (input) => {
    const discount = s.world.discounts.get(9)!;
    if (discount.usageLimit !== null && discount.usedCount >= discount.usageLimit) return [];
    return [{ discountId: 9, lineId: input.lines[0]!.lineId, amount: 10000 }];
  };
  assert.equal((await generateAsOf(s, 1)).status, 'CREATED');
  assert.equal(s.world.discounts.get(9)?.usedCount, 2);
  assert.equal(s.world.invoices[0]?.discountTotal, 10000);
  assert.equal((await generateAsOf(s, 2)).status, 'CREATED');
  assert.equal(s.world.invoices[1]?.discountTotal, 0);
  assert.equal(s.world.discounts.get(9)?.usedCount, 2);
  assert.equal(s.world.usages.length, 1);
});

test('usedCount race: limit 1 used by two subscriptions in parallel is applied once, the loser is retried without it', async () => {
  const s = setup();
  s.world.subs.set(2, makeSub({ id: 2, number: 'SUB-2026-000002' }));
  s.world.discounts.set(9, { usageLimit: 1, usedCount: 0 });
  // A stale evaluation: both calls see the discount, only the conditional increment decides.
  s.world.evaluate = (input) => [{ discountId: 9, lineId: input.lines[0]!.lineId, amount: 10000 }];
  const results = await Promise.all([generateAsOf(s, 1), generateAsOf(s, 2)]);
  assert.deepEqual(results.map((r) => r.status), ['CREATED', 'CREATED']);
  assert.equal(s.world.discounts.get(9)?.usedCount, 1);
  assert.equal(s.world.usages.length, 1);
  assert.deepEqual(s.world.invoices.map((i) => i.discountTotal).sort(), [0, 10000]);
  const free = s.world.invoices.find((i) => i.discountTotal === 0)!;
  assert.equal(free.subtotal, 100000);
  assert.equal(free.total, 118000);
  assert.deepEqual(s.world.invoices.map((i) => i.number).sort(), ['INV-2026-000001', 'INV-2026-000002']);
});

test('month-end periods are computed from the startDate anchor (31 Jan, 28 Feb, 31 Mar) and leap years', async () => {
  const s = setup();
  s.world.subs.set(1, makeSub({ startDate: D('2026-01-31'), nextBillingDate: D('2026-01-31'), expiryDate: D('2027-01-31') }));
  for (let i = 0; i < 4; i += 1) assert.equal((await generateAsOf(s, 1, D('2026-04-30'))).status, 'CREATED');
  assert.equal((await generateAsOf(s, 1, D('2026-04-30'))).status, 'SKIPPED');
  assert.deepEqual(s.world.invoices.map((i) => [toIsoDate(new Date(i.periodStart)), toIsoDate(new Date(i.periodEnd))]), [
    ['2026-01-31', '2026-02-28'], ['2026-02-28', '2026-03-31'], ['2026-03-31', '2026-04-30'], ['2026-04-30', '2026-05-31'],
  ]);
  assert.equal(toIsoDate(s.world.subs.get(1)!.nextBillingDate!), '2026-05-31');

  const leap = setup();
  leap.world.subs.set(1, makeSub({ startDate: D('2024-01-31'), nextBillingDate: D('2024-01-31'), expiryDate: D('2025-01-31') }));
  const asOf = D('2024-03-31');
  for (let i = 0; i < 3; i += 1) {
    const outcome = await leap.service.generateForSubscription(1, asOf, { actor: null });
    assert.equal(outcome.status, 'CREATED');
  }
  assert.deepEqual(leap.world.invoices.map((i) => toIsoDate(new Date(i.periodStart))), ['2024-01-31', '2024-02-29', '2024-03-31']);
  assert.equal(toIsoDate(new Date(leap.world.invoices[2]!.periodEnd)), '2024-04-30');
});

test('the invoice carries the asOf business date as issue date and a period that follows a weekly anchor', async () => {
  const s = setup();
  s.world.subs.set(1, makeSub({ billingPeriod: 'WEEKLY', startDate: D('2026-10-05'), nextBillingDate: D('2026-10-12'), expiryDate: null }));
  const outcome = await s.service.generateForSubscription(1, new Date('2026-10-20T18:45:00.000Z'), { actor: null });
  assert.equal(outcome.status, 'CREATED');
  const invoice = s.world.invoices[0]!;
  assert.equal(invoice.issueDate, '2026-10-20T00:00:00.000Z');
  assert.equal(invoice.periodStart, '2026-10-12T00:00:00.000Z');
  assert.equal(invoice.periodEnd, '2026-10-19T00:00:00.000Z');
});

test('skip reasons give SKIPPED NOTHING_TO_BILL and 409 NOTHING_TO_BILL on the manual endpoint', async (t) => {
  const cases: [string, Partial<BillingSubscription>][] = [
    ['not ACTIVE', { status: 'PAUSED' }],
    ['next billing date in the future', { nextBillingDate: D('2026-11-01') }],
    ['past expiry', { expiryDate: D('2026-09-30') }],
    ['null next billing date', { nextBillingDate: null }],
    ['no lines', { lines: [] }],
  ];
  for (const [label, over] of cases) {
    const s = setup();
    s.world.subs.set(1, makeSub(over));
    const outcome = await generateAsOf(s);
    assert.equal(outcome.status, 'SKIPPED', label);
    assert.equal(outcome.status === 'SKIPPED' ? outcome.reason : '', 'NOTHING_TO_BILL', label);
    assert.equal(s.world.invoices.length, 0, label);
    const own = await server(t, s);
    const response = await own.request<ApiBody>('/invoices/generate', { method: 'POST', role: Role.STAFF, body: { subscriptionId: 1 } });
    assert.equal(response.status, 409, label);
    assert.equal(response.body.error?.code, 'NOTHING_TO_BILL', label);
  }
});

test('an expiry date on the period start day is still billed', async () => {
  const s = setup();
  s.world.subs.set(1, makeSub({ expiryDate: D('2026-10-01') }));
  assert.equal((await generateAsOf(s)).status, 'CREATED');
});

test('dueDate = issueDate + payment term days; falls back to the default term, then to 0 days', async () => {
  const withTerm = setup();
  await generateAsOf(withTerm);
  assert.equal(withTerm.world.invoices[0]?.dueDate, '2026-11-15T00:00:00.000Z');
  assert.equal(withTerm.world.invoices[0]?.paymentTermId, 1);

  const fallback = setup();
  fallback.world.subs.set(1, makeSub({ paymentTermId: null }));
  await generateAsOf(fallback);
  assert.equal(fallback.world.invoices[0]?.dueDate, '2026-11-30T00:00:00.000Z');
  assert.equal(fallback.world.invoices[0]?.paymentTermId, 9);

  const missing = setup();
  missing.world.subs.set(1, makeSub({ paymentTermId: 404 }));
  await generateAsOf(missing);
  assert.equal(missing.world.invoices[0]?.dueDate, '2026-11-30T00:00:00.000Z');

  const none = setup();
  none.world.defaultTerm.value = null;
  none.world.subs.set(1, makeSub({ paymentTermId: null }));
  await generateAsOf(none);
  assert.equal(none.world.invoices[0]?.dueDate, '2026-10-31T00:00:00.000Z');
  assert.equal(none.world.invoices[0]?.paymentTermId, null);
});

test('the customer snapshot is copied onto the invoice and the currency comes from the environment', async () => {
  const s = setup();
  await generateAsOf(s);
  const invoice = s.world.invoices[0]!;
  assert.deepEqual(
    [invoice.customerName, invoice.customerEmail, invoice.customerTaxId, invoice.billingAddress, invoice.currency],
    ['Acme Ltd', 'billing@acme.test', 'GSTIN123', '1 Road, Pune, India', 'INR'],
  );
  assert.equal(invoice.createdById, null);
  assert.equal(invoice.billingRunId, null);
});

test('billingRunId and the acting user are recorded when passed', async () => {
  const s = setup();
  await s.service.generateForSubscription(1, D(TODAY), { actor: STAFF, billingRunId: 7 });
  assert.equal(s.world.invoices[0]?.billingRunId, 7);
  assert.equal(s.world.invoices[0]?.createdById, STAFF.userId);
  await assert.rejects(s.service.generateForSubscription(1, D(TODAY), { actor: CUSTOMER }), { status: 403 });
});

test('autoConfirm gives CONFIRMED with amountDue = total, otherwise DRAFT with amountDue 0; confirm settles it', async () => {
  const auto = setup();
  await generateAsOf(auto, 1, D(TODAY), { autoConfirm: true });
  const confirmed = auto.world.invoices[0]!;
  assert.deepEqual([confirmed.status, confirmed.amountDue, confirmed.total], ['CONFIRMED', 118000, 118000]);
  assert.equal(confirmed.confirmedAt, NOW);

  const s = setup();
  await generateAsOf(s);
  const draft = s.world.invoices[0]!;
  assert.deepEqual([draft.status, draft.amountDue, draft.confirmedAt], ['DRAFT', 0, null]);
  const result = await s.service.confirm(STAFF, draft.id);
  assert.deepEqual([result.status, result.amountDue, result.confirmedAt], ['CONFIRMED', 118000, NOW]);
  await assert.rejects(s.service.confirm(STAFF, draft.id), { status: 409, code: 'INVALID_STATE_TRANSITION' });
  assert.deepEqual(s.audit.actions(), ['invoice.generate', 'invoice.confirm']);
});

test('parallel confirm: exactly one wins', async () => {
  const s = setup();
  await generateAsOf(s);
  const results = await Promise.allSettled([s.service.confirm(STAFF, 1), s.service.confirm(STAFF, 1)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' && (rejected.reason as AppError).code, 'INVALID_STATE_TRANSITION');
});

test('a zero-total invoice is settled when confirmed: it becomes PAID with nothing due', async () => {
  const s = setup();
  s.world.discounts.set(9, { usageLimit: null, usedCount: 0 });
  s.world.evaluate = () => [{ discountId: 9, lineId: 11, amount: 100000 }];
  await generateAsOf(s, 1, D(TODAY), { autoConfirm: true });
  const invoice = s.world.invoices[0]!;
  assert.deepEqual([invoice.total, invoice.status, invoice.amountDue], [0, 'PAID', 0]);
  assert.notEqual(invoice.paidAt, null);
});

test('cancel: reason required, blocked by payments, restores discount usage and never moves nextBillingDate', async (t) => {
  const s = setup();
  s.world.discounts.set(9, { usageLimit: 5, usedCount: 0 });
  s.world.evaluate = () => [{ discountId: 9, lineId: 11, amount: 10000 }];
  await generateAsOf(s);
  assert.equal(s.world.discounts.get(9)?.usedCount, 1);
  const nextBilling = s.world.subs.get(1)!.nextBillingDate!.toISOString();
  const srv = await server(t, s);
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x', extra: 1 }]) {
    assert.equal((await srv.request('/invoices/1/cancel', { method: 'POST', role: Role.STAFF, body })).status, 400, JSON.stringify(body));
  }
  const cancelled = await srv.request<ApiBody & { data: InvoiceDto }>('/invoices/1/cancel', {
    method: 'POST', role: Role.STAFF, body: { reason: 'Billed in error' },
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, 'CANCELLED');
  assert.equal(cancelled.body.data.cancelReason, 'Billed in error');
  assert.equal(s.world.discounts.get(9)?.usedCount, 0);
  assert.equal(s.world.usages.length, 0);
  assert.equal(s.world.subs.get(1)?.nextBillingDate?.toISOString(), nextBilling);
  assert.ok(s.audit.actions().includes('invoice.cancel'));

  const again = await srv.request<ApiBody>('/invoices/1/cancel', { method: 'POST', role: Role.STAFF, body: { reason: 'again' } });
  assert.equal(again.status, 409);
  const rebill = await srv.request<ApiBody>('/invoices/generate', { method: 'POST', role: Role.STAFF, body: { subscriptionId: 1 } });
  assert.equal(rebill.body.error?.code, 'NOTHING_TO_BILL', 'a cancelled period is not re-billed');

  const paid = seedInvoice(s.world, { status: 'CONFIRMED', amountPaid: 5000, amountDue: 113000 });
  const blocked = await srv.request<ApiBody>(`/invoices/${paid.id}/cancel`, { method: 'POST', role: Role.ADMIN, body: { reason: 'oops' } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error?.code, 'INVALID_STATE_TRANSITION');
  assert.equal(s.world.invoices[1]?.status, 'CONFIRMED');
  const settled = seedInvoice(s.world, { status: 'PAID', amountPaid: 118000 });
  assert.equal((await srv.request(`/invoices/${settled.id}/cancel`, { method: 'POST', role: Role.ADMIN, body: { reason: 'oops' } })).status, 409);
});

test('PATCH works on DRAFT only (notes, dueDate), validates input and audits the change', async (t) => {
  const s = setup();
  await generateAsOf(s);
  const srv = await server(t, s);
  const patch = (body: unknown, id = 1) => srv.request<ApiBody & { data: InvoiceDto }>(`/invoices/${id}`, { method: 'PATCH', role: Role.STAFF, body });
  const ok = await patch({ notes: 'Thanks', dueDate: '2026-12-01' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.notes, 'Thanks');
  assert.equal(ok.body.data.dueDate, '2026-12-01T00:00:00.000Z');
  assert.ok(s.audit.actions().includes('invoice.update'));
  assert.equal((await patch({ notes: null })).status, 200);
  for (const body of [{}, { total: 1 }, { status: 'PAID' }, { dueDate: 'soon' }, { notes: 5 }]) {
    assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  }
  const early = await patch({ dueDate: '2026-10-30' });
  assert.equal(early.status, 400);
  assert.equal(early.body.error?.details?.[0]?.field, 'dueDate');
  assert.equal((await patch({ notes: 'x' }, 99)).status, 404);
  await s.service.confirm(STAFF, 1);
  const locked = await patch({ notes: 'late' });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error?.code, 'INVALID_STATE_TRANSITION');
});

test('send: only CONFIRMED or PAID, failure leaves sentAt null with 503 DELIVERY_FAILED and is retryable', async (t) => {
  const s = setup();
  const draft = seedInvoice(s.world);
  const confirmed = seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 118000, dueDate: '2026-11-15T00:00:00.000Z' });
  const cancelled = seedInvoice(s.world, { status: 'CANCELLED' });
  const paid = seedInvoice(s.world, { status: 'PAID', amountPaid: 118000 });
  const srv = await server(t, s);
  const send = (id: number) => srv.request<ApiBody & { data: InvoiceDto }>(`/invoices/${id}/send`, { method: 'POST', role: Role.STAFF });
  assert.equal((await send(draft.id)).status, 409);
  assert.equal((await send(cancelled.id)).status, 409);
  assert.equal((await send(999)).status, 404);

  s.mailer.failure = new Error('provider exploded with secret=abc');
  const failed = await send(confirmed.id);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error?.code, 'DELIVERY_FAILED');
  assert.ok(!JSON.stringify(failed.body).includes('secret'));
  assert.equal(confirmed.sentAt, null);
  assert.equal(s.mailer.sent.length, 0);

  s.mailer.failure = new AppError({ status: 503, code: 'EMAIL_DELIVERY_FAILED', message: 'Invoice email is not configured.' });
  const unconfigured = await send(confirmed.id);
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.error?.code, 'DELIVERY_FAILED');
  assert.equal(unconfigured.body.message, 'Invoice email is not configured.');

  s.mailer.failure = null;
  const retried = await send(confirmed.id);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.sentAt, NOW);
  assert.deepEqual(s.mailer.sent[0], {
    toEmail: 'billing@acme.test', name: 'Acme Ltd', invoiceNumber: confirmed.number, total: 'INR 1,180.00',
    dueDate: '2026-11-15', portalUrl: `http://localhost:3000/portal/invoices/${confirmed.id}`,
  });
  assert.equal((await send(paid.id)).status, 200);
  assert.equal(s.audit.actions().filter((a) => a === 'invoice.send').length, 2);
});

test('print returns the tax summary grouped by rate, payments received and the balance', async (t) => {
  const s = setup();
  const invoice = seedInvoice(s.world, {
    status: 'CONFIRMED', subtotal: 19000, taxTotal: 3200, total: 22200, amountPaid: 5000, amountDue: 17200,
    paymentTermId: 1, notes: 'internal only',
  });
  const base = { invoiceId: invoice.id, productId: 5, variantId: null, discountId: null, discountAmount: 0, description: 'Item' };
  s.world.lines.push(
    { id: 1, ...base, taxId: 1, quantity: 1, unitPrice: 10000, taxRate: 1800, taxAmount: 1800, amount: 10000, sortOrder: 0 },
    { id: 2, ...base, taxId: 1, quantity: 1, unitPrice: 5000, taxRate: 1800, taxAmount: 900, amount: 5000, sortOrder: 1 },
    { id: 3, ...base, taxId: 2, quantity: 2, unitPrice: 2000, taxRate: 250, taxAmount: 500, amount: 4000, sortOrder: 2 },
  );
  s.world.payments.push({
    id: 1, invoiceId: invoice.id, customerId: invoice.customerId, method: 'UPI', amount: 5000,
    paymentDate: '2026-10-20T00:00:00.000Z', reference: 'UPI-1', note: 'secret note', recordedById: 2, createdAt: NOW, updatedAt: NOW,
  });
  const response = await (await server(t, s)).request<ApiBody & { data: InvoicePrintDto }>(`/invoices/${invoice.id}/print`, { role: Role.STAFF });
  assert.equal(response.status, 200);
  const print = response.body.data;
  assert.deepEqual(print.taxSummary, [
    { taxName: 'Flat levy', type: 'FIXED', rate: 250, taxableAmount: 4000, taxAmount: 500 },
    { taxName: 'GST 18%', type: 'PERCENTAGE', rate: 1800, taxableAmount: 15000, taxAmount: 2700 },
  ]);
  assert.deepEqual(print.payments, [{ method: 'UPI', amount: 5000, paymentDate: '2026-10-20T00:00:00.000Z', reference: 'UPI-1' }]);
  assert.equal(print.amountPaid, 5000);
  assert.equal(print.amountDue, 17200);
  assert.equal(print.company.name, 'Brightloop');
  assert.equal(print.company.taxId, null);
  assert.equal(print.lines.length, 3);
  assert.equal(print.subscriptionNumber, 'SUB-2026-000001');
  assert.ok(!JSON.stringify(print).includes('internal only'), 'staff notes are not printed');
  assert.ok(!JSON.stringify(print).includes('secret note'));
});

test('detail carries lines, payments, discount usages; isOverdue/daysOverdue are computed and never stored', async () => {
  const s = setup();
  const overdue = seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 118000, dueDate: '2026-10-21T00:00:00.000Z' });
  const dueToday = seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 118000, dueDate: '2026-10-31T00:00:00.000Z' });
  const paidLate = seedInvoice(s.world, { status: 'PAID', amountDue: 0, amountPaid: 118000, dueDate: '2026-10-01T00:00:00.000Z' });
  const draftLate = seedInvoice(s.world, { status: 'DRAFT', dueDate: '2026-10-01T00:00:00.000Z' });
  const zeroDue = seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 0, dueDate: '2026-10-01T00:00:00.000Z' });
  s.world.usages.push({ id: 1, discountId: 9, invoiceId: overdue.id, subscriptionId: 1, amount: 100, createdAt: NOW });
  s.world.payments.push({
    id: 1, invoiceId: overdue.id, customerId: overdue.customerId, method: 'CASH', amount: 1, paymentDate: NOW,
    reference: null, note: null, recordedById: 2, createdAt: NOW, updatedAt: NOW,
  });
  const detail = await s.service.get(STAFF, overdue.id);
  assert.deepEqual([detail.isOverdue, detail.daysOverdue], [true, 10]);
  assert.equal(detail.discountUsages[0]?.discountName, 'Loyalty');
  assert.equal(detail.discountUsages[0]?.subscriptionNumber, 'SUB-2026-000001');
  assert.equal(detail.payments[0]?.recordedByName, 'Test Staff');
  assert.equal(detail.paymentTermName, 'Net 15');
  assert.deepEqual(detail.allowedActions, ['CANCEL', 'SEND', 'RECORD_PAYMENT', 'PRINT']);
  for (const [row, expected] of [[dueToday, false], [paidLate, false], [draftLate, false], [zeroDue, false]] as const) {
    const dto = await s.service.get(STAFF, row.id);
    assert.deepEqual([dto.isOverdue, dto.daysOverdue], [expected, 0]);
  }
  assert.ok(!('isOverdue' in overdue), 'overdue is never stored on the row');
});

test('list contract: bounded, strict, whitelisted sort, multi status, booleans, ranges and money filters', async (t) => {
  const s = setup();
  seedInvoice(s.world);
  seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 118000 });
  const srv = await server(t, s);
  const get = (query: string) => srv.request<ApiBody & { data: InvoiceDto[] }>(`/invoices${query}`, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?limit=0', '?page=0', '?sortBy=customerName', '?sortOrder=up', '?status=NOPE', '?overdue=yes',
    '?outstanding=1', '?bogus=1', '?search=', '?minTotal=-1', '?minTotal=1.5', '?issueFrom=yesterday', '?customerId=abc',
  ]) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const ok = await get('?status=DRAFT,CONFIRMED&overdue=true&outstanding=false&customerId=1001&subscriptionId=1&billingRunId=3'
    + '&issueFrom=2026-10-01&issueTo=2026-10-31&dueFrom=2026-11-01T00:00:00Z&dueTo=2026-11-30&minTotal=100&maxTotal=500000'
    + '&search=acme&sortBy=amountDue&sortOrder=asc&limit=1');
  assert.equal(ok.status, 200);
  const call = s.world.listCalls.at(-1)!;
  assert.deepEqual(call.query.status, ['DRAFT', 'CONFIRMED']);
  assert.deepEqual([call.query.overdue, call.query.outstanding], [true, false]);
  assert.deepEqual([call.query.customerId, call.query.subscriptionId, call.query.billingRunId], [1001, 1, 3]);
  assert.equal(call.query.issueFrom?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(call.query.issueTo?.toISOString(), '2026-10-31T23:59:59.999Z');
  assert.equal(call.query.dueFrom?.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(call.query.dueTo?.toISOString(), '2026-11-30T23:59:59.999Z');
  assert.deepEqual([call.query.minTotal, call.query.maxTotal, call.query.search], [100, 500000, 'acme']);
  assert.deepEqual([call.query.sortBy, call.query.sortOrder, call.query.limit], ['amountDue', 'asc', 1]);
  assert.equal(ok.body.data.length, 1);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 1, total: 2, totalPages: 2, hasNext: true, hasPrev: false });
  assert.equal(ok.body.data[0]?.subscriptionNumber, 'SUB-2026-000001');
  const defaults = await get('');
  assert.deepEqual([s.world.listCalls.at(-1)?.query.sortBy, s.world.listCalls.at(-1)?.query.sortOrder, s.world.listCalls.at(-1)?.query.limit], ['createdAt', 'desc', 10]);
  assert.equal(defaults.body.data.length, 2);
});

test('GET /preview computes the next invoice without writing and rejects what cannot be billed', async (t) => {
  const s = setup();
  s.world.discounts.set(9, { usageLimit: 1, usedCount: 0 });
  s.world.evaluate = () => [{ discountId: 9, lineId: 11, amount: 10000 }];
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: InvoicePreviewDto }>('/invoices/preview?subscriptionId=1', { role: Role.STAFF });
  assert.equal(response.status, 200);
  const preview = response.body.data;
  assert.deepEqual([preview.subtotal, preview.discountTotal, preview.taxTotal, preview.total], [90000, 10000, 16200, 106200]);
  assert.deepEqual([preview.periodStart, preview.periodEnd], ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
  assert.equal(preview.dueDate, '2026-11-15T00:00:00.000Z');
  assert.equal(preview.lines[0]?.discountName, 'Loyalty');
  assert.equal(preview.customerName, 'Acme Ltd');
  assert.equal(s.world.invoices.length, 0);
  assert.equal(s.world.discounts.get(9)?.usedCount, 0);
  assert.equal(s.world.subs.get(1)?.nextBillingDate?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal((await srv.request('/invoices/preview', { role: Role.STAFF })).status, 400);
  assert.equal((await srv.request('/invoices/preview?subscriptionId=1&x=1', { role: Role.STAFF })).status, 400);
  assert.equal((await srv.request('/invoices/preview?subscriptionId=77', { role: Role.STAFF })).status, 404);
  s.world.subs.set(1, makeSub({ status: 'CLOSED' }));
  const closed = await srv.request<ApiBody>('/invoices/preview?subscriptionId=1', { role: Role.STAFF });
  assert.equal(closed.status, 409);
  assert.equal(closed.body.error?.code, 'NOTHING_TO_BILL');
});

test('customer actor: scoped to its own CONFIRMED and PAID invoices, everything else is 404, writes are 403', async () => {
  const s = setup();
  const own = seedInvoice(s.world, { status: 'CONFIRMED', amountDue: 118000 });
  const ownPaid = seedInvoice(s.world, { status: 'PAID', amountPaid: 118000 });
  const ownDraft = seedInvoice(s.world);
  const ownCancelled = seedInvoice(s.world, { status: 'CANCELLED' });
  const other = seedInvoice(s.world, { status: 'CONFIRMED', customerId: OTHER_CUSTOMER, amountDue: 118000 });

  const page = await s.service.list(CUSTOMER, {
    page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc', customerId: OTHER_CUSTOMER, status: ['DRAFT', 'PAID'],
  });
  assert.deepEqual(s.world.listCalls.at(-1)?.scope, {
    customerId: TEST_CUSTOMER_ID, statuses: ['CONFIRMED', 'PAID'], today: D(TODAY),
  });
  assert.deepEqual(page.invoices.map((invoice) => invoice.id).sort(), [own.id, ownPaid.id]);
  assert.ok(page.invoices.every((invoice) => invoice.customerId === TEST_CUSTOMER_ID));
  assert.deepEqual(page.invoices[0]?.allowedActions, ['PRINT']);

  assert.equal((await s.service.get(CUSTOMER, own.id)).id, own.id);
  assert.equal((await s.service.print(CUSTOMER, ownPaid.id)).number, ownPaid.number);
  for (const hidden of [ownDraft, ownCancelled, other, { id: 999 }]) {
    await assert.rejects(s.service.get(CUSTOMER, hidden.id), { status: 404, code: 'NOT_FOUND' });
    await assert.rejects(s.service.print(CUSTOMER, hidden.id), { status: 404, code: 'NOT_FOUND' });
  }
  assert.equal((await s.service.get(STAFF, ownDraft.id)).id, ownDraft.id);

  await assert.rejects(s.service.list({ userId: 3, role: 'CUSTOMER' }, { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }), { status: 403 });
  await assert.rejects(s.service.generate(CUSTOMER, { subscriptionId: 1 }), { status: 403 });
  await assert.rejects(s.service.preview(CUSTOMER, 1), { status: 403 });
  await assert.rejects(s.service.update(CUSTOMER, own.id, { notes: 'x' }), { status: 403 });
  await assert.rejects(s.service.confirm(CUSTOMER, ownDraft.id), { status: 403 });
  await assert.rejects(s.service.cancel(CUSTOMER, own.id, { reason: 'x' }), { status: 403 });
  await assert.rejects(s.service.send(CUSTOMER, own.id), { status: 403 });
  assert.equal(s.world.invoices.find((i) => i.id === own.id)?.status, 'CONFIRMED');
});

test('formatRupees uses integer arithmetic only', () => {
  assert.equal(formatRupees(123456), '1,234.56');
  assert.equal(formatRupees(0), '0.00');
  assert.equal(formatRupees(5), '0.05');
  assert.equal(formatRupees(100), '1.00');
  assert.equal(formatRupees(100000000), '1,000,000.00');
  assert.equal(formatRupees(-250), '-2.50');
  assert.throws(() => formatRupees(1.5));
});
