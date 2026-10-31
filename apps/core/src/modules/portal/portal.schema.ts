import {
  InvoiceStatus, PaymentMethod, SubscriptionStatus,
  type PortalCloseSubscriptionRequest, type UpdatePortalProfileRequest,
} from '@brightloop/shared';
import { z } from 'zod';
import {
  buildListQuerySchema, commaEnum, queryBoolean, queryDate, queryPositiveInt,
} from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

/** DRAFT is never visible to a customer, so it is not even a valid filter value. */
export const PORTAL_SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.QUOTATION, SubscriptionStatus.CONFIRMED, SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAUSED, SubscriptionStatus.CLOSED,
] as const;

/** DRAFT and CANCELLED invoices are never visible to a customer. */
export const PORTAL_INVOICE_STATUSES = [InvoiceStatus.CONFIRMED, InvoiceStatus.PAID] as const;

const PAYMENT_METHODS = [
  PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER, PaymentMethod.CARD, PaymentMethod.UPI,
  PaymentMethod.CHEQUE, PaymentMethod.ONLINE, PaymentMethod.OTHER,
] as const;

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

/** `email` and `notes` are deliberately absent: the strict schema rejects them with a 400. */
export const updatePortalProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(150).optional(),
    companyName: optionalText(150),
    phone: optionalText(30),
    taxId: optionalText(50),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(100),
    state: optionalText(100),
    postalCode: optionalText(20),
    country: optionalText(100),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

/** The reason is optional for a customer. A missing body is treated as `{}`. */
export const portalCloseSubscriptionSchema = z.preprocess(
  (value) => value ?? {},
  z.strictObject({ reason: z.string().trim().min(1).max(500).optional() }),
);

/** Renew takes no overrides. A missing body is treated as `{}`. */
export const portalRenewSubscriptionSchema = z.preprocess((value) => value ?? {}, z.strictObject({}));

/** `search` matches the subscription number. */
export const listPortalSubscriptionsQuerySchema = buildListQuerySchema({
  sortable: ['startDate', 'expiryDate', 'nextBillingDate', 'status', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    status: commaEnum(PORTAL_SUBSCRIPTION_STATUSES),
    planId: queryPositiveInt,
  },
});

/** `search` matches the invoice number. */
export const listPortalInvoicesQuerySchema = buildListQuerySchema({
  sortable: ['issueDate', 'dueDate', 'total', 'amountDue'] as const,
  defaultSort: 'issueDate',
  filters: {
    status: commaEnum(PORTAL_INVOICE_STATUSES),
    overdue: queryBoolean,
    outstanding: queryBoolean,
    subscriptionId: queryPositiveInt,
    issueFrom: queryDate('from'),
    issueTo: queryDate('to'),
    dueFrom: queryDate('from'),
    dueTo: queryDate('to'),
  },
});

/** No `search`: the staff payment search covers internal notes, which a customer must not probe. */
export const listPortalPaymentsQuerySchema = buildListQuerySchema({
  sortable: ['paymentDate', 'amount'] as const,
  defaultSort: 'paymentDate',
  filters: {
    invoiceId: queryPositiveInt,
    method: commaEnum(PAYMENT_METHODS),
    paidFrom: queryDate('from'),
    paidTo: queryDate('to'),
  },
})
  .omit({ search: true })
  .superRefine((value, ctx) => {
    if (value.paidFrom !== undefined && value.paidTo !== undefined && value.paidFrom.getTime() > value.paidTo.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['paidFrom'], message: 'paidFrom must not be after paidTo' });
    }
  });

export type UpdatePortalProfileInput = z.infer<typeof updatePortalProfileSchema>;
export type PortalCloseSubscriptionInput = z.infer<typeof portalCloseSubscriptionSchema>;
export type ListPortalSubscriptionsParams = z.infer<typeof listPortalSubscriptionsQuerySchema>;
export type ListPortalInvoicesParams = z.infer<typeof listPortalInvoicesQuerySchema>;
export type ListPortalPaymentsParams = z.infer<typeof listPortalPaymentsQuerySchema>;

export type UpdatePortalProfileCheck = AssertAssignable<z.input<typeof updatePortalProfileSchema>, UpdatePortalProfileRequest>;
export type PortalCloseSubscriptionCheck = AssertAssignable<PortalCloseSubscriptionInput, PortalCloseSubscriptionRequest>;
