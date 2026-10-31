/**
 * Reports tests. The database is not reachable here, so the repository is replaced by an in-memory
 * fake that applies the same definitions the SQL does (status filters, inclusive windows, buckets).
 * These tests prove the service and HTTP layers; the SQL itself is unverified against Postgres.
 */

import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Role, type AgingDto, type BillingPeriod, type ExpiringSubscriptionDto, type InvoiceStatus, type OverdueInvoiceDto,
  type PaymentMethod, type PaymentsSummaryDto, type ReportInterval, type ReportSummaryDto, type RevenueByPlanDto,
  type RevenueTimeseriesDto, type SubscriptionStatus,
} from '@brightloop/shared';
import { AppError } from '../../core/errors.js';
import { fakeRepository } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { startTestServer, type ApiBody, type TestServer } from '../../core/testing/test-server.js';
import { addDays, toIsoDate } from '../../core/utils/dates.js';
import { agingBucketFor, daysOverdueOn } from './reports.dto.js';
import type {
  AgingCutoffs, AgingRow, DateWindow, ExpiringSubscriptionRow, ExpiringWindow, InvoiceTotalsRow, MethodTotalsRow,
  OverdueInvoiceRow, PeriodAmountRow, PlanAmountRow, ReportsRepository, SubscriptionFilter, SubscriptionGroupRow,
} from './reports.repository.js';
import { createReportsRouter } from './reports.routes.js';
import type { ListExpiringParams, ListOverdueParams } from './reports.schema.js';
import {
  ReportsService, agingCutoffs, assembleTimeseries, bucketStart, bucketStarts, currentMonth, groupMrr, resolveRange,
} from './reports.service.js';

/** 2026-10-31 in Asia/Kolkata (16:00 IST). */
const CLOCK = '2026-10-31T10:30:00.000Z';
const STAFF = actorFor(Role.STAFF);
const D = (date: string): Date => new Date(`${date}T00:00:00.000Z`);
const ISO = (date: string): string => D(date).toISOString();
const END = (date: string): Date => new Date(`${date}T23:59:59.999Z`);

interface Plan { id: number; name: string; billingPeriod: BillingPeriod; autoClose: boolean }
interface Sub {
  id: number; number: string; customerId: number; planId: number; status: SubscriptionStatus; recurringAmount: number;
  activatedAt: string | null; closedAt: string | null; expiryDate: string | null; nextBillingDate: string | null;
}
interface Inv {
  id: number; number: string; subscriptionId: number; customerId: number; customerName: string; status: InvoiceStatus;
  issueDate: string; dueDate: string; total: number; amountPaid: number; amountDue: number;
}
interface Pay { id: number; invoiceId: number; customerId: number; method: PaymentMethod; amount: number; paymentDate: string }

interface World { plans: Plan[]; subs: Sub[]; invoices: Inv[]; payments: Pay[]; calls: string[]; windows: DateWindow[] }

const inWindow = (value: string | null, window: DateWindow): boolean =>
  value !== null && new Date(value).getTime() >= window.from.getTime() && new Date(value).getTime() <= window.to.getTime();

function truncKey(value: string, interval: ReportInterval): string {
  return toIsoDate(bucketStart(new Date(value), interval));
}

