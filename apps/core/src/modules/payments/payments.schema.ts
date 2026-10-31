import { PaymentMethod, type CreatePaymentRequest, type UpdatePaymentRequest } from '@brightloop/shared';
import { z } from 'zod';
import { parseDateInput, startOfUtcDay } from '../../core/utils/dates.js';
import {
  buildListQuerySchema, commaEnum, queryDate, queryPaise, queryPositiveInt,
} from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const PAYMENT_METHODS = [
  PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER, PaymentMethod.CARD, PaymentMethod.UPI,
  PaymentMethod.CHEQUE, PaymentMethod.ONLINE, PaymentMethod.OTHER,
] as const;
const MAX_INT4 = 2147483647;

const referenceField = z.string().trim().min(1).max(120).nullable();
const noteField = z.string().trim().min(1).max(1000).nullable();

/** A calendar date (or instant) normalized to UTC midnight of that date. */
const dateField = z.string().transform((raw, ctx): Date => {
  const parsed = parseDateInput(raw);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected an ISO 8601 date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return startOfUtcDay(parsed);
});

export const createPaymentSchema = z.strictObject({
  invoiceId: z.number().int().min(1).max(MAX_INT4),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().min(1).max(MAX_INT4),
  paymentDate: dateField,
  reference: referenceField.optional(),
  note: noteField.optional(),
});

/** Amount, date and invoice are immutable: the strict object rejects them with a 400. */
export const updatePaymentSchema = z
  .strictObject({
    reference: referenceField.optional(),
    note: noteField.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide reference or note to update' });
    }
  });

export const listPaymentsQuerySchema = buildListQuerySchema({
  sortable: ['paymentDate', 'amount', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    invoiceId: queryPositiveInt,
    customerId: queryPositiveInt,
    method: commaEnum(PAYMENT_METHODS),
    paidFrom: queryDate('from'),
    paidTo: queryDate('to'),
    minAmount: queryPaise,
    maxAmount: queryPaise,
  },
}).superRefine((value, ctx) => {
  if (value.minAmount !== undefined && value.maxAmount !== undefined && value.minAmount > value.maxAmount) {
    ctx.addIssue({ code: 'custom', path: ['minAmount'], message: 'minAmount must not exceed maxAmount' });
  }
  if (value.paidFrom !== undefined && value.paidTo !== undefined && value.paidFrom.getTime() > value.paidTo.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['paidFrom'], message: 'paidFrom must not be after paidTo' });
  }
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type ListPaymentsParams = z.infer<typeof listPaymentsQuerySchema>;

export type CreatePaymentCheck = AssertAssignable<z.input<typeof createPaymentSchema>, CreatePaymentRequest>;
export type UpdatePaymentCheck = AssertAssignable<z.input<typeof updatePaymentSchema>, UpdatePaymentRequest>;
