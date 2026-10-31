/**
 * Reports data access. Section-4 exception (backend plan): this repository reads across
 * `Subscription`, `Plan`, `Invoice`, `Payment` and `Customer`, and never writes anything.
 *
 * Every report is one to three set-based queries; nothing runs per row. Grouping that the ORM
 * cannot express (FILTER clauses, date_trunc buckets, joins through Invoice to Subscription) uses
 * the parameter-bound raw lane. No user input is ever concatenated into SQL: values are
 * interpolated as bound parameters, and an absent id filter is passed as the sentinel 0, which no
 * row can have because ids start at 1.
 *
 * Dates are stored as UTC midnight of the business date, so truncating in UTC gives business
 * calendar buckets. SQL correctness has not been verified against a live database.
 */

import {
  InvoiceStatus, SubscriptionStatus, type BillingPeriod, type PaymentMethod, type ReportInterval,
} from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { addDays } from '../../core/utils/dates.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { ListExpiringParams, ListOverdueParams } from './reports.schema.js';

const INT8 = 'pg/int8number@1';
const TEXT = 'pg/text@1';
const NO_FILTER = 0;

export interface DateWindow {
  from: Date;
  to: Date;
}

/** One row per (status, plan) for non-deleted subscriptions. */
export interface SubscriptionGroupRow {
  status: SubscriptionStatus;
  planId: number;
  planName: string;
  billingPeriod: BillingPeriod;
  count: number;
  /** Sum of `recurringAmount` (paise per billing period) over the group. */
  recurring: number;
  /** Subscriptions whose `activatedAt` falls in the window. */
  activated: number;
  /** Subscriptions whose `closedAt` falls in the window. */
  closed: number;
}

export interface InvoiceTotalsRow {
  invoiced: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
}

export interface PeriodAmountRow {
  /** Bucket start as `YYYY-MM-DD` (UTC). */
  period: string;
  amount: number;
}

export interface PlanAmountRow {
  planId: number;
  planName: string;
  amount: number;
}

export interface MethodTotalsRow {
  method: PaymentMethod;
  count: number;
  amount: number;
}

/** Day cut-offs (UTC midnights) for the aging buckets, computed by the service from business today. */
export interface AgingCutoffs {
  today: Date;
  minus30: Date;
  minus60: Date;
  minus90: Date;
}

export interface AgingRow {
  notDueCount: number;
  notDueAmount: number;
  d1To30Count: number;
  d1To30Amount: number;
  d31To60Count: number;
  d31To60Amount: number;
  d61To90Count: number;
  d61To90Amount: number;
  over90Count: number;
  over90Amount: number;
}

export interface OverdueInvoiceRow {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  subscriptionId: number;
  subscriptionNumber: string;
  dueDate: string;
  total: number;
  amountPaid: number;
  amountDue: number;
}

export interface ExpiringSubscriptionRow {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  planId: number;
  planName: string;
  expiryDate: string;
  nextBillingDate: string | null;
  recurringAmount: number;
  autoClose: boolean;
}

export interface SubscriptionFilter {
  planId?: number;
  customerId?: number;
}

/** Window for the expiring list: `[today, until]` plus anything already past expiry without autoClose. */
export interface ExpiringWindow {
  today: Date;
  until: Date;
}

type InvoiceAccessor = ModelAccessor<Contract, 'Invoice', 'public'>;
type SubscriptionAccessor = ModelAccessor<Contract, 'Subscription', 'public'>;

const iso = (date: Date): string => date.toISOString();