/** In-memory repository applying the same definitions as the SQL. Records each call so tests can count queries. */
function fakeRepo(world: World): ReportsRepository {
  const plan = (id: number): Plan => world.plans.find((p) => p.id === id)!;
  const sub = (id: number): Sub => world.subs.find((s) => s.id === id)!;
  const invoice = (id: number): Inv => world.invoices.find((i) => i.id === id)!;
  const matchesSub = (s: Sub, f: SubscriptionFilter): boolean =>
    (f.planId === undefined || s.planId === f.planId) && (f.customerId === undefined || s.customerId === f.customerId);
  const outstanding = (i: Inv): boolean => i.status === 'CONFIRMED' && i.amountDue > 0;
  const billed = (i: Inv): boolean => i.status === 'CONFIRMED' || i.status === 'PAID';
  const sumBy = (rows: { key: string; amount: number }[]): PeriodAmountRow[] => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.key, (map.get(row.key) ?? 0) + row.amount);
    return [...map].map(([period, amount]) => ({ period, amount }));
  };
  const overdue = (q: ListOverdueParams, today: Date): Inv[] => world.invoices.filter((i) =>
    outstanding(i) && new Date(i.dueDate).getTime() < today.getTime()
    && (q.customerId === undefined || i.customerId === q.customerId)
    && (q.minDaysOverdue === undefined || daysOverdueOn(i.dueDate, today) >= q.minDaysOverdue)
    && (q.minAmount === undefined || i.amountDue >= q.minAmount));
  const expiring = (q: ListExpiringParams, w: ExpiringWindow): Sub[] => world.subs.filter((s) => {
    if (s.status !== 'ACTIVE' || s.expiryDate === null) return false;
    const t = new Date(s.expiryDate).getTime();
    const soon = t >= w.today.getTime() && t <= w.until.getTime();
    const lapsed = t < w.today.getTime() && !plan(s.planId).autoClose;
    return (soon || lapsed) && (q.planId === undefined || s.planId === q.planId);
  });

  return fakeRepository<ReportsRepository>({
    async subscriptionGroups(window: DateWindow, filter: SubscriptionFilter = {}): Promise<SubscriptionGroupRow[]> {
      world.calls.push('subscriptionGroups');
      world.windows.push(window);
      const groups = new Map<string, SubscriptionGroupRow>();
      for (const s of world.subs.filter((row) => matchesSub(row, filter))) {
        const p = plan(s.planId);
        const key = `${s.status}:${s.planId}`;
        const group = groups.get(key) ?? {
          status: s.status, planId: p.id, planName: p.name, billingPeriod: p.billingPeriod, count: 0, recurring: 0, activated: 0, closed: 0,
        };
        group.count += 1;
        group.recurring += s.recurringAmount;
        if (inWindow(s.activatedAt, window)) group.activated += 1;
        if (inWindow(s.closedAt, window)) group.closed += 1;
        groups.set(key, group);
      }
      return [...groups.values()];
    },
    async invoiceTotals(window: DateWindow, today: Date, filter: SubscriptionFilter = {}): Promise<InvoiceTotalsRow> {
      world.calls.push('invoiceTotals');
      const rows = world.invoices.filter((i) => billed(i) && matchesSub(sub(i.subscriptionId), { ...filter, customerId: undefined })
        && (filter.customerId === undefined || i.customerId === filter.customerId));
      const late = rows.filter((i) => outstanding(i) && new Date(i.dueDate).getTime() < today.getTime());
      return {
        invoiced: rows.filter((i) => inWindow(i.issueDate, window)).reduce((sum, i) => sum + i.total, 0),
        outstanding: rows.filter(outstanding).reduce((sum, i) => sum + i.amountDue, 0),
        overdue: late.reduce((sum, i) => sum + i.amountDue, 0),
        overdueCount: late.length,
      };
    },
    async paymentsReceived(window: DateWindow, filter: SubscriptionFilter = {}): Promise<number> {
      world.calls.push('paymentsReceived');
      return world.payments
        .filter((p) => inWindow(p.paymentDate, window)
          && (filter.planId === undefined || sub(invoice(p.invoiceId).subscriptionId).planId === filter.planId)
          && (filter.customerId === undefined || p.customerId === filter.customerId))
        .reduce((sum, p) => sum + p.amount, 0);
    },
    async invoicedByPeriod(window: DateWindow, interval: ReportInterval, planId?: number): Promise<PeriodAmountRow[]> {
      world.calls.push('invoicedByPeriod');
      world.windows.push(window);
      return sumBy(world.invoices
        .filter((i) => billed(i) && inWindow(i.issueDate, window) && (planId === undefined || sub(i.subscriptionId).planId === planId))
        .map((i) => ({ key: truncKey(i.issueDate, interval), amount: i.total })));
    },
    async receivedByPeriod(window: DateWindow, interval: ReportInterval, planId?: number): Promise<PeriodAmountRow[]> {
      world.calls.push('receivedByPeriod');
      return sumBy(world.payments
        .filter((p) => inWindow(p.paymentDate, window) && (planId === undefined || sub(invoice(p.invoiceId).subscriptionId).planId === planId))
        .map((p) => ({ key: truncKey(p.paymentDate, interval), amount: p.amount })));
    },
    async receivedByPlan(window: DateWindow): Promise<PlanAmountRow[]> {
      world.calls.push('receivedByPlan');
      const map = new Map<number, number>();
      for (const p of world.payments.filter((row) => inWindow(row.paymentDate, window))) {
        const planId = sub(invoice(p.invoiceId).subscriptionId).planId;
        map.set(planId, (map.get(planId) ?? 0) + p.amount);
      }
      return [...map].map(([planId, amount]) => ({ planId, planName: plan(planId).name, amount }));
    },
    async paymentsByMethod(window: DateWindow): Promise<MethodTotalsRow[]> {
      world.calls.push('paymentsByMethod');
      world.windows.push(window);
      const map = new Map<PaymentMethod, MethodTotalsRow>();
      for (const p of world.payments.filter((row) => inWindow(row.paymentDate, window))) {
        const row = map.get(p.method) ?? { method: p.method, count: 0, amount: 0 };
        row.count += 1;
        row.amount += p.amount;
        map.set(p.method, row);
      }
      return [...map.values()];
    },
    async aging(cutoffs: AgingCutoffs, customerId?: number): Promise<AgingRow> {
      world.calls.push('aging');
      const row: AgingRow = {
        notDueCount: 0, notDueAmount: 0, d1To30Count: 0, d1To30Amount: 0, d31To60Count: 0, d31To60Amount: 0,
        d61To90Count: 0, d61To90Amount: 0, over90Count: 0, over90Amount: 0,
      };
      // Same predicates as the SQL: comparisons against the cut-off instants.
      for (const i of world.invoices.filter((inv) => outstanding(inv) && (customerId === undefined || inv.customerId === customerId))) {
        const due = new Date(i.dueDate).getTime();
        if (due >= cutoffs.today.getTime()) { row.notDueCount += 1; row.notDueAmount += i.amountDue; }
        else if (due >= cutoffs.minus30.getTime()) { row.d1To30Count += 1; row.d1To30Amount += i.amountDue; }
        else if (due >= cutoffs.minus60.getTime()) { row.d31To60Count += 1; row.d31To60Amount += i.amountDue; }
        else if (due >= cutoffs.minus90.getTime()) { row.d61To90Count += 1; row.d61To90Amount += i.amountDue; }
        else { row.over90Count += 1; row.over90Amount += i.amountDue; }
      }
      return row;
    },
    async listOverdue(query: ListOverdueParams, today: Date): Promise<OverdueInvoiceRow[]> {
      world.calls.push('listOverdue');
      return overdue(query, today).slice((query.page - 1) * query.limit, query.page * query.limit).map((i) => ({
        id: i.id, number: i.number, customerId: i.customerId, customerName: i.customerName, subscriptionId: i.subscriptionId,
        subscriptionNumber: sub(i.subscriptionId).number, dueDate: i.dueDate, total: i.total, amountPaid: i.amountPaid, amountDue: i.amountDue,
      }));
    },
    async countOverdue(query: ListOverdueParams, today: Date): Promise<number> {
      world.calls.push('countOverdue');
      return overdue(query, today).length;
    },
    async listExpiring(query: ListExpiringParams, window: ExpiringWindow): Promise<ExpiringSubscriptionRow[]> {
      world.calls.push('listExpiring');
      return expiring(query, window).map((s) => ({
        id: s.id, number: s.number, customerId: s.customerId, customerName: `Customer ${s.customerId}`, planId: s.planId,
        planName: plan(s.planId).name, expiryDate: s.expiryDate!, nextBillingDate: s.nextBillingDate,
        recurringAmount: s.recurringAmount, autoClose: plan(s.planId).autoClose,
      }));
    },
    async countExpiring(query: ListExpiringParams, window: ExpiringWindow): Promise<number> {
      world.calls.push('countExpiring');
      return expiring(query, window).length;
    },
  });
}

