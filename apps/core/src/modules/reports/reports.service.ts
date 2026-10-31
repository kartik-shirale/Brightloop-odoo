import {
  PaymentMethod, ReportInterval, SubscriptionStatus,
  type AgingDto, type ExpiringSubscriptionDto, type ListMeta, type OverdueInvoiceDto, type Paise,
  type PaymentsSummaryDto, type ReportSummaryDto, type RevenueByPlanDto, type RevenueTimeseriesDto,
} from '@brightloop/shared';
import { forbidden, validationError } from '../../core/errors.js';
import { isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { addDays, businessToday, endOfUtcDay, startOfUtcDay, toIsoDate } from '../../core/utils/dates.js';
import { monthlyEquivalent } from '../../core/utils/money.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import { toAgingDto, toExpiringSubscriptionDto, toOverdueInvoiceDto } from './reports.dto.js';
import type {
  AgingCutoffs, DateWindow, ExpiringWindow, MethodTotalsRow, PeriodAmountRow, ReportsRepository, SubscriptionGroupRow,
} from './reports.repository.js';
import {
  DEFAULT_WITHIN_DAYS,
  type AgingParams, type ListExpiringParams, type ListOverdueParams, type RangeParams, type SummaryParams,
  type TimeseriesParams,
} from './reports.schema.js';

const DAY_MS = 86_400_000;
export const MAX_DAY_BUCKETS = 366;

const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.DRAFT, SubscriptionStatus.QUOTATION, SubscriptionStatus.CONFIRMED,
  SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED, SubscriptionStatus.CLOSED,
];
const PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER, PaymentMethod.CARD, PaymentMethod.UPI,
  PaymentMethod.CHEQUE, PaymentMethod.ONLINE, PaymentMethod.OTHER,
];

/** The business month containing `today`: first day 00:00 to last day 23:59:59.999 (UTC dates). */
export function currentMonth(today: Date): DateWindow {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)),
    to: endOfUtcDay(new Date(Date.UTC(year, month + 1, 0))),
  };
}

/**
 * Inclusive report window. A missing `from` is the first day of the current business month and a
 * missing `to` is the end of its last day. `from` after `to` is a 400.
 */
export function resolveRange(range: RangeParams, today: Date): DateWindow {
  const month = currentMonth(today);
  const window = { from: range.from ?? month.from, to: range.to ?? month.to };
  if (window.from.getTime() > window.to.getTime()) {
    throw validationError('Validation failed', [{ field: 'from', message: 'from must not be after to' }]);
  }
  return window;
}

/** Calendar days touched by the window, counting both ends. */
export function daysInWindow(window: DateWindow): number {
  return Math.round((startOfUtcDay(window.to).getTime() - startOfUtcDay(window.from).getTime()) / DAY_MS) + 1;
}

/** Start of the bucket containing `date`: the day, the ISO week (Monday, as Postgres `date_trunc`), or the month. */
export function bucketStart(date: Date, interval: ReportInterval): Date {
  const day = startOfUtcDay(date);
  switch (interval) {
    case ReportInterval.DAY:
      return day;
    case ReportInterval.WEEK:
      return addDays(day, -((day.getUTCDay() + 6) % 7));
    case ReportInterval.MONTH:
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  }
}

