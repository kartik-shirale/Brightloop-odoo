import {
  BillingRunItemStatus,
  BillingRunStatus,
  type CreateBillingRunRequest,
  type ListBillingRunItemsQuery,
  type ListBillingRunsQuery,
} from '@brightloop/shared';
import { z } from 'zod';
import { isDateOnly, parseDateInput } from '../../core/utils/dates.js';
import { buildListQuerySchema, commaEnum, queryDate, queryPositiveInt } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const RUN_STATUSES = [
  BillingRunStatus.RUNNING, BillingRunStatus.COMPLETED, BillingRunStatus.PARTIAL, BillingRunStatus.FAILED,
] as const;
const ITEM_STATUSES = [BillingRunItemStatus.CREATED, BillingRunItemStatus.SKIPPED, BillingRunItemStatus.FAILED] as const;
const MAX_INT4 = 2147483647;
/** Bounds one explicit run; larger sets go through the due-subscription batches instead. */
export const MAX_SUBSCRIPTION_IDS = 1000;

/** Date-only (`YYYY-MM-DD`) business date. The "not in the future" rule needs the clock, so the service checks it. */
const runDateField = z.string().transform((raw, ctx): Date => {
  const parsed = isDateOnly(raw) ? parseDateInput(raw) : null;
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected a calendar date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return parsed;
});

export const createBillingRunSchema = z.strictObject({
  runDate: runDateField.optional(),
  autoConfirm: z.boolean().optional(),
  /** Restricts the run to these subscriptions (duplicates are ignored). */
  subscriptionIds: z.array(z.number().int().min(1).max(MAX_INT4)).min(1).max(MAX_SUBSCRIPTION_IDS).optional(),
});

/** Runs have no free-text field, so `search` is not accepted. */
export const listBillingRunsQuerySchema = buildListQuerySchema({
  sortable: ['runDate', 'startedAt', 'createdCount', 'status'] as const,
  defaultSort: 'startedAt',
  filters: {
    status: commaEnum(RUN_STATUSES),
    runFrom: queryDate('from'),
    runTo: queryDate('to'),
    triggeredById: queryPositiveInt,
  },
}).omit({ search: true });

/** `search` matches the subscription number and the item message. */
export const listBillingRunItemsQuerySchema = buildListQuerySchema({
  sortable: ['id', 'status'] as const,
  defaultSort: 'id',
  filters: {
    status: commaEnum(ITEM_STATUSES),
    subscriptionId: queryPositiveInt,
  },
});

export type CreateBillingRunInput = z.infer<typeof createBillingRunSchema>;
export type ListBillingRunsParams = z.infer<typeof listBillingRunsQuerySchema>;
export type ListBillingRunItemsParams = z.infer<typeof listBillingRunItemsQuerySchema>;

export type CreateBillingRunCheck = AssertAssignable<z.input<typeof createBillingRunSchema>, CreateBillingRunRequest>;
export type ListBillingRunsCheck = AssertAssignable<
  Pick<ListBillingRunsParams, 'sortBy' | 'triggeredById'>,
  Pick<ListBillingRunsQuery, 'sortBy' | 'triggeredById'>
>;
export type ListBillingRunItemsCheck = AssertAssignable<
  Pick<ListBillingRunItemsParams, 'sortBy' | 'status' | 'subscriptionId'>,
  Pick<ListBillingRunItemsQuery, 'sortBy' | 'status' | 'subscriptionId'>
>;