/**
 * Hand-computed fixture (business today 2026-10-31, window October 2026):
 * plans: 1 Basic MONTHLY, 2 Weekly WEEKLY, 3 Annual YEARLY (autoClose), 4 Daily DAILY.
 */
function world(): World {
  const s = (over: Partial<Sub> & Pick<Sub, 'id' | 'planId' | 'status'>): Sub => ({
    number: `SUB-2026-${String(over.id).padStart(6, '0')}`, customerId: 1001, recurringAmount: 0, activatedAt: null, closedAt: null,
    expiryDate: null, nextBillingDate: null, ...over,
  });
  const inv = (over: Partial<Inv> & Pick<Inv, 'id' | 'subscriptionId' | 'status' | 'total'>): Inv => ({
    number: `INV-2026-${String(over.id).padStart(6, '0')}`, customerId: 1001, customerName: 'Acme Ltd',
    issueDate: ISO('2026-10-05'), dueDate: ISO('2026-10-20'), amountPaid: 0, amountDue: 0, ...over,
  });
  return {
    plans: [
      { id: 1, name: 'Basic', billingPeriod: 'MONTHLY', autoClose: false },
      { id: 2, name: 'Weekly', billingPeriod: 'WEEKLY', autoClose: false },
      { id: 3, name: 'Annual', billingPeriod: 'YEARLY', autoClose: true },
      { id: 4, name: 'Daily', billingPeriod: 'DAILY', autoClose: false },
    ],
    subs: [
      s({ id: 1, planId: 1, status: 'ACTIVE', recurringAmount: 100_000, activatedAt: ISO('2026-10-01'), expiryDate: ISO('2026-11-15') }),
      s({ id: 2, planId: 1, status: 'ACTIVE', recurringAmount: 50_000, activatedAt: ISO('2026-09-30'), expiryDate: ISO('2026-10-10') }),
      s({ id: 3, planId: 2, status: 'ACTIVE', recurringAmount: 1_000, activatedAt: ISO('2026-10-31'), expiryDate: ISO('2026-12-15') }),
      s({ id: 4, planId: 3, status: 'ACTIVE', recurringAmount: 1_200_005, customerId: 1002, expiryDate: ISO('2026-10-01') }),
      s({ id: 5, planId: 4, status: 'ACTIVE', recurringAmount: 100, expiryDate: ISO('2026-11-30') }),
      s({ id: 6, planId: 1, status: 'PAUSED', recurringAmount: 70_000 }),
      s({ id: 7, planId: 1, status: 'CLOSED', recurringAmount: 70_000, closedAt: ISO('2026-10-31') }),
      s({ id: 8, planId: 1, status: 'CLOSED', recurringAmount: 70_000, closedAt: ISO('2026-11-01') }),
      s({ id: 9, planId: 2, status: 'DRAFT' }),
    ],
    invoices: [
      // PAID in full by a payment on the first day of the window.
      inv({ id: 1, subscriptionId: 1, status: 'PAID', total: 118_000, amountPaid: 118_000, issueDate: ISO('2026-10-01') }),
      // Part paid, overdue by 11 days.
      inv({ id: 2, subscriptionId: 2, status: 'CONFIRMED', total: 59_000, amountPaid: 9_000, amountDue: 50_000, issueDate: ISO('2026-10-05'), dueDate: ISO('2026-10-20') }),
      // Unpaid, not yet due, issued on the last day of the window.
      inv({ id: 3, subscriptionId: 3, status: 'CONFIRMED', total: 1_180, amountDue: 1_180, issueDate: ISO('2026-10-31'), dueDate: ISO('2026-11-15') }),
      // Excluded from invoiced: DRAFT and CANCELLED.
      inv({ id: 4, subscriptionId: 1, status: 'DRAFT', total: 999 }),
      inv({ id: 5, subscriptionId: 1, status: 'CANCELLED', total: 777 }),
    ],
    payments: [
      { id: 1, invoiceId: 1, customerId: 1001, method: 'UPI', amount: 100_000, paymentDate: ISO('2026-10-01') },
      { id: 2, invoiceId: 1, customerId: 1001, method: 'CASH', amount: 18_000, paymentDate: ISO('2026-10-31') },
      { id: 3, invoiceId: 2, customerId: 1001, method: 'UPI', amount: 9_000, paymentDate: ISO('2026-10-15') },
    ],
    calls: [],
    windows: [],
  };
}

