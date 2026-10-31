import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { InMemoryTable, RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { FakeAuthService, TEST_CUSTOMER_ID, actorFor } from '../../core/testing/test-auth.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import type {
  CreatePaymentOutcome, PaymentRecord, PaymentRow, PaymentScope, PaymentsRepository,
} from './payments.repository.js';
import type { ListPaymentsParams } from './payments.schema.js';
import { createPaymentsRouter } from './payments.routes.js';
import { PaymentsService } from './payments.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const CLOCK = new Date('2026-10-31T10:00:00.000Z');
const OTHER_CUSTOMER_ID = TEST_CUSTOMER_ID + 1;

type Status = 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED';

interface FakeInvoice {
  id: number;
  number: string;
  customerId: number;
  status: Status;
  total: number;
  amountPaid: number;
  amountDue: number;
  paidAt: string | null;
}

interface Setup {
  invoices: Map<number, FakeInvoice>;
  payments: InMemoryTable<PaymentRow>;
  audit: RecordingAudit;
  service: PaymentsService;
  lists: { query: ListPaymentsParams; scope: PaymentScope }[];
  createdBy: number[];
}

const money = (value: number, customerId = TEST_CUSTOMER_ID, status: Status = 'CONFIRMED', paid = 0): Omit<FakeInvoice, 'id' | 'number'> => ({
  customerId, status, total: value, amountPaid: paid, amountDue: value - paid, paidAt: status === 'PAID' ? NOW : null,
});

function setup(clock: Date = CLOCK): Setup {
  const invoices = new Map<number, FakeInvoice>();
  const payments = new InMemoryTable<PaymentRow>();
  const audit = new RecordingAudit();
  const lists: Setup['lists'] = [];
  const createdBy: number[] = [];

  const record = (row: PaymentRow): PaymentRecord => ({
    ...row,
    invoiceNumber: invoices.get(row.invoiceId)?.number ?? '',
    customerName: `Customer ${row.customerId}`,
    recordedByName: row.recordedById === null ? null : `User ${row.recordedById}`,
  });
  const visible = (row: PaymentRow, scope: PaymentScope): boolean => {
    if (scope.customerId !== undefined && row.customerId !== scope.customerId) return false;
    if (scope.visibleInvoicesOnly === true) {
      const status = invoices.get(row.invoiceId)?.status;
      if (status !== 'CONFIRMED' && status !== 'PAID') return false;
    }
    return true;
  };

  const repository = fakeRepository<PaymentsRepository>({
    async list(query, scope) {
      lists.push({ query, scope });
      const rows = payments.rows
        .filter((row) => visible(row, scope))
        .filter((row) => (scope.customerId ?? query.customerId) === undefined || row.customerId === (scope.customerId ?? query.customerId))
        .filter((row) => query.invoiceId === undefined || row.invoiceId === query.invoiceId)
        .map(record);
      return paginateRows(rows, query.page, query.limit).data;
    },
    async count(query, scope) {
      return payments.rows
        .filter((row) => visible(row, scope))
        .filter((row) => (scope.customerId ?? query.customerId) === undefined || row.customerId === (scope.customerId ?? query.customerId))
        .length;
    },
    async findById(id, scope = {}) {
      const row = payments.find(id);
      return row === null || !visible(row, scope) ? null : record(row);
    },
    // Mirrors the real conditional UPDATE: the check and the balance change happen with no await between them.
    async create(input, recordedById): Promise<CreatePaymentOutcome> {
      await Promise.resolve();
      const invoice = invoices.get(input.invoiceId);
      if (invoice !== undefined && invoice.status === 'CONFIRMED' && invoice.amountDue >= input.amount) {
        invoice.amountPaid += input.amount;
        invoice.amountDue -= input.amount;
        if (invoice.amountDue === 0) { invoice.status = 'PAID'; invoice.paidAt = new Date(CLOCK).toISOString(); }
        await Promise.resolve();
        createdBy.push(recordedById);
        const row = payments.insert({
          invoiceId: invoice.id, customerId: invoice.customerId, method: input.method, amount: input.amount,
          paymentDate: input.paymentDate.toISOString(), reference: input.reference ?? null, note: input.note ?? null,
          recordedById, createdAt: NOW, updatedAt: NOW,
        });
        return { kind: 'created', payment: record(row), invoice: { status: invoice.status, amountDue: invoice.amountDue } };
      }
      if (invoice === undefined) return { kind: 'invoice-missing' };
      if (invoice.status !== 'CONFIRMED') return { kind: 'not-payable', status: invoice.status };
      return { kind: 'overpayment', amountDue: invoice.amountDue };
    },
    async update(id, patch) {
      const row = payments.update(id, {
        ...(patch.reference !== undefined ? { reference: patch.reference } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      });
      return row === null ? null : record(row);
    },
    async remove(id) {
      const row = payments.find(id);
      if (row === null) return null;
      payments.remove(id);
      const invoice = invoices.get(row.invoiceId);
      if (invoice === undefined) throw new Error('missing invoice');
      invoice.amountPaid -= row.amount;
      invoice.amountDue += row.amount;
      if (invoice.status === 'PAID') { invoice.status = 'CONFIRMED'; invoice.paidAt = null; }
      return { payment: { ...row }, invoice: { status: invoice.status, amountDue: invoice.amountDue } };
    },
  });
  return { invoices, payments, audit, lists, createdBy, service: new PaymentsService(repository, audit, () => clock) };
}

function addInvoice(s: Setup, id: number, data: Omit<FakeInvoice, 'id' | 'number'>): FakeInvoice {
  const invoice = { id, number: `INV-2026-${String(id).padStart(6, '0')}`, ...data };
  s.invoices.set(id, invoice);
  return invoice;
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/payments', createPaymentsRouter({
    authService: auth.asAuthService(), paymentsService: s.service,
  })));
}

