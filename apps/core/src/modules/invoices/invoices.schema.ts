import {
  InvoiceStatus,
  type CancelInvoiceRequest,
  type GenerateInvoiceRequest,
  type UpdateInvoiceRequest,
} from '@brightloop/shared';
import { z } from 'zod';
import { isDateOnly, parseDateInput, startOfUtcDay } from '../../core/utils/dates.js';
import {
  buildListQuerySchema, commaEnum, queryBoolean, queryDate, queryPaise, queryPositiveInt,
} from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const STATUSES = [
  InvoiceStatus.DRAFT, InvoiceStatus.CONFIRMED, InvoiceStatus.PAID, InvoiceStatus.CANCELLED,
] as const;
const MAX_INT4 = 2147483647;

/** A calendar date (or instant) normalized to UTC midnight of that date. */
const dateField = z.string().transform((raw, ctx): Date => {
  const parsed = parseDateInput(raw);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected an ISO 8601 date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return startOfUtcDay(parsed);
});

/** Date-only (`YYYY-MM-DD`) business date. The "not in the future" rule needs the clock, so the service checks it. */
const asOfField = z.string().transform((raw, ctx): Date => {
  const parsed = isDateOnly(raw) ? parseDateInput(raw) : null;
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected a calendar date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return parsed;
});

export const generateInvoiceSchema = z.strictObject({
  subscriptionId: z.number().int().min(1).max(MAX_INT4),
  asOf: asOfField.optional(),
  autoConfirm: z.boolean().optional(),
});

export const updateInvoiceSchema = z
  .strictObject({
    notes: z.string().trim().max(2000).nullable().optional(),
    dueDate: dateField.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

export const cancelInvoiceSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export const previewInvoiceQuerySchema = z.strictObject({
  subscriptionId: queryPositiveInt,
});

export const listInvoicesQuerySchema = buildListQuerySchema({
  sortable: ['number', 'issueDate', 'dueDate', 'total', 'amountDue', 'status', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    status: commaEnum(STATUSES),
    customerId: queryPositiveInt,
    subscriptionId: queryPositiveInt,
    issueFrom: queryDate('from'),
    issueTo: queryDate('to'),
    dueFrom: queryDate('from'),
    dueTo: queryDate('to'),
    overdue: queryBoolean,
    outstanding: queryBoolean,
    billingRunId: queryPositiveInt,
    minTotal: queryPaise,
    maxTotal: queryPaise,
  },
});

export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;
export type PreviewInvoiceParams = z.infer<typeof previewInvoiceQuerySchema>;
export type ListInvoicesParams = z.infer<typeof listInvoicesQuerySchema>;

export type GenerateInvoiceCheck = AssertAssignable<z.input<typeof generateInvoiceSchema>, GenerateInvoiceRequest>;
export type UpdateInvoiceCheck = AssertAssignable<z.input<typeof updateInvoiceSchema>, UpdateInvoiceRequest>;
export type CancelInvoiceCheck = AssertAssignable<z.input<typeof cancelInvoiceSchema>, CancelInvoiceRequest>;