function setup(w: World = world(), clock = CLOCK): { w: World; service: ReportsService } {
  return { w, service: new ReportsService(fakeRepo(w), () => new Date(clock)) };
}

async function server(t: { after(fn: () => Promise<void>): void }, service: ReportsService): Promise<TestServer> {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/reports', createReportsRouter({ authService: auth.asAuthService(), reportsService: service })));
}

async function expect400(promise: Promise<unknown>, field: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 400);
    assert.match(JSON.stringify(error.details), new RegExp(field));
    return true;
  });
}

test('RBAC matrix: every report is ADMIN and STAFF only; CUSTOMER gets 403 and anonymous 401', async (t) => {
  const { service } = setup();
  await assertRbacMatrix(await server(t, service), [
    { method: 'GET', path: '/reports/summary', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/reports/revenue/timeseries', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/reports/revenue/by-plan', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/reports/payments/summary', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/reports/invoices/overdue', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/reports/aging', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/reports/subscriptions/expiring', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
  ]);
});

test('service refuses a CUSTOMER actor even without the route guard', async () => {
  const { service } = setup();
  await assert.rejects(service.summary(actorFor(Role.CUSTOMER), {}), (error: unknown) => error instanceof AppError && error.status === 403);
});

test('MRR normalisation: DAILY x30, WEEKLY x52/12, MONTHLY x1, YEARLY /12, integer paise rounded half up', () => {
  assert.equal(groupMrr({ billingPeriod: 'DAILY', recurring: 100 }), 3_000);
  assert.equal(groupMrr({ billingPeriod: 'WEEKLY', recurring: 1_000 }), 4_333); // 4333.33
  assert.equal(groupMrr({ billingPeriod: 'WEEKLY', recurring: 3 }), 13); // 13.0
  assert.equal(groupMrr({ billingPeriod: 'WEEKLY', recurring: 9 }), 39);
  assert.equal(groupMrr({ billingPeriod: 'MONTHLY', recurring: 150_000 }), 150_000);
  assert.equal(groupMrr({ billingPeriod: 'YEARLY', recurring: 1_200_005 }), 100_000); // 100000.42
  assert.equal(groupMrr({ billingPeriod: 'YEARLY', recurring: 6 }), 1); // 0.5 rounds up
  for (const period of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const) {
    assert.ok(Number.isInteger(groupMrr({ billingPeriod: period, recurring: 12_345 })));
  }
});

test('summary: totals match the hand-computed fixture, using three repository queries', async () => {
  const { w, service } = setup();
  const summary: ReportSummaryDto = await service.summary(STAFF, {});
  assert.deepEqual(summary, {
    activeSubscriptions: 5,
    subscriptionsByStatus: { DRAFT: 1, QUOTATION: 0, CONFIRMED: 0, ACTIVE: 5, PAUSED: 1, CLOSED: 2 },
    // activatedAt in October: subs 1 (01 Oct) and 3 (31 Oct); sub 2 activated 30 Sep.
    newSubscriptions: 2,
    // closedAt in October: sub 7 (31 Oct); sub 8 closed 01 Nov.
    closedSubscriptions: 1,
    // CONFIRMED and PAID issued in October: 118000 + 59000 + 1180. DRAFT and CANCELLED excluded.
    invoicedAmount: 178_180,
    revenueReceived: 127_000,
    outstandingAmount: 51_180,
    overdueAmount: 50_000,
    overdueCount: 1,
    // Basic 150000 + Weekly round(1000*52/12)=4333 + Annual round(1200005/12)=100000 + Daily 100*30=3000.
    mrr: 257_333,
    arr: 3_087_996,
  });
  assert.deepEqual([...w.calls].sort(), ['invoiceTotals', 'paymentsReceived', 'subscriptionGroups']);
});

test('summary: paise reconcile, received + outstanding = invoiced for confirmed and paid invoices', async () => {
  const { service } = setup();
  const summary = await service.summary(STAFF, { from: D('2026-10-01'), to: END('2026-10-31') });
  assert.equal(summary.revenueReceived + summary.outstandingAmount, summary.invoicedAmount);
  for (const value of [summary.invoicedAmount, summary.revenueReceived, summary.outstandingAmount, summary.mrr, summary.arr]) {
    assert.ok(Number.isSafeInteger(value));
  }
});

test('summary: planId and customerId filters narrow every figure', async () => {
  const { service } = setup();
  const basic = await service.summary(STAFF, { planId: 1 });
  assert.equal(basic.activeSubscriptions, 2);
  assert.equal(basic.mrr, 150_000);
  assert.equal(basic.invoicedAmount, 177_000);
  assert.equal(basic.revenueReceived, 127_000);
  const other = await service.summary(STAFF, { customerId: 1002 });
  assert.equal(other.activeSubscriptions, 1);
  assert.equal(other.mrr, 100_000);
  assert.equal(other.invoicedAmount, 0);
});

test('date range: defaults to the current month in APP_TIMEZONE; a date-only to is the end of that day', async (t) => {
  // 20:00 UTC on 31 Oct is already 1 Nov in Asia/Kolkata.
  const late = setup(world(), '2026-10-31T20:00:00.000Z');
  await late.service.paymentsSummary(STAFF, {});
  assert.deepEqual(late.w.windows[0], { from: D('2026-11-01'), to: END('2026-11-30') });

  const { w, service } = setup();
  const srv = await server(t, service);
  const response = await srv.request<ApiBody & { data: PaymentsSummaryDto }>('/reports/payments/summary?from=2026-10-01&to=2026-10-31', { role: Role.ADMIN });
  assert.equal(response.status, 200);
  assert.deepEqual(w.windows[0], { from: D('2026-10-01'), to: END('2026-10-31') });
  assert.equal(response.body.data.total, 127_000);
});

test('date range: both boundaries are inclusive', async () => {
  const { service } = setup();
  // Payments on 01 Oct (100000 UPI) and 31 Oct (18000 CASH) sit on the edges.
  const edges = await service.paymentsSummary(STAFF, { from: D('2026-10-01'), to: END('2026-10-31') });
  assert.equal(edges.total, 127_000);
  const inner = await service.paymentsSummary(STAFF, { from: D('2026-10-02'), to: END('2026-10-30') });
  assert.equal(inner.total, 9_000);
  const lastDay = await service.paymentsSummary(STAFF, { from: D('2026-10-31'), to: END('2026-10-31') });
  assert.deepEqual(lastDay.byMethod.find((m) => m.method === 'CASH'), { method: 'CASH', count: 1, amount: 18_000 });
  assert.equal(lastDay.total, 18_000);
});

test('date range: from after to is a 400; resolveRange keeps explicit bounds', async (t) => {
  assert.deepEqual(resolveRange({ from: D('2026-01-01') }, D('2026-10-31')), { from: D('2026-01-01'), to: END('2026-10-31') });
  assert.deepEqual(currentMonth(D('2024-02-10')), { from: D('2024-02-01'), to: END('2024-02-29') });
  const { service } = setup();
  const srv = await server(t, service);
  const response = await srv.request<ApiBody>('/reports/summary?from=2026-10-31&to=2026-10-01', { role: Role.STAFF });
  assert.equal(response.status, 400);
  assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  assert.equal(response.body.error?.details?.[0]?.field, 'from');
  assert.equal((await srv.request('/reports/summary?from=2026-02-30', { role: Role.STAFF })).status, 400);
  assert.equal((await srv.request('/reports/summary?planId=0', { role: Role.STAFF })).status, 400);
  assert.equal((await srv.request('/reports/summary?bogus=1', { role: Role.STAFF })).status, 400);
});

test('timeseries: day interval over 366 days is a 400; exactly 366 days is allowed', async (t) => {
  const { service } = setup();
  const srv = await server(t, service);
  const tooLong = await srv.request<ApiBody>('/reports/revenue/timeseries?interval=day&from=2025-01-01&to=2026-01-02', { role: Role.STAFF });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error?.details?.[0]?.field, 'interval');
  const leap = await srv.request<ApiBody & { data: RevenueTimeseriesDto }>('/reports/revenue/timeseries?interval=day&from=2024-01-01&to=2024-12-31', { role: Role.STAFF });
  assert.equal(leap.status, 200);
  assert.equal(leap.body.data.length, 366);
  const monthly = await srv.request('/reports/revenue/timeseries?interval=month&from=2020-01-01&to=2026-12-31', { role: Role.STAFF });
  assert.equal(monthly.status, 200);
  assert.equal((await srv.request('/reports/revenue/timeseries?interval=year', { role: Role.STAFF })).status, 400);
  await expect400(service.revenueTimeseries(STAFF, { interval: 'day', from: D('2026-01-01'), to: END('2027-01-02') }), 'interval');
});

