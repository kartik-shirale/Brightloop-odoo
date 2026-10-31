/**
 * Portal projections. Every mapper is an explicit allowlist built from the staff DTO the
 * owning service returned, so a field added to a staff DTO never reaches a customer by
 * accident. Internal fields (notes, createdById, billingRunId, recordedBy, cancel data,
 * customer and term ids, cost data) are never copied.
 */

import {
  InvoiceStatus, SubscriptionAction, SubscriptionStatus,
  type InvoiceDto, type InvoiceLineDto, type InvoiceLineSnapshotDto, type InvoiceListItemDto, type InvoicePrintDto,
  type PaymentListItemDto, type PortalInvoiceDto, type PortalInvoiceLineDto,
  type PortalInvoiceListItemDto, type PortalInvoicePrintDto, type PortalInvoiceStatus, type PortalPaymentDto,
  type PortalProfileDto, type PortalSubscriptionAction, type PortalSubscriptionDto, type PortalSubscriptionLineDto,
  type PortalSubscriptionListItemDto, type PortalSubscriptionStatus, type PortalSummaryDto,
  type SubscriptionDto, type SubscriptionLineDto,
  type SubscriptionListItemDto,
} from '@brightloop/shared';
import { notFound } from '../../core/errors.js';
import type { CustomerRecord } from '../customers/customers.gateway.js';
import type { PortalSummaryRow } from './portal.repository.js';

const PORTAL_ACTIONS: readonly SubscriptionAction[] = [
  SubscriptionAction.PAUSE, SubscriptionAction.RESUME, SubscriptionAction.CLOSE, SubscriptionAction.RENEW,
];

const isPortalAction = (action: SubscriptionAction): action is PortalSubscriptionAction =>
  PORTAL_ACTIONS.includes(action);

/** Defence in depth: the services already hide these rows, so reaching here means "not found". */
export function portalSubscriptionStatus(status: SubscriptionStatus): PortalSubscriptionStatus {
  if (status === SubscriptionStatus.DRAFT) throw notFound('Subscription not found');
  return status;
}

export function portalInvoiceStatus(status: InvoiceStatus): PortalInvoiceStatus {
  if (status === InvoiceStatus.CONFIRMED || status === InvoiceStatus.PAID) return status;
  throw notFound('Invoice not found');
}

export function toPortalProfileDto(customer: CustomerRecord, accountEmail: string): PortalProfileDto {
  return {
    id: customer.id,
    name: customer.name,
    companyName: customer.companyName,
    email: accountEmail,
    phone: customer.phone,
    taxId: customer.taxId,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    city: customer.city,
    state: customer.state,
    postalCode: customer.postalCode,
    country: customer.country,
  };
}

export function toPortalSummaryDto(row: PortalSummaryRow): PortalSummaryDto {
  return {
    activeSubscriptions: row.activeSubscriptions,
    nextBillingDate: row.nextBillingDate === null ? null : new Date(row.nextBillingDate).toISOString(),
    outstandingAmount: row.outstandingAmount,
    overdueCount: row.overdueCount,
    overdueAmount: row.overdueAmount,
  };
}

export function toPortalSubscriptionListItemDto(dto: SubscriptionListItemDto): PortalSubscriptionListItemDto {
  return {
    id: dto.id,
    number: dto.number,
    planId: dto.planId,
    planName: dto.planName,
    status: portalSubscriptionStatus(dto.status),
    startDate: dto.startDate,
    expiryDate: dto.expiryDate,
    quotationValidUntil: dto.quotationValidUntil,
    nextBillingDate: dto.nextBillingDate,
    subtotal: dto.subtotal,
    taxTotal: dto.taxTotal,
    total: dto.total,
    recurringAmount: dto.recurringAmount,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    allowedActions: dto.allowedActions.filter(isPortalAction),
  };
}

function toPortalSubscriptionLineDto(line: SubscriptionLineDto): PortalSubscriptionLineDto {
  return {
    id: line.id,
    productName: line.productName,
    variantLabel: line.variantLabel,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxName: line.taxName,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    amount: line.amount,
    sortOrder: line.sortOrder,
  };
}