/** Makes `%`, `_` and `\` literal so user input cannot act as an ILIKE wildcard. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function overdueWhere(query: ListOverdueParams, today: Date) {
  return (invoice: InvoiceAccessor) => {
    const conditions = [
      invoice.status.eq(InvoiceStatus.CONFIRMED),
      invoice.amountDue.gt(0),
      invoice.dueDate.lt(iso(today)),
    ];
    if (query.customerId !== undefined) conditions.push(invoice.customerId.eq(query.customerId));
    if (query.subscriptionId !== undefined) conditions.push(invoice.subscriptionId.eq(query.subscriptionId));
    // daysOverdue >= N  <=>  start of dueDate's day <= today - N days  <=>  dueDate < today - (N - 1) days.
    if (query.minDaysOverdue !== undefined) conditions.push(invoice.dueDate.lt(iso(addDays(today, 1 - query.minDaysOverdue))));
    if (query.minAmount !== undefined) conditions.push(invoice.amountDue.gte(query.minAmount));
    if (query.dueFrom !== undefined) conditions.push(invoice.dueDate.gte(iso(query.dueFrom)));
    if (query.dueTo !== undefined) conditions.push(invoice.dueDate.lte(iso(query.dueTo)));
    if (query.search !== undefined) {
      const pattern = `%${likeLiteral(query.search)}%`;
      conditions.push(or(
        invoice.number.ilike(pattern), invoice.customerName.ilike(pattern), invoice.customerEmail.ilike(pattern),
      ));
    }
    return and(...conditions);
  };
}

function expiringWhere(query: ListExpiringParams, window: ExpiringWindow) {
  return (subscription: SubscriptionAccessor) => {
    const conditions = [
      subscription.status.eq(SubscriptionStatus.ACTIVE),
      subscription.deletedAt.isNull(),
      or(
        and(subscription.expiryDate.gte(iso(window.today)), subscription.expiryDate.lte(iso(window.until))),
        and(
          subscription.expiryDate.lt(iso(window.today)),
          subscription.plan.some((plan) => plan.autoClose.eq(false)),
        ),
      ),
    ];
    if (query.planId !== undefined) conditions.push(subscription.planId.eq(query.planId));
    if (query.customerId !== undefined) conditions.push(subscription.customerId.eq(query.customerId));
    if (query.search !== undefined) {
      const pattern = `%${likeLiteral(query.search)}%`;
      conditions.push(or(
        subscription.number.ilike(pattern),
        subscription.customer.some((customer) => customer.name.ilike(pattern)),
      ));
    }
    return and(...conditions);
  };
}

export class ReportsRepository {
  /** Subscription counts and recurring sums per (status, plan), with activations and closures in the window. */
  async subscriptionGroups(window: DateWindow, filter: SubscriptionFilter = {}): Promise<SubscriptionGroupRow[]> {
    const subscription = prisma.sql.public.Subscription;
    const plan = prisma.sql.public.Plan;
    const from = iso(window.from);
    const to = iso(window.to);
    const planId = filter.planId ?? NO_FILTER;
    const customerId = filter.customerId ?? NO_FILTER;
    const query = prisma.raw.sql`
      SELECT s."status" AS "status", s."planId" AS "planId", p."name" AS "planName",
        p."billingPeriod" AS "billingPeriod",
        COUNT(*)::bigint AS "count",
        COALESCE(SUM(s."recurringAmount"), 0)::bigint AS "recurring",
        COUNT(*) FILTER (WHERE s."activatedAt" >= ${from}::timestamptz AND s."activatedAt" <= ${to}::timestamptz)::bigint AS "activated",
        COUNT(*) FILTER (WHERE s."closedAt" >= ${from}::timestamptz AND s."closedAt" <= ${to}::timestamptz)::bigint AS "closed"
      FROM "public"."Subscription" s
      JOIN "public"."Plan" p ON p."id" = s."planId"
      WHERE s."deletedAt" IS NULL
        AND (${planId}::int = 0 OR s."planId" = ${planId}::int)
        AND (${customerId}::int = 0 OR s."customerId" = ${customerId}::int)
      GROUP BY s."status", s."planId", p."name", p."billingPeriod"`
      .returnsRow({
        status: subscription.columns.status,
        planId: subscription.columns.planId,
        planName: plan.columns.name,
        billingPeriod: plan.columns.billingPeriod,
        count: INT8,
        recurring: INT8,
        activated: INT8,
        closed: INT8,
      })
      .build();
    const rows = await prisma.query(query);
    return rows.map((row) => ({
      status: row.status, planId: row.planId, planName: row.planName, billingPeriod: row.billingPeriod,
      count: row.count, recurring: row.recurring, activated: row.activated, closed: row.closed,
    }));
  }

  /**
   * Invoiced = `total` of CONFIRMED and PAID invoices issued in the window. Outstanding and overdue
   * are as of now (CONFIRMED with `amountDue > 0`; overdue also has `dueDate` before today).
   */
  async invoiceTotals(window: DateWindow, today: Date, filter: SubscriptionFilter = {}): Promise<InvoiceTotalsRow> {
    const from = iso(window.from);
    const to = iso(window.to);
    const todayIso = iso(today);
    const planId = filter.planId ?? NO_FILTER;
    const customerId = filter.customerId ?? NO_FILTER;
    const query = prisma.raw.sql`
      SELECT
        COALESCE(SUM(i."total") FILTER (
          WHERE i."issueDate" >= ${from}::timestamptz AND i."issueDate" <= ${to}::timestamptz), 0)::bigint AS "invoiced",
        COALESCE(SUM(i."amountDue") FILTER (
          WHERE i."status" = 'CONFIRMED' AND i."amountDue" > 0), 0)::bigint AS "outstanding",
        COALESCE(SUM(i."amountDue") FILTER (
          WHERE i."status" = 'CONFIRMED' AND i."amountDue" > 0 AND i."dueDate" < ${todayIso}::timestamptz), 0)::bigint AS "overdue",
        COUNT(*) FILTER (
          WHERE i."status" = 'CONFIRMED' AND i."amountDue" > 0 AND i."dueDate" < ${todayIso}::timestamptz)::bigint AS "overdueCount"
      FROM "public"."Invoice" i
      JOIN "public"."Subscription" s ON s."id" = i."subscriptionId"
      WHERE i."status" IN ('CONFIRMED', 'PAID')
        AND (${planId}::int = 0 OR s."planId" = ${planId}::int)
        AND (${customerId}::int = 0 OR i."customerId" = ${customerId}::int)`
      .returnsRow({ invoiced: INT8, outstanding: INT8, overdue: INT8, overdueCount: INT8 })
      .build();
    const rows = await prisma.query(query);
    const row = rows[0];
    if (row === undefined) return { invoiced: 0, outstanding: 0, overdue: 0, overdueCount: 0 };
    return { invoiced: row.invoiced, outstanding: row.outstanding, overdue: row.overdue, overdueCount: row.overdueCount };
  }

  /** Sum of `Payment.amount` with `paymentDate` in the window. */
  async paymentsReceived(window: DateWindow, filter: SubscriptionFilter = {}): Promise<number> {
    const planId = filter.planId ?? NO_FILTER;
    const customerId = filter.customerId ?? NO_FILTER;
    const query = prisma.raw.sql`
      SELECT COALESCE(SUM(pay."amount"), 0)::bigint AS "amount"
      FROM "public"."Payment" pay
      JOIN "public"."Invoice" i ON i."id" = pay."invoiceId"
      JOIN "public"."Subscription" s ON s."id" = i."subscriptionId"
      WHERE pay."paymentDate" >= ${iso(window.from)}::timestamptz AND pay."paymentDate" <= ${iso(window.to)}::timestamptz
        AND (${planId}::int = 0 OR s."planId" = ${planId}::int)
        AND (${customerId}::int = 0 OR pay."customerId" = ${customerId}::int)`
      .returnsRow({ amount: INT8 })
      .build();
    const rows = await prisma.query(query);
    return rows[0]?.amount ?? 0;
  }

  /** `total` of CONFIRMED and PAID invoices per `issueDate` bucket. Empty buckets are absent. */
  async invoicedByPeriod(window: DateWindow, interval: ReportInterval, planId?: number): Promise<PeriodAmountRow[]> {
    const plan = planId ?? NO_FILTER;
    const query = prisma.raw.sql`
      SELECT to_char(date_trunc(${interval}::text, i."issueDate" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "period",
        COALESCE(SUM(i."total"), 0)::bigint AS "amount"
      FROM "public"."Invoice" i
      JOIN "public"."Subscription" s ON s."id" = i."subscriptionId"
      WHERE i."status" IN ('CONFIRMED', 'PAID')
        AND i."issueDate" >= ${iso(window.from)}::timestamptz AND i."issueDate" <= ${iso(window.to)}::timestamptz
        AND (${plan}::int = 0 OR s."planId" = ${plan}::int)
      GROUP BY 1`
      .returnsRow({ period: TEXT, amount: INT8 })
      .build();
    const rows = await prisma.query(query);
    return rows.map((row) => ({ period: row.period, amount: row.amount }));
  }

  /** `Payment.amount` per `paymentDate` bucket. Empty buckets are absent. */
  async receivedByPeriod(window: DateWindow, interval: ReportInterval, planId?: number): Promise<PeriodAmountRow[]> {
    const plan = planId ?? NO_FILTER;
    const query = prisma.raw.sql`
      SELECT to_char(date_trunc(${interval}::text, pay."paymentDate" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "period",
        COALESCE(SUM(pay."amount"), 0)::bigint AS "amount"
      FROM "public"."Payment" pay
      JOIN "public"."Invoice" i ON i."id" = pay."invoiceId"
      JOIN "public"."Subscription" s ON s."id" = i."subscriptionId"
      WHERE pay."paymentDate" >= ${iso(window.from)}::timestamptz AND pay."paymentDate" <= ${iso(window.to)}::timestamptz
        AND (${plan}::int = 0 OR s."planId" = ${plan}::int)
      GROUP BY 1`
      .returnsRow({ period: TEXT, amount: INT8 })
      .build();
    const rows = await prisma.query(query);
    return rows.map((row) => ({ period: row.period, amount: row.amount }));
  }

  /** Payments in the window grouped by the plan of the invoiced subscription. */
  async receivedByPlan(window: DateWindow): Promise<PlanAmountRow[]> {
    const subscription = prisma.sql.public.Subscription;
    const plan = prisma.sql.public.Plan;
    const query = prisma.raw.sql`
      SELECT s."planId" AS "planId", p."name" AS "planName", COALESCE(SUM(pay."amount"), 0)::bigint AS "amount"
      FROM "public"."Payment" pay
      JOIN "public"."Invoice" i ON i."id" = pay."invoiceId"
      JOIN "public"."Subscription" s ON s."id" = i."subscriptionId"
      JOIN "public"."Plan" p ON p."id" = s."planId"
      WHERE pay."paymentDate" >= ${iso(window.from)}::timestamptz AND pay."paymentDate" <= ${iso(window.to)}::timestamptz
      GROUP BY s."planId", p."name"`
      .returnsRow({ planId: subscription.columns.planId, planName: plan.columns.name, amount: INT8 })
      .build();
    const rows = await prisma.query(query);
    return rows.map((row) => ({ planId: row.planId, planName: row.planName, amount: row.amount }));
  }

  /** Payment count and amount per method in the window. Methods with no payments are absent. */
  async paymentsByMethod(window: DateWindow): Promise<MethodTotalsRow[]> {
    const payment = prisma.sql.public.Payment;
    const query = prisma.raw.sql`
      SELECT pay."method" AS "method", COUNT(*)::bigint AS "count", COALESCE(SUM(pay."amount"), 0)::bigint AS "amount"
      FROM "public"."Payment" pay
      WHERE pay."paymentDate" >= ${iso(window.from)}::timestamptz AND pay."paymentDate" <= ${iso(window.to)}::timestamptz
      GROUP BY pay."method"`
      .returnsRow({ method: payment.columns.method, count: INT8, amount: INT8 })
      .build();
    const rows = await prisma.query(query);
    return rows.map((row) => ({ method: row.method, count: row.count, amount: row.amount }));
  }

  /** Outstanding invoices (CONFIRMED, `amountDue > 0`) bucketed by how far `dueDate` is behind today. */
  async aging(cutoffs: AgingCutoffs, customerId?: number): Promise<AgingRow> {
    const today = iso(cutoffs.today);
    const m30 = iso(cutoffs.minus30);
    const m60 = iso(cutoffs.minus60);
    const m90 = iso(cutoffs.minus90);
    const customer = customerId ?? NO_FILTER;
    const query = prisma.raw.sql`
      SELECT
        COUNT(*) FILTER (WHERE i."dueDate" >= ${today}::timestamptz)::bigint AS "notDueCount",
        COALESCE(SUM(i."amountDue") FILTER (WHERE i."dueDate" >= ${today}::timestamptz), 0)::bigint AS "notDueAmount",
        COUNT(*) FILTER (WHERE i."dueDate" < ${today}::timestamptz AND i."dueDate" >= ${m30}::timestamptz)::bigint AS "d1To30Count",
        COALESCE(SUM(i."amountDue") FILTER (WHERE i."dueDate" < ${today}::timestamptz AND i."dueDate" >= ${m30}::timestamptz), 0)::bigint AS "d1To30Amount",
        COUNT(*) FILTER (WHERE i."dueDate" < ${m30}::timestamptz AND i."dueDate" >= ${m60}::timestamptz)::bigint AS "d31To60Count",
        COALESCE(SUM(i."amountDue") FILTER (WHERE i."dueDate" < ${m30}::timestamptz AND i."dueDate" >= ${m60}::timestamptz), 0)::bigint AS "d31To60Amount",
        COUNT(*) FILTER (WHERE i."dueDate" < ${m60}::timestamptz AND i."dueDate" >= ${m90}::timestamptz)::bigint AS "d61To90Count",
        COALESCE(SUM(i."amountDue") FILTER (WHERE i."dueDate" < ${m60}::timestamptz AND i."dueDate" >= ${m90}::timestamptz), 0)::bigint AS "d61To90Amount",
        COUNT(*) FILTER (WHERE i."dueDate" < ${m90}::timestamptz)::bigint AS "over90Count",
        COALESCE(SUM(i."amountDue") FILTER (WHERE i."dueDate" < ${m90}::timestamptz), 0)::bigint AS "over90Amount"
      FROM "public"."Invoice" i
      WHERE i."status" = 'CONFIRMED' AND i."amountDue" > 0
        AND (${customer}::int = 0 OR i."customerId" = ${customer}::int)`
      .returnsRow({
        notDueCount: INT8, notDueAmount: INT8, d1To30Count: INT8, d1To30Amount: INT8,
        d31To60Count: INT8, d31To60Amount: INT8, d61To90Count: INT8, d61To90Amount: INT8,
        over90Count: INT8, over90Amount: INT8,
      })
      .build();
    const rows = await prisma.query(query);
    const row = rows[0];
    return {
      notDueCount: row?.notDueCount ?? 0, notDueAmount: row?.notDueAmount ?? 0,
      d1To30Count: row?.d1To30Count ?? 0, d1To30Amount: row?.d1To30Amount ?? 0,
      d31To60Count: row?.d31To60Count ?? 0, d31To60Amount: row?.d31To60Amount ?? 0,
      d61To90Count: row?.d61To90Count ?? 0, d61To90Amount: row?.d61To90Amount ?? 0,
      over90Count: row?.over90Count ?? 0, over90Amount: row?.over90Amount ?? 0,
    };
  }

  /** One page of overdue invoices with the subscription number joined in the same query. */
  async listOverdue(query: ListOverdueParams, today: Date): Promise<OverdueInvoiceRow[]> {
    // daysOverdue grows as dueDate gets older, so sorting by it is sorting by dueDate reversed.
    const asc = query.sortOrder === 'asc';
    const dueAsc = query.sortBy === 'daysOverdue' ? !asc : asc;
    const rows = await prisma.orm.public.Invoice
      .where(overdueWhere(query, today))
      .include('subscription', (subscription) => subscription.select('number'))
      .orderBy([
        (invoice) => {
          if (query.sortBy === 'amountDue') return asc ? invoice.amountDue.asc() : invoice.amountDue.desc();
          return dueAsc ? invoice.dueDate.asc() : invoice.dueDate.desc();
        },
        (invoice) => ((query.sortBy === 'amountDue' ? asc : dueAsc) ? invoice.id.asc() : invoice.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map((row) => ({
      id: row.id, number: row.number, customerId: row.customerId, customerName: row.customerName,
      subscriptionId: row.subscriptionId, subscriptionNumber: row.subscription?.number ?? '',
      dueDate: row.dueDate, total: row.total, amountPaid: row.amountPaid, amountDue: row.amountDue,
    }));
  }

  async countOverdue(query: ListOverdueParams, today: Date): Promise<number> {
    const result = await prisma.orm.public.Invoice.where(overdueWhere(query, today)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** One page of the renewals list with customer and plan joined in the same query. */
  async listExpiring(query: ListExpiringParams, window: ExpiringWindow): Promise<ExpiringSubscriptionRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.Subscription
      .where(expiringWhere(query, window))
      .include('customer', (customer) => customer.select('name'))
      .include('plan', (plan) => plan.select('name', 'autoClose'))
      .orderBy([
        (subscription) => (asc ? subscription.expiryDate.asc() : subscription.expiryDate.desc()),
        (subscription) => (asc ? subscription.id.asc() : subscription.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.flatMap((row) => (row.expiryDate === null ? [] : [{
      id: row.id, number: row.number, customerId: row.customerId, customerName: row.customer?.name ?? '',
      planId: row.planId, planName: row.plan?.name ?? '', expiryDate: row.expiryDate,
      nextBillingDate: row.nextBillingDate, recurringAmount: row.recurringAmount, autoClose: row.plan?.autoClose ?? false,
    }]));
  }

  async countExpiring(query: ListExpiringParams, window: ExpiringWindow): Promise<number> {
    const result = await prisma.orm.public.Subscription
      .where(expiringWhere(query, window))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }
}