test('timeseries: zero-filled buckets with invoiced and received per period', async () => {
  const { service } = setup();
  const weekly = await service.revenueTimeseries(STAFF, { interval: 'week', from: D('2026-10-01'), to: END('2026-10-31') });
  // ISO weeks starting Monday: 28 Sep, 5, 12, 19, 26 Oct.
  assert.deepEqual(weekly, [
    { period: ISO('2026-09-28'), invoiced: 118_000, received: 100_000 },
    { period: ISO('2026-10-05'), invoiced: 59_000, received: 0 },
    { period: ISO('2026-10-12'), invoiced: 0, received: 9_000 },
    { period: ISO('2026-10-19'), invoiced: 0, received: 0 },
    { period: ISO('2026-10-26'), invoiced: 1_180, received: 18_000 },
  ]);
  const monthly = await service.revenueTimeseries(STAFF, { interval: 'month', from: D('2026-09-15'), to: END('2026-11-01') });
  assert.deepEqual(monthly, [
    { period: ISO('2026-09-01'), invoiced: 0, received: 0 },
    { period: ISO('2026-10-01'), invoiced: 178_180, received: 127_000 },
    { period: ISO('2026-11-01'), invoiced: 0, received: 0 },
  ]);
  const daily = await service.revenueTimeseries(STAFF, { interval: 'day', from: D('2026-10-30'), to: END('2026-10-31') });
  assert.deepEqual(daily, [
    { period: ISO('2026-10-30'), invoiced: 0, received: 0 },
    { period: ISO('2026-10-31'), invoiced: 1_180, received: 18_000 },
  ]);
  // Sum of buckets equals the summary totals for the same window.
  const sums = weekly.reduce((acc, b) => ({ invoiced: acc.invoiced + b.invoiced, received: acc.received + b.received }), { invoiced: 0, received: 0 });
  assert.deepEqual(sums, { invoiced: 178_180, received: 127_000 });
});