const pay = (invoiceId: number, amount: number, over: Record<string, unknown> = {}) => ({
  invoiceId, method: 'CASH', amount, paymentDate: '2026-10-31', ...over,
});

interface PaymentBody extends ApiBody { data: { id: number; amount: number; paymentDate: string; recordedById: number; customerId: number; invoiceNumber: string; reference: string | null } }

test('RBAC matrix: ADMIN and STAFF read, create and patch, only ADMIN deletes, CUSTOMER and anonymous are refused', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(1_000_000));
  for (let i = 0; i < 3; i += 1) {
    s.payments.insert({
      invoiceId: 1, customerId: TEST_CUSTOMER_ID, method: 'CASH', amount: 100, paymentDate: NOW, reference: null, note: null,
      recordedById: 1, createdAt: NOW, updatedAt: NOW,
    });
  }
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/payments', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/payments/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/payments', allowed: [Role.ADMIN, Role.STAFF], body: pay(1, 500), expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/payments/2', allowed: [Role.ADMIN, Role.STAFF], body: { note: 'x' }, expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/payments/3', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create: 201 with Location, customerId copied from the invoice, recordedById from the actor, UTC-midnight date', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(10_000, OTHER_CUSTOMER_ID));
  const srv = await server(t, s);
  const response = await srv.request<PaymentBody>('/payments', {
    method: 'POST', role: Role.STAFF, body: pay(1, 2500, { paymentDate: '2026-10-30T18:45:00+05:30', reference: ' UTR-1 ' }),
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /\/payments\/1$/);
  assert.equal(response.body.data.customerId, OTHER_CUSTOMER_ID);
  assert.equal(response.body.data.recordedById, 2);
  assert.equal(response.body.data.paymentDate, '2026-10-30T00:00:00.000Z');
  assert.equal(response.body.data.reference, 'UTR-1');
  assert.equal(response.body.data.invoiceNumber, 'INV-2026-000001');
});

test('partial payment leaves the correct balance and keeps the invoice CONFIRMED', async (t) => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(10_000));
  const srv = await server(t, s);
  assert.equal((await srv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 3000) })).status, 201);
  assert.equal((await srv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 1) })).status, 201);
  assert.deepEqual(
    { status: invoice.status, paid: invoice.amountPaid, due: invoice.amountDue, paidAt: invoice.paidAt },
    { status: 'CONFIRMED', paid: 3001, due: 6999, paidAt: null },
  );
});

test('exact payment marks the invoice PAID and sets paidAt', async (t) => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(10_000, TEST_CUSTOMER_ID, 'CONFIRMED', 4000));
  const srv = await server(t, s);
  assert.equal((await srv.request('/payments', { method: 'POST', role: Role.STAFF, body: pay(1, 6000) })).status, 201);
  assert.equal(invoice.status, 'PAID');
  assert.equal(invoice.amountDue, 0);
  assert.equal(invoice.amountPaid, 10_000);
  assert.notEqual(invoice.paidAt, null);
});

