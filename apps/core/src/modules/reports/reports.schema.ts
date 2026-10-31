import {
  ReportInterval,
  type AgingQuery, type ListExpiringSubscriptionsQuery, type ListOverdueInvoicesQuery, type PaymentsSummaryQuery,
  type ReportSummaryQuery, type RevenueByPlanQuery, type RevenueTimeseriesQuery,
} from '@brightloop/shared';
import { z } from 'zod';
import {
  buildListQuerySchema, queryDate, queryPaise, queryPositiveInt,
} from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const INTERVALS = [ReportInterval.DAY, ReportInterval.WEEK, ReportInterval.MONTH] as const;

export const MIN_WITHIN_DAYS = 1;
export const MAX_WITHIN_DAYS = 365;
export const DEFAULT_WITHIN_DAYS = 30;

/**
 * `from` and `to` are inclusive: a date-only `to` is the last millisecond of that day. Missing bounds
 * default to the current month in APP_TIMEZONE; the service fills them in and checks `from <= to`,
 * because the default depends on the clock.
 */
const rangeShape = {
  from: queryDate('from').optional(),
  to: queryDate('to').optional(),
};

export const summaryQuerySchema = z.strictObject({
  ...rangeShape,
  planId: queryPositiveInt.optional(),
  customerId: queryPositiveInt.optional(),
});

export const timeseriesQuerySchema = z.strictObject({
  ...rangeShape,
  interval: z.enum(INTERVALS).default(ReportInterval.MONTH),
  planId: queryPositiveInt.optional(),
});

export const rangeQuerySchema = z.strictObject(rangeShape);

export const agingQuerySchema = z.strictObject({
  customerId: queryPositiveInt.optional(),
});

export const listOverdueQuerySchema = buildListQuerySchema({
  sortable: ['daysOverdue', 'amountDue', 'dueDate'] as const,
  defaultSort: 'daysOverdue',
  filters: {
    customerId: queryPositiveInt,
    subscriptionId: queryPositiveInt,
    minDaysOverdue: queryPositiveInt,
    minAmount: queryPaise,
    dueFrom: queryDate('from'),
    dueTo: queryDate('to'),
  },
}).superRefine((value, ctx) => {
  if (value.dueFrom !== undefined && value.dueTo !== undefined && value.dueFrom.getTime() > value.dueTo.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['dueFrom'], message: 'dueFrom must not be after dueTo' });
  }
});

/** Renewals list: soonest expiry first unless the caller asks otherwise. */
export const listExpiringQuerySchema = buildListQuerySchema({
  sortable: ['expiryDate'] as const,
  defaultSort: 'expiryDate',
  filters: {
    withinDays: z.coerce.number().int().min(MIN_WITHIN_DAYS).max(MAX_WITHIN_DAYS),
    planId: queryPositiveInt,
    customerId: queryPositiveInt,
  },
}).extend({ sortOrder: z.enum(['asc', 'desc']).default('asc') });

export type SummaryParams = z.infer<typeof summaryQuerySchema>;
export type TimeseriesParams = z.infer<typeof timeseriesQuerySchema>;
export type RangeParams = z.infer<typeof rangeQuerySchema>;
export type AgingParams = z.infer<typeof agingQuerySchema>;
export type ListOverdueParams = z.infer<typeof listOverdueQuerySchema>;
export type ListExpiringParams = z.infer<typeof listExpiringQuerySchema>;

/* Zod-to-shared checks (backend plan 3.5): every accepted key exists on the shared query type. */
export type SummaryQueryCheck = AssertAssignable<keyof z.input<typeof summaryQuerySchema>, keyof ReportSummaryQuery>;
export type TimeseriesQueryCheck = AssertAssignable<keyof z.input<typeof timeseriesQuerySchema>, keyof RevenueTimeseriesQuery>;
export type TimeseriesIntervalCheck = AssertAssignable<TimeseriesParams['interval'], ReportInterval>;
export type RevenueByPlanQueryCheck = AssertAssignable<keyof z.input<typeof rangeQuerySchema>, keyof RevenueByPlanQuery>;
export type PaymentsSummaryQueryCheck = AssertAssignable<keyof z.input<typeof rangeQuerySchema>, keyof PaymentsSummaryQuery>;
export type AgingQueryCheck = AssertAssignable<keyof z.input<typeof agingQuerySchema>, keyof AgingQuery>;
export type OverdueQueryCheck = AssertAssignable<keyof z.input<typeof listOverdueQuerySchema>, keyof ListOverdueInvoicesQuery>;
export type OverdueSortCheck = AssertAssignable<ListOverdueParams['sortBy'], NonNullable<ListOverdueInvoicesQuery['sortBy']>>;
export type ExpiringQueryCheck = AssertAssignable<keyof z.input<typeof listExpiringQuerySchema>, keyof ListExpiringSubscriptionsQuery>;
export type ExpiringSortCheck = AssertAssignable<ListExpiringParams['sortBy'], NonNullable<ListExpiringSubscriptionsQuery['sortBy']>>;