test('bucket helpers: week starts Monday, month buckets cross year ends, assembly ignores unknown periods', () => {
  assert.deepEqual(bucketStart(D('2026-11-01'), 'week'), D('2026-10-26')); // Sunday
  assert.deepEqual(bucketStart(D('2026-10-26'), 'week'), D('2026-10-26')); // Monday
  assert.deepEqual(bucketStarts({ from: D('2026-11-20'), to: END('2027-01-05') }, 'month'), [D('2026-11-01'), D('2026-12-01'), D('2027-01-01')]);
  assert.deepEqual(assembleTimeseries([D('2026-10-01')], [{ period: '2026-10-01', amount: 5 }, { period: '1999-01-01', amount: 9 }], []), [
    { period: ISO('2026-10-01'), invoiced: 5, received: 0 },
  ]);
});

test('revenue by plan: active count, per-plan MRR and received; plan MRR sums to the summary MRR', async () => {
  const { w, service } = setup();
  const byPlan: RevenueByPlanDto = await service.revenueByPlan(STAFF, {});
  assert.deepEqual(byPlan, [
    { planId: 1, planName: 'Basic', activeSubscriptions: 2, mrr: 150_000, received: 127_000 },
    { planId: 3, planName: 'Annual', activeSubscriptions: 1, mrr: 100_000, received: 0 },
    { planId: 2, planName: 'Weekly', activeSubscriptions: 1, mrr: 4_333, received: 0 },
    { planId: 4, planName: 'Daily', activeSubscriptions: 1, mrr: 3_000, received: 0 },
  ]);
  const summary = await service.summary(STAFF, {});
  assert.equal(byPlan.reduce((sum, plan) => sum + plan.mrr, 0), summary.mrr);
  assert.deepEqual(w.calls.slice(0, 2).sort(), ['receivedByPlan', 'subscriptionGroups']);
});

