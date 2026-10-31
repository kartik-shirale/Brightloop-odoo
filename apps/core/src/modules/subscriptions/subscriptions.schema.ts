import {
  SubscriptionStatus,
  type CloseSubscriptionRequest,
  type CreateSubscriptionFromTemplateRequest,
  type CreateSubscriptionRequest,
  type UpdateSubscriptionRequest,
} from '@brightloop/shared';
import { z } from 'zod';
import { parseDateInput, startOfUtcDay } from '../../core/utils/dates.js';
import {
  buildListQuerySchema, commaEnum, includeList, queryBoolean, queryDate, queryPositiveInt,
} from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const STATUSES = [
  SubscriptionStatus.DRAFT, SubscriptionStatus.QUOTATION, SubscriptionStatus.CONFIRMED,
  SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED, SubscriptionStatus.CLOSED,
] as const;
const MAX_INT4 = 2147483647;
const MAX_LINES = 100;

const idField = z.number().int().min(1).max(MAX_INT4);
const notesField = z.string().trim().max(2000).nullable();

/** A calendar date (or instant) normalized to UTC midnight of that date. */
const dateField = z.string().transform((raw, ctx): Date => {
  const parsed = parseDateInput(raw);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected an ISO 8601 date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return startOfUtcDay(parsed);
});

/** Prices and tax snapshots are server-owned: `unitPrice` and `taxRate` are rejected by the strict object. */
const lineSchema = z.strictObject({
  productId: idField,
  variantId: idField.nullable().optional(),
  taxId: idField.nullable().optional(),
  description: z.string().trim().min(1).max(500).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_INT4),
  /** Accepted for contract compatibility; the stored order always follows the array index. */
  sortOrder: z.number().int().min(0).max(MAX_INT4).optional(),
});

const linesField = z.array(lineSchema).max(MAX_LINES);

export const EXPIRY_PROBLEM = 'expiryDate must be after startDate';

/** Returns a message when the dates are inconsistent, otherwise null. Shared by the schema and the service. */
export function expiryProblem(startDate: Date, expiryDate: Date | null): string | null {
  return expiryDate !== null && expiryDate.getTime() <= startDate.getTime() ? EXPIRY_PROBLEM : null;
}

export const createSubscriptionSchema = z
  .strictObject({
    customerId: idField,
    planId: idField,
    startDate: dateField,
    expiryDate: dateField.nullable().optional(),
    paymentTermId: idField.nullable().optional(),
    notes: notesField.optional(),
    lines: linesField,
  })
  .superRefine((value, ctx) => {
    const problem = expiryProblem(value.startDate, value.expiryDate ?? null);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: problem });
  });

export const createFromTemplateSchema = z
  .strictObject({
    templateId: idField,
    customerId: idField,
    startDate: dateField,
    expiryDate: dateField.nullable().optional(),
    paymentTermId: idField.nullable().optional(),
    notes: notesField.optional(),
  })
  .superRefine((value, ctx) => {
    const problem = expiryProblem(value.startDate, value.expiryDate ?? null);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: problem });
  });

export const updateSubscriptionSchema = z
  .strictObject({
    planId: idField.optional(),
    startDate: dateField.optional(),
    expiryDate: dateField.nullable().optional(),
    paymentTermId: idField.nullable().optional(),
    notes: notesField.optional(),
    lines: linesField.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
    if (value.startDate !== undefined && value.expiryDate !== undefined) {
      const problem = expiryProblem(value.startDate, value.expiryDate);
      if (problem !== null) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: problem });
    }
  });

export const closeSubscriptionSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

/** Renew takes no overrides. A missing body is treated as `{}`. */
export const renewSubscriptionSchema = z.preprocess((value) => value ?? {}, z.strictObject({}));

export const listSubscriptionsQuerySchema = buildListQuerySchema({
  sortable: ['number', 'startDate', 'expiryDate', 'nextBillingDate', 'total', 'status', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    status: commaEnum(STATUSES),
    customerId: queryPositiveInt,
    planId: queryPositiveInt,
    templateId: queryPositiveInt,
    startFrom: queryDate('from'),
    startTo: queryDate('to'),
    expiryFrom: queryDate('from'),
    expiryTo: queryDate('to'),
    nextBillingFrom: queryDate('from'),
    nextBillingTo: queryDate('to'),
    createdFrom: queryDate('from'),
    createdTo: queryDate('to'),
    dueForBilling: queryBoolean,
    expiringWithinDays: z.coerce.number().int().min(1).max(365),
    include: includeList(['lines'] as const),
  },
});

export type SubscriptionLineInput = z.infer<typeof lineSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type CreateFromTemplateInput = z.infer<typeof createFromTemplateSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type CloseSubscriptionInput = z.infer<typeof closeSubscriptionSchema>;
export type ListSubscriptionsParams = z.infer<typeof listSubscriptionsQuerySchema>;

export type CreateSubscriptionCheck = AssertAssignable<z.input<typeof createSubscriptionSchema>, CreateSubscriptionRequest>;
export type CreateFromTemplateCheck = AssertAssignable<z.input<typeof createFromTemplateSchema>, CreateSubscriptionFromTemplateRequest>;
export type UpdateSubscriptionCheck = AssertAssignable<z.input<typeof updateSubscriptionSchema>, UpdateSubscriptionRequest>;
export type CloseSubscriptionCheck = AssertAssignable<z.input<typeof closeSubscriptionSchema>, CloseSubscriptionRequest>;