test('two parallel payments that together exceed the balance: exactly one succeeds, the other is OVERPAYMENT', async (t) => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(10_000));
  const srv = await server(t, s);
  const responses = await Promise.all([
    srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 6000) }),
    srv.request<ApiBody>('/payments', { method: 'POST', role: Role.STAFF, body: pay(1, 6000) }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 400]);
  const failed = responses.find((r) => r.status === 400);
  assert.equal(failed?.body.error?.code, 'OVERPAYMENT');
  assert.equal(invoice.amountDue, 4000);
  assert.equal(s.payments.rows.length, 1);
  assert.equal(s.audit.actions().filter((a) => a === 'payment.create').length, 1);
});

test('many parallel payments never overspend: 10 x 1000 against 4000 gives exactly 4 successes', async () => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(4000));
  const actor = actorFor(Role.STAFF);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => s.service.create(actor, {
    invoiceId: 1, method: 'UPI', amount: 1000, paymentDate: new Date(NOW),
  })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 4);
  assert.equal(invoice.amountDue, 0);
  assert.equal(invoice.status, 'PAID');
});

test('payment on a DRAFT, CANCELLED or PAID invoice is 409 INVOICE_NOT_PAYABLE', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(1000, TEST_CUSTOMER_ID, 'DRAFT'));
  addInvoice(s, 2, money(1000, TEST_CUSTOMER_ID, 'CANCELLED'));
  addInvoice(s, 3, money(1000, TEST_CUSTOMER_ID, 'PAID', 1000));
  const srv = await server(t, s);
  for (const invoiceId of [1, 2, 3]) {
    const response = await srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(invoiceId, 100) });
    assert.equal(response.status, 409, `invoice ${invoiceId}`);
    assert.equal(response.body.error?.code, 'INVOICE_NOT_PAYABLE');
  }
  assert.equal(s.payments.rows.length, 0);
  assert.equal(s.audit.entries.length, 0);
});

test('amount greater than amountDue is 400 OVERPAYMENT and changes nothing; unknown invoice is 404', async (t) => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(5000));
  const srv = await server(t, s);
  const over = await srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 5001) });
  assert.equal(over.status, 400);
  assert.equal(over.body.error?.code, 'OVERPAYMENT');
  assert.equal(invoice.amountDue, 5000);
  const missing = await srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(99, 1) });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error?.code, 'NOT_FOUND');
});

test('a foreign-key failure on insert becomes a clean 404, never a raw database error', async (t) => {
  const s = setup();
  const failing = new PaymentsService(fakeRepository<PaymentsRepository>({
    async create() { throw Object.assign(new Error('insert or update violates foreign key'), { name: 'SqlQueryError', sqlState: '23503' }); },
  }), s.audit, () => CLOCK);
  const auth = new FakeAuthService();
  const srv = await startTestServer(t, (v1) => v1.use('/payments', createPaymentsRouter({
    authService: auth.asAuthService(), paymentsService: failing,
  })));
  const response = await srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 100) });
  assert.notEqual(response.status, 500);
  assert.doesNotMatch(JSON.stringify(response.body), /foreign key|SqlQueryError/);
});

test('paymentDate: today is allowed, tomorrow is rejected, comparison uses the business timezone', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(100_000));
  const srv = await server(t, s);
  const today = await srv.request<PaymentBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 10, { paymentDate: '2026-10-31' }) });
  assert.equal(today.status, 201);
  assert.equal(today.body.data.paymentDate, '2026-10-31T00:00:00.000Z');
  const tomorrow = await srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 10, { paymentDate: '2026-11-01' }) });
  assert.equal(tomorrow.status, 400);
  assert.equal(tomorrow.body.error?.code, 'VALIDATION_ERROR');
  assert.equal(tomorrow.body.error?.details?.[0]?.field, 'paymentDate');
  assert.equal((await srv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 10, { paymentDate: '2020-02-30' }) })).status, 400);
  assert.equal((await srv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 10, { paymentDate: 'yesterday' }) })).status, 400);

  // 20:00 UTC on 31 Oct is already 1 Nov in Asia/Kolkata, so 1 Nov is "today" there.
  const late = setup(new Date('2026-10-31T20:00:00.000Z'));
  addInvoice(late, 1, money(100_000));
  const lateSrv = await server(t, late);
  assert.equal((await lateSrv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 10, { paymentDate: '2026-11-01' }) })).status, 201);
});