test('payments summary: every method present, zero-filled, with the total', async () => {
  const { service } = setup();
  const result = await service.paymentsSummary(STAFF, {});
  assert.equal(result.byMethod.length, 7);
  assert.deepEqual(result.byMethod.find((m) => m.method === 'UPI'), { method: 'UPI', count: 2, amount: 109_000 });
  assert.deepEqual(result.byMethod.find((m) => m.method === 'CARD'), { method: 'CARD', count: 0, amount: 0 });
  assert.equal(result.total, 127_000);
});

test('aging: buckets by days past due, boundaries at 0/1, 30/31, 60/61, 90/91 days', async (t) => {
  const today = D('2026-10-31');
  const cases: [number, keyof AgingDto][] = [
    [-5, 'notDue'], [0, 'notDue'], [1, 'days1To30'], [30, 'days1To30'], [31, 'days31To60'], [60, 'days31To60'],
    [61, 'days61To90'], [90, 'days61To90'], [91, 'over90'], [400, 'over90'],
  ];
  const w = world();
  w.invoices = cases.map(([days], index) => ({
    id: index + 1, number: `INV-${index}`, subscriptionId: 1, customerId: 1001, customerName: 'Acme', status: 'CONFIRMED',
    issueDate: ISO('2025-01-01'), dueDate: addDays(today, -days).toISOString(), total: 100 * (index + 1), amountPaid: 0, amountDue: 100 * (index + 1),
  }));
  w.invoices.push({ ...w.invoices[0]!, id: 99, status: 'PAID', amountDue: 0 });
  for (const [days, bucket] of cases) assert.equal(agingBucketFor(addDays(today, -days), today), bucket, `${days} days`);
  assert.deepEqual(agingCutoffs(today), { today, minus30: D('2026-10-01'), minus60: D('2026-09-01'), minus90: D('2026-08-02') });

  const { service } = setup(w);
  const srv = await server(t, service);
  const response = await srv.request<ApiBody & { data: AgingDto }>('/reports/aging', { role: Role.STAFF });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, {
    notDue: { count: 2, amount: 300 },
    days1To30: { count: 2, amount: 700 },
    days31To60: { count: 2, amount: 1_100 },
    days61To90: { count: 2, amount: 1_500 },
    over90: { count: 2, amount: 1_900 },
  });
  assert.equal((await srv.request('/reports/aging?customerId=abc', { role: Role.STAFF })).status, 400);
});