function nextBucket(start: Date, interval: ReportInterval): Date {
  switch (interval) {
    case ReportInterval.DAY:
      return addDays(start, 1);
    case ReportInterval.WEEK:
      return addDays(start, 7);
    case ReportInterval.MONTH:
      return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
}

/** Every bucket start from the bucket holding `from` to the bucket holding `to`, in order. */
export function bucketStarts(window: DateWindow, interval: ReportInterval): Date[] {
  const starts: Date[] = [];
  const last = bucketStart(window.to, interval).getTime();
  for (let cursor = bucketStart(window.from, interval); cursor.getTime() <= last; cursor = nextBucket(cursor, interval)) {
    starts.push(cursor);
  }
  return starts;
}

/** Zero-fills the SQL buckets so the series has one entry per period, oldest first. */
export function assembleTimeseries(
  starts: readonly Date[],
  invoiced: readonly PeriodAmountRow[],
  received: readonly PeriodAmountRow[],
): RevenueTimeseriesDto {
  const invoicedBy = new Map(invoiced.map((row) => [row.period, row.amount]));
  const receivedBy = new Map(received.map((row) => [row.period, row.amount]));
  return starts.map((start) => {
    const key = toIsoDate(start);
    return { period: start.toISOString(), invoiced: invoicedBy.get(key) ?? 0, received: receivedBy.get(key) ?? 0 };
  });
}

/**
 * MRR of one (status, plan) group. The plan's summed `recurringAmount` is normalised once with
 * `monthlyEquivalent` (DAILY x30, WEEKLY x52/12, MONTHLY x1, YEARLY /12, rounded half up to whole
 * paise), so the summary MRR is exactly the sum of the per-plan MRR in `/revenue/by-plan`.
 */
export function groupMrr(group: Pick<SubscriptionGroupRow, 'recurring' | 'billingPeriod'>): Paise {
  return monthlyEquivalent(group.recurring, group.billingPeriod);
}

/** Total MRR over ACTIVE groups. */
export function mrrOf(groups: readonly SubscriptionGroupRow[]): Paise {
  let total = 0;
  for (const group of groups) {
    if (group.status === SubscriptionStatus.ACTIVE) total += groupMrr(group);
  }
  return total;
}

/** UTC-midnight cut-offs for the aging buckets. */
export function agingCutoffs(today: Date): AgingCutoffs {
  return { today, minus30: addDays(today, -30), minus60: addDays(today, -60), minus90: addDays(today, -90) };
}

export function summarize(
  groups: readonly SubscriptionGroupRow[],
  invoices: { invoiced: Paise; outstanding: Paise; overdue: Paise; overdueCount: number },
  received: Paise,
): ReportSummaryDto {
  const byStatus = Object.fromEntries(SUBSCRIPTION_STATUSES.map((status) => [status, 0])) as Record<SubscriptionStatus, number>;
  let newSubscriptions = 0;
  let closedSubscriptions = 0;
  for (const group of groups) {
    byStatus[group.status] += group.count;
    newSubscriptions += group.activated;
    closedSubscriptions += group.closed;
  }
  const mrr = mrrOf(groups);
  return {
    activeSubscriptions: byStatus.ACTIVE,
    subscriptionsByStatus: byStatus,
    newSubscriptions,
    closedSubscriptions,
    invoicedAmount: invoices.invoiced,
    revenueReceived: received,
    outstandingAmount: invoices.outstanding,
    overdueAmount: invoices.overdue,
    overdueCount: invoices.overdueCount,
    mrr,
    arr: mrr * 12,
  };
}

/** Every method in enum order, zero-filled, plus the grand total. */
export function summarizePayments(rows: readonly MethodTotalsRow[]): PaymentsSummaryDto {
  const byMethod = new Map(rows.map((row) => [row.method, row]));
  const items = PAYMENT_METHODS.map((method) => ({
    method, count: byMethod.get(method)?.count ?? 0, amount: byMethod.get(method)?.amount ?? 0,
  }));
  return { byMethod: items, total: items.reduce((sum, item) => sum + item.amount, 0) };
}

/**
 * Read-only reports for ADMIN and STAFF. Each method runs at most three set-based repository queries
 * in parallel and assembles the response in memory.
 */
export class ReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async summary(actor: Actor, query: SummaryParams): Promise<ReportSummaryDto> {
    this.assertStaff(actor);
    const today = this.today();
    const window = resolveRange(query, today);
    const filter = {
      ...(query.planId !== undefined ? { planId: query.planId } : {}),
      ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
    };
    const [groups, invoices, received] = await Promise.all([
      this.repository.subscriptionGroups(window, filter),
      this.repository.invoiceTotals(window, today, filter),
      this.repository.paymentsReceived(window, filter),
    ]);
    return summarize(groups, invoices, received);
  }

  async revenueTimeseries(actor: Actor, query: TimeseriesParams): Promise<RevenueTimeseriesDto> {
    this.assertStaff(actor);
    const window = resolveRange(query, this.today());
    if (query.interval === ReportInterval.DAY && daysInWindow(window) > MAX_DAY_BUCKETS) {
      throw validationError('Validation failed', [
        { field: 'interval', message: `A day interval covers at most ${MAX_DAY_BUCKETS} days` },
      ]);
    }
    const [invoiced, received] = await Promise.all([
      this.repository.invoicedByPeriod(window, query.interval, query.planId),
      this.repository.receivedByPeriod(window, query.interval, query.planId),
    ]);
    return assembleTimeseries(bucketStarts(window, query.interval), invoiced, received);
  }

  /** Active subscriptions and MRR are as of now; `received` covers the window. Highest MRR first. */
  async revenueByPlan(actor: Actor, query: RangeParams): Promise<RevenueByPlanDto> {
    this.assertStaff(actor);
    const window = resolveRange(query, this.today());
    const [groups, received] = await Promise.all([
      this.repository.subscriptionGroups(window),
      this.repository.receivedByPlan(window),
    ]);
    const plans = new Map<number, { planId: number; planName: string; activeSubscriptions: number; mrr: Paise; received: Paise }>();
    const entry = (planId: number, planName: string) => {
      const existing = plans.get(planId);
      if (existing !== undefined) return existing;
      const created = { planId, planName, activeSubscriptions: 0, mrr: 0, received: 0 };
      plans.set(planId, created);
      return created;
    };
    for (const group of groups) {
      if (group.status !== SubscriptionStatus.ACTIVE) continue;
      const plan = entry(group.planId, group.planName);
      plan.activeSubscriptions += group.count;
      plan.mrr += groupMrr(group);
    }
    for (const row of received) entry(row.planId, row.planName).received += row.amount;
    return [...plans.values()].sort((a, b) => b.mrr - a.mrr || b.received - a.received || a.planId - b.planId);
  }

  async paymentsSummary(actor: Actor, query: RangeParams): Promise<PaymentsSummaryDto> {
    this.assertStaff(actor);
    const window = resolveRange(query, this.today());
    return summarizePayments(await this.repository.paymentsByMethod(window));
  }

  async listOverdueInvoices(actor: Actor, query: ListOverdueParams): Promise<{ invoices: OverdueInvoiceDto[]; meta: ListMeta }> {
    this.assertStaff(actor);
    const today = this.today();
    const [rows, total] = await Promise.all([
      this.repository.listOverdue(query, today),
      this.repository.countOverdue(query, today),
    ]);
    return { invoices: rows.map((row) => toOverdueInvoiceDto(row, today)), meta: listMetaFor(total, query.page, query.limit) };
  }

  async aging(actor: Actor, query: AgingParams): Promise<AgingDto> {
    this.assertStaff(actor);
    return toAgingDto(await this.repository.aging(agingCutoffs(this.today()), query.customerId));
  }

  /** ACTIVE subscriptions expiring within `withinDays` (inclusive), or already past expiry on a plan without autoClose. */
  async listExpiringSubscriptions(
    actor: Actor,
    query: ListExpiringParams,
  ): Promise<{ subscriptions: ExpiringSubscriptionDto[]; meta: ListMeta }> {
    this.assertStaff(actor);
    const window = this.expiringWindow(query.withinDays ?? DEFAULT_WITHIN_DAYS);
    const [rows, total] = await Promise.all([
      this.repository.listExpiring(query, window),
      this.repository.countExpiring(query, window),
    ]);
    return { subscriptions: rows.map(toExpiringSubscriptionDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  private expiringWindow(withinDays: number): ExpiringWindow {
    const today = this.today();
    return { today, until: endOfUtcDay(addDays(today, withinDays)) };
  }

  private today(): Date {
    return businessToday(this.clock());
  }

  private assertStaff(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}