export function toPortalSubscriptionDto(
  dto: SubscriptionDto,
  invoices: PortalInvoiceListItemDto[],
): PortalSubscriptionDto {
  return {
    ...toPortalSubscriptionListItemDto(dto),
    paymentTermName: dto.paymentTerm?.name ?? null,
    lines: dto.lines.map(toPortalSubscriptionLineDto),
    invoices,
  };
}

export function toPortalInvoiceListItemDto(dto: InvoiceListItemDto): PortalInvoiceListItemDto {
  return {
    id: dto.id,
    number: dto.number,
    subscriptionId: dto.subscriptionId,
    subscriptionNumber: dto.subscriptionNumber,
    status: portalInvoiceStatus(dto.status),
    currency: dto.currency,
    issueDate: dto.issueDate,
    dueDate: dto.dueDate,
    periodStart: dto.periodStart,
    periodEnd: dto.periodEnd,
    subtotal: dto.subtotal,
    discountTotal: dto.discountTotal,
    taxTotal: dto.taxTotal,
    total: dto.total,
    amountPaid: dto.amountPaid,
    amountDue: dto.amountDue,
    isOverdue: dto.isOverdue,
    daysOverdue: dto.daysOverdue,
  };
}

function toPortalInvoiceLineDto(line: InvoiceLineDto): PortalInvoiceLineDto {
  return {
    id: line.id,
    description: line.description,
    productName: line.productName,
    variantLabel: line.variantLabel,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxName: line.taxName,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    amount: line.amount,
    sortOrder: line.sortOrder,
  };
}

export function toPortalPaymentDto(dto: PaymentListItemDto): PortalPaymentDto {
  return {
    id: dto.id,
    invoiceId: dto.invoiceId,
    invoiceNumber: dto.invoiceNumber,
    method: dto.method,
    amount: dto.amount,
    paymentDate: dto.paymentDate,
    reference: dto.reference,
  };
}

export function toPortalInvoiceDto(dto: InvoiceDto): PortalInvoiceDto {
  return {
    ...toPortalInvoiceListItemDto(dto),
    customerName: dto.customerName,
    customerEmail: dto.customerEmail,
    customerTaxId: dto.customerTaxId,
    billingAddress: dto.billingAddress,
    paymentTermName: dto.paymentTermName,
    confirmedAt: dto.confirmedAt,
    paidAt: dto.paidAt,
    lines: dto.lines.map(toPortalInvoiceLineDto),
    payments: dto.payments.map(toPortalPaymentDto),
  };
}

function toPrintLine(line: InvoiceLineSnapshotDto): InvoiceLineSnapshotDto {
  return {
    productId: line.productId,
    productName: line.productName,
    variantId: line.variantId,
    variantLabel: line.variantLabel,
    taxId: line.taxId,
    taxName: line.taxName,
    discountId: line.discountId,
    discountName: line.discountName,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    amount: line.amount,
    sortOrder: line.sortOrder,
  };
}

/** The print DTO is already a public projection; it is still copied field by field. */
export function toPortalInvoicePrintDto(dto: InvoicePrintDto): PortalInvoicePrintDto {
  return {
    company: { ...dto.company },
    number: dto.number,
    subscriptionNumber: dto.subscriptionNumber,
    status: portalInvoiceStatus(dto.status),
    currency: dto.currency,
    issueDate: dto.issueDate,
    dueDate: dto.dueDate,
    periodStart: dto.periodStart,
    periodEnd: dto.periodEnd,
    customerName: dto.customerName,
    customerEmail: dto.customerEmail,
    customerTaxId: dto.customerTaxId,
    billingAddress: dto.billingAddress,
    paymentTermName: dto.paymentTermName,
    lines: dto.lines.map(toPrintLine),
    taxSummary: dto.taxSummary.map((entry) => ({
      taxName: entry.taxName, type: entry.type, rate: entry.rate,
      taxableAmount: entry.taxableAmount, taxAmount: entry.taxAmount,
    })),
    payments: dto.payments.map((payment) => ({
      method: payment.method, amount: payment.amount, paymentDate: payment.paymentDate, reference: payment.reference,
    })),
    subtotal: dto.subtotal,
    discountTotal: dto.discountTotal,
    taxTotal: dto.taxTotal,
    total: dto.total,
    amountPaid: dto.amountPaid,
    amountDue: dto.amountDue,
  };
}