test('overdue list: CONFIRMED with amount due and a past due date, daysOverdue computed, paginated meta', async (t) => {
  const { service } = setup();
  const srv = await server(t, service);
  const response = await srv.request<ApiBody & { data: OverdueInvoiceDto[] }>('/reports/invoices/overdue', { role: Role.STAFF });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, [{
    id: 2, number: 'INV-2026-000002', customerId: 1001, customerName: 'Acme Ltd', subscriptionId: 2,
    subscriptionNumber: 'SUB-2026-000002', dueDate: ISO('2026-10-20'), total: 59_000, amountPaid: 9_000, amountDue: 50_000, daysOverdue: 11,
  }]);
  assert.deepEqual(response.body.meta, { page: 1, limit: 10, total: 1, totalPages: 1, hasNext: false, hasPrev: false });
  const filtered = await srv.request<ApiBody & { data: OverdueInvoiceDto[] }>('/reports/invoices/overdue?minDaysOverdue=12', { role: Role.STAFF });
  assert.equal(filtered.body.data.length, 0);
  const past = await srv.request<ApiBody & { data: OverdueInvoiceDto[] }>('/reports/invoices/overdue?page=2', { role: Role.STAFF });
  assert.deepEqual(past.body.data, []);
  assert.equal(past.body.meta?.total, 1);
  assert.equal(daysOverdueOn('2026-10-31T00:00:00.000Z', D('2026-10-31')), 0);
  assert.equal(daysOverdueOn('2026-10-30T18:00:00.000Z', D('2026-10-31')), 1);
});

test('list contract: limit 101, unknown sortBy, unknown keys and bad filters are 400 on both lists', async (t) => {
  const { service } = setup();
  const srv = await server(t, service);
  const bad = [
    '/reports/invoices/overdue?limit=101',
    '/reports/invoices/overdue?limit=0',
    '/reports/invoices/overdue?sortBy=createdAt',
    '/reports/invoices/overdue?sortOrder=up',
    '/reports/invoices/overdue?status=PAID',
    '/reports/invoices/overdue?minAmount=-1',
    '/reports/invoices/overdue?dueFrom=2026-10-10&dueTo=2026-10-01',
    '/reports/subscriptions/expiring?limit=101',
    '/reports/subscriptions/expiring?sortBy=number',
    '/reports/subscriptions/expiring?foo=bar',
    '/reports/subscriptions/expiring?withinDays=0',
    '/reports/subscriptions/expiring?withinDays=366',
    '/reports/subscriptions/expiring?withinDays=1.5',
  ];
  for (const path of bad) {
    const response = await srv.request<ApiBody>(path, { role: Role.ADMIN });
    assert.equal(response.status, 400, path);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR', path);
  }
  for (const path of ['/reports/invoices/overdue?limit=100&sortBy=amountDue&sortOrder=asc&search=acme', '/reports/subscriptions/expiring?withinDays=365&limit=100']) {
    assert.equal((await srv.request(path, { role: Role.ADMIN })).status, 200, path);
  }
});

test('expiring: ACTIVE within the window, or past expiry without autoClose; default 30 days', async (t) => {
  const { service } = setup();
  const srv = await server(t, service);
  const response = await srv.request<ApiBody & { data: ExpiringSubscriptionDto[] }>('/reports/subscriptions/expiring', { role: Role.STAFF });
  assert.equal(response.status, 200);
  // Sub 1 (15 Nov) and 5 (30 Nov, the 30th day) are within 30 days; sub 2 lapsed on a plan without autoClose;
  // sub 4 lapsed on an autoClose plan (the job closes it); sub 3 expires in 45 days.
  assert.deepEqual(response.body.data.map((row) => row.id).sort(), [1, 2, 5]);
  assert.equal(response.body.meta?.total, 3);
  const row = response.body.data.find((item) => item.id === 2)!;
  assert.deepEqual(row, {
    id: 2, number: 'SUB-2026-000002', customerId: 1001, customerName: 'Customer 1001', planId: 1, planName: 'Basic',
    status: 'ACTIVE', expiryDate: ISO('2026-10-10'), nextBillingDate: null, recurringAmount: 50_000, autoClose: false,
  });
  const wider = await srv.request<ApiBody & { data: ExpiringSubscriptionDto[] }>('/reports/subscriptions/expiring?withinDays=45', { role: Role.STAFF });
  assert.deepEqual(wider.body.data.map((item) => item.id).sort(), [1, 2, 3, 5]);
  const narrow = await srv.request<ApiBody & { data: ExpiringSubscriptionDto[] }>('/reports/subscriptions/expiring?withinDays=29', { role: Role.STAFF });
  assert.deepEqual(narrow.body.data.map((item) => item.id).sort(), [1, 2]);
});