test('create validation: amount must be an integer of at least 1 paise, strict body, required fields, enum method', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(100_000));
  const srv = await server(t, s);
  const bad: Record<string, unknown>[] = [
    pay(1, 0), pay(1, -5), pay(1, 10.5), pay(1, '100' as unknown as number), pay(1, 2_147_483_648),
    pay(1, 10, { method: 'BITCOIN' }), pay(0, 10), pay(1.5, 10), pay(1, 10, { extra: 1 }), pay(1, 10, { reference: '' }),
    { invoiceId: 1, method: 'CASH', amount: 10 }, { method: 'CASH', amount: 10, paymentDate: '2026-10-31' },
  ];
  for (const body of bad) {
    const response = await srv.request<ApiBody>('/payments', { method: 'POST', role: Role.ADMIN, body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  assert.equal((await srv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 1) })).status, 201);
  assert.equal(s.payments.rows.length, 1);
});

test('PATCH changes only note and reference; amount, date and invoice are rejected by the strict schema', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(10_000));
  const srv = await server(t, s);
  await srv.request('/payments', { method: 'POST', role: Role.ADMIN, body: pay(1, 1000, { reference: 'old' }) });
  const ok = await srv.request<PaymentBody>('/payments/1', { method: 'PATCH', role: Role.STAFF, body: { reference: 'new', note: 'checked' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.reference, 'new');
  assert.equal(ok.body.data.amount, 1000);
  const cleared = await srv.request<PaymentBody>('/payments/1', { method: 'PATCH', role: Role.STAFF, body: { reference: null } });
  assert.equal(cleared.body.data.reference, null);
  for (const body of [{ amount: 5 }, { paymentDate: '2026-10-01' }, { invoiceId: 2 }, { method: 'UPI' }, {}]) {
    assert.equal((await srv.request('/payments/1', { method: 'PATCH', role: Role.ADMIN, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await srv.request('/payments/99', { method: 'PATCH', role: Role.ADMIN, body: { note: 'x' } })).status, 404);
  assert.equal(s.payments.find(1)?.amount, 1000);
});

test('delete restores the balance, moves PAID back to CONFIRMED, clears paidAt and audits the full payment', async (t) => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(10_000));
  const srv = await server(t, s);
  await srv.request('/payments', { method: 'POST', role: Role.STAFF, body: pay(1, 4000, { reference: 'R-1', note: 'first' }) });
  await srv.request('/payments', { method: 'POST', role: Role.STAFF, body: pay(1, 6000) });
  assert.equal(invoice.status, 'PAID');

  const deleted = await srv.request<ApiBody>('/payments/2', { method: 'DELETE', role: Role.ADMIN });
  assert.equal(deleted.status, 200);
  assert.deepEqual(
    { status: invoice.status, paid: invoice.amountPaid, due: invoice.amountDue, paidAt: invoice.paidAt },
    { status: 'CONFIRMED', paid: 4000, due: 6000, paidAt: null },
  );
  assert.equal((await srv.request('/payments/2', { role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/payments/2', { method: 'DELETE', role: Role.ADMIN })).status, 404);

  await srv.request('/payments/1', { method: 'DELETE', role: Role.ADMIN });
  assert.deepEqual({ paid: invoice.amountPaid, due: invoice.amountDue, status: invoice.status }, { paid: 0, due: 10_000, status: 'CONFIRMED' });

  const entry = s.audit.entries.find((e) => e.action === 'payment.delete' && e.entityId === 1);
  assert.ok(entry);
  assert.deepEqual(entry.metadata?.payment, {
    id: 1, invoiceId: 1, customerId: TEST_CUSTOMER_ID, method: 'CASH', amount: 4000, paymentDate: NOW,
    reference: 'R-1', note: 'first', recordedById: 2, createdAt: NOW, updatedAt: NOW,
  });
});

test('delete on an invoice that is not PAID keeps its status', async () => {
  const s = setup();
  const invoice = addInvoice(s, 1, money(10_000));
  const admin = actorFor(Role.ADMIN);
  await s.service.create(admin, { invoiceId: 1, method: 'CASH', amount: 1000, paymentDate: new Date(NOW) });
  invoice.status = 'CANCELLED';
  await s.service.remove(admin, 1);
  assert.equal(invoice.status, 'CANCELLED');
  assert.equal(invoice.amountDue, 10_000);
});

test('every mutation writes an audit entry with the actor', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(10_000));
  const srv = await server(t, s);
  await srv.request('/payments', { method: 'POST', role: Role.STAFF, body: pay(1, 10_000) });
  await srv.request('/payments/1', { method: 'PATCH', role: Role.ADMIN, body: { note: 'n' } });
  await srv.request('/payments/1', { method: 'DELETE', role: Role.ADMIN });
  assert.deepEqual(s.audit.actions(), ['payment.create', 'payment.update', 'payment.delete']);
  assert.deepEqual(s.audit.entries.map((e) => [e.entityType, e.entityId, e.actor?.userId]), [['Payment', 1, 2], ['Payment', 1, 1], ['Payment', 1, 1]]);
  assert.equal(s.audit.entries[0]?.metadata?.invoiceStatusAfter, 'PAID');
  assert.equal(s.audit.entries[0]?.metadata?.amountDueAfter, 0);
  assert.deepEqual(s.audit.entries[1]?.metadata?.previous, { note: null });
});

test('list contract: bounds, strict keys, whitelisted sort, filters parsed, page past the end', async (t) => {
  const s = setup();
  addInvoice(s, 1, money(1_000_000));
  for (let i = 0; i < 3; i += 1) await s.service.create(actorFor(Role.ADMIN), { invoiceId: 1, method: 'CASH', amount: 10, paymentDate: new Date(NOW) });
  const srv = await server(t, s);
  const get = (qs: string) => srv.request<ApiBody & { data: unknown[] }>(`/payments${qs}`, { role: Role.STAFF });

  assert.equal((await get('?limit=101')).status, 400);
  assert.equal((await get('?limit=0')).status, 400);
  assert.equal((await get('?page=0')).status, 400);
  assert.equal((await get('?bogus=1')).status, 400);
  assert.equal((await get('?sortBy=reference')).status, 400);
  assert.equal((await get('?sortOrder=up')).status, 400);
  assert.equal((await get('?method=CASH,BITCOIN')).status, 400);
  assert.equal((await get('?minAmount=-1')).status, 400);
  assert.equal((await get('?minAmount=1.5')).status, 400);
  assert.equal((await get('?minAmount=500&maxAmount=100')).status, 400);
  assert.equal((await get('?paidFrom=2026-10-31&paidTo=2026-10-01')).status, 400);
  assert.equal((await get('?paidFrom=nope')).status, 400);
  assert.equal((await get('?search=')).status, 400);
  assert.equal((await get(`?search=${'a'.repeat(101)}`)).status, 400);

  const past = await get('?page=5&limit=2');
  assert.equal(past.status, 200);
  assert.deepEqual(past.body.data, []);
  assert.deepEqual(past.body.meta, { page: 5, limit: 2, total: 3, totalPages: 2, hasNext: false, hasPrev: true });

  s.lists.length = 0;
  const filtered = await get(
    '?method=CASH,UPI&paidFrom=2026-10-01&paidTo=2026-10-31&minAmount=5&maxAmount=900&invoiceId=1&customerId=7&search=%20Acme%20&sortBy=amount&sortOrder=asc',
  );
  assert.equal(filtered.status, 200);
  const parsed = s.lists[0]?.query;
  assert.deepEqual(parsed?.method, ['CASH', 'UPI']);
  assert.equal(parsed?.paidFrom?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(parsed?.paidTo?.toISOString(), '2026-10-31T23:59:59.999Z');
  assert.equal(parsed?.minAmount, 5);
  assert.equal(parsed?.maxAmount, 900);
  assert.equal(parsed?.invoiceId, 1);
  assert.equal(parsed?.customerId, 7);
  assert.equal(parsed?.search, 'Acme');
  assert.equal(parsed?.sortBy, 'amount');
  assert.equal(parsed?.sortOrder, 'asc');
  assert.deepEqual(s.lists[0]?.scope, {});

  s.lists.length = 0;
  await get('');
  assert.equal(s.lists[0]?.query.page, 1);
  assert.equal(s.lists[0]?.query.limit, 10);
  assert.equal(s.lists[0]?.query.sortBy, 'createdAt');
  assert.equal(s.lists[0]?.query.sortOrder, 'desc');
  const instant = await get('?paidTo=2026-10-31T12:00:00Z');
  assert.equal(instant.status, 200);
  assert.equal(s.lists[1]?.query.paidTo?.toISOString(), '2026-10-31T12:00:00.000Z');
});

test('CUSTOMER actor: list is forced to their customerId and visible invoices, a customerId filter is ignored', async () => {
  const s = setup();
  addInvoice(s, 1, money(100_000, TEST_CUSTOMER_ID));
  addInvoice(s, 2, money(100_000, OTHER_CUSTOMER_ID));
  addInvoice(s, 3, money(100_000, TEST_CUSTOMER_ID, 'CANCELLED'));
  const admin = actorFor(Role.ADMIN);
  await s.service.create(admin, { invoiceId: 1, method: 'CASH', amount: 10, paymentDate: new Date(NOW) });
  await s.service.create(admin, { invoiceId: 2, method: 'CASH', amount: 20, paymentDate: new Date(NOW) });
  // A payment that exists on a now-cancelled invoice stays hidden from the customer.
  await s.service.create(admin, { invoiceId: 1, method: 'CASH', amount: 30, paymentDate: new Date(NOW) });
  s.invoices.get(3)!.status = 'CONFIRMED';
  await s.service.create(admin, { invoiceId: 3, method: 'CASH', amount: 40, paymentDate: new Date(NOW) });
  s.invoices.get(3)!.status = 'CANCELLED';

  const query: ListPaymentsParams = { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc', customerId: OTHER_CUSTOMER_ID };
  const result = await s.service.list(actorFor(Role.CUSTOMER), query);
  assert.deepEqual(result.payments.map((p) => p.amount).sort((a, b) => a - b), [10, 30]);
  assert.ok(result.payments.every((p) => p.customerId === TEST_CUSTOMER_ID));
  assert.equal(result.meta.total, 2);
  const last = s.lists.at(-1);
  assert.equal(last?.query.customerId, TEST_CUSTOMER_ID);
  assert.deepEqual(last?.scope, { customerId: TEST_CUSTOMER_ID, visibleInvoicesOnly: true });

  const staffView = await s.service.list(admin, { ...query, customerId: OTHER_CUSTOMER_ID });
  assert.deepEqual(staffView.payments.map((p) => p.amount), [20]);
});

test('CUSTOMER actor: get of another customer\'s or a hidden payment is 404, own payment works', async () => {
  const s = setup();
  addInvoice(s, 1, money(100_000, TEST_CUSTOMER_ID));
  addInvoice(s, 2, money(100_000, OTHER_CUSTOMER_ID));
  const admin = actorFor(Role.ADMIN);
  await s.service.create(admin, { invoiceId: 1, method: 'CASH', amount: 10, paymentDate: new Date(NOW) });
  await s.service.create(admin, { invoiceId: 2, method: 'CASH', amount: 20, paymentDate: new Date(NOW) });
  const customer = actorFor(Role.CUSTOMER);
  assert.equal((await s.service.get(customer, 1)).amount, 10);
  await assert.rejects(s.service.get(customer, 2), { status: 404, code: 'NOT_FOUND' });
  await assert.rejects(s.service.get(customer, 999), { status: 404 });
  s.invoices.get(1)!.status = 'CANCELLED';
  await assert.rejects(s.service.get(customer, 1), { status: 404 });
  assert.equal((await s.service.get(admin, 2)).amount, 20);
});

test('CUSTOMER actor cannot create, patch or delete (403) and a customer without a profile is refused', async () => {
  const s = setup();
  addInvoice(s, 1, money(10_000, TEST_CUSTOMER_ID));
  const customer = actorFor(Role.CUSTOMER);
  await assert.rejects(s.service.create(customer, { invoiceId: 1, method: 'CASH', amount: 10, paymentDate: new Date(NOW) }), { status: 403 });
  await assert.rejects(s.service.update(customer, 1, { note: 'x' }), { status: 403 });
  await assert.rejects(s.service.remove(customer, 1), { status: 403 });
  await assert.rejects(s.service.remove(actorFor(Role.STAFF), 1), { status: 403 });
  await assert.rejects(s.service.list({ userId: 3, role: Role.CUSTOMER }, { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }), { status: 403 });
  assert.equal(s.invoices.get(1)?.amountDue, 10_000);
  assert.equal(s.audit.entries.length, 0);
});
