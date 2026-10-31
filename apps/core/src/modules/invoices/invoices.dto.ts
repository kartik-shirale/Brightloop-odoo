import {
  InvoiceAction, InvoiceStatus, TaxType,
  type DiscountUsageDto, type InvoiceCompanyDto, type InvoiceDto, type InvoiceLineDto, type InvoiceLineSnapshotDto,
  type InvoiceListItemDto, type InvoicePreviewDto, type InvoicePrintDto, type InvoiceTaxSummaryDto, type PaymentDto,
} from '@brightloop/shared';
import { isCustomer, type Actor } from '../../core/utils/actor.js';
import { startOfUtcDay } from '../../core/utils/dates.js';
import { sumPaise } from '../../core/utils/money.js';
import type {
  DiscountUsageRow, DiscountUsageWrite, InvoiceLineRow, InvoiceLineWrite, InvoiceRow, Names, PaymentRow,
} from './invoices.repository.js';

const DAY_MS = 86_400_000;

/** Lines, usages and totals of one invoice, before they are stored or previewed. */
export interface ComputedInvoice {
  lines: InvoiceLineWrite[];
  usages: DiscountUsageWrite[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export interface PreviewParts {
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerTaxId: string | null;
  billingAddress: string | null;
  paymentTermId: number | null;
  paymentTermName: string | null;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issueDate: Date;
  dueDate: Date;
  computed: ComputedInvoice;
}

const isoOf = (value: string): string => new Date(value).toISOString();
const isoOrNull = (value: string | null): string | null => (value === null ? null : isoOf(value));

/** CONFIRMED, money still owed, due date before the business today. Derived, never stored. */
export function isOverdue(row: Pick<InvoiceRow, 'status' | 'amountDue' | 'dueDate'>, today: Date): boolean {
  return row.status === InvoiceStatus.CONFIRMED
    && row.amountDue > 0
    && startOfUtcDay(new Date(row.dueDate)).getTime() < today.getTime();
}

export function daysOverdue(row: Pick<InvoiceRow, 'status' | 'amountDue' | 'dueDate'>, today: Date): number {
  if (!isOverdue(row, today)) return 0;
  return Math.round((today.getTime() - startOfUtcDay(new Date(row.dueDate)).getTime()) / DAY_MS);
}

/** Actions the actor may take now, from the state machine and the role. */
export function allowedActionsFor(row: InvoiceRow, actor: Actor): InvoiceAction[] {
  if (isCustomer(actor)) return [InvoiceAction.PRINT];
  switch (row.status) {
    case InvoiceStatus.DRAFT:
      return [InvoiceAction.EDIT, InvoiceAction.CONFIRM, InvoiceAction.CANCEL, InvoiceAction.PRINT];
    case InvoiceStatus.CONFIRMED:
      return [
        ...(row.amountPaid === 0 ? [InvoiceAction.CANCEL] : []),
        InvoiceAction.SEND, InvoiceAction.RECORD_PAYMENT, InvoiceAction.PRINT,
      ];
    case InvoiceStatus.PAID:
      return [InvoiceAction.SEND, InvoiceAction.PRINT];
    case InvoiceStatus.CANCELLED:
      return [InvoiceAction.PRINT];
  }
}

export function toListItemDto(
  row: InvoiceRow,
  subscriptionNumber: string,
  today: Date,
  actor: Actor,
): InvoiceListItemDto {
  return {
    id: row.id,
    number: row.number,
    subscriptionId: row.subscriptionId,
    subscriptionNumber,
    customerId: row.customerId,
    paymentTermId: row.paymentTermId,
    status: row.status,
    currency: row.currency,
    periodStart: isoOf(row.periodStart),
    periodEnd: isoOf(row.periodEnd),
    issueDate: isoOf(row.issueDate),
    dueDate: isoOf(row.dueDate),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerTaxId: row.customerTaxId,
    billingAddress: row.billingAddress,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    total: row.total,
    amountPaid: row.amountPaid,
    amountDue: row.amountDue,
    confirmedAt: isoOrNull(row.confirmedAt),
    sentAt: isoOrNull(row.sentAt),
    paidAt: isoOrNull(row.paidAt),
    cancelledAt: isoOrNull(row.cancelledAt),
    cancelReason: row.cancelReason,
    notes: row.notes,
    billingRunId: row.billingRunId,
    createdById: row.createdById,
    createdAt: isoOf(row.createdAt),
    updatedAt: isoOf(row.updatedAt),
    isOverdue: isOverdue(row, today),
    daysOverdue: daysOverdue(row, today),
    allowedActions: allowedActionsFor(row, actor),
  };
}

function snapshotOf(line: InvoiceLineWrite, names: Names): InvoiceLineSnapshotDto {
  return {
    productId: line.productId,
    productName: line.productId === null ? null : names.products.get(line.productId) ?? null,
    variantId: line.variantId,
    variantLabel: line.variantId === null ? null : names.variants.get(line.variantId) ?? null,
    taxId: line.taxId,
    taxName: line.taxId === null ? null : names.taxes.get(line.taxId)?.name ?? null,
    discountId: line.discountId,
    discountName: line.discountId === null ? null : names.discounts.get(line.discountId) ?? null,
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

export function toLineSnapshots(lines: readonly InvoiceLineWrite[], names: Names): InvoiceLineSnapshotDto[] {
  return lines.map((line) => snapshotOf(line, names));
}

export function toLineDto(line: InvoiceLineRow, names: Names): InvoiceLineDto {
  return { id: line.id, invoiceId: line.invoiceId, ...snapshotOf(line, names) };
}

export function toPaymentDto(payment: PaymentRow, invoice: InvoiceRow, names: Names): PaymentDto {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    invoiceNumber: invoice.number,
    customerId: payment.customerId,
    customerName: invoice.customerName,
    method: payment.method,
    amount: payment.amount,
    paymentDate: isoOf(payment.paymentDate),
    reference: payment.reference,
    note: payment.note,
    recordedById: payment.recordedById,
    recordedByName: payment.recordedById === null ? null : names.users.get(payment.recordedById) ?? null,
    createdAt: isoOf(payment.createdAt),
    updatedAt: isoOf(payment.updatedAt),
  };
}

export function toUsageDto(usage: DiscountUsageRow, invoice: InvoiceRow, names: Names): DiscountUsageDto {
  return {
    id: usage.id,
    discountId: usage.discountId,
    discountName: names.discounts.get(usage.discountId) ?? '',
    invoiceId: usage.invoiceId,
    invoiceNumber: invoice.number,
    subscriptionId: usage.subscriptionId,
    subscriptionNumber: names.subscriptions.get(usage.subscriptionId) ?? '',
    amount: usage.amount,
    createdAt: isoOf(usage.createdAt),
  };
}

export interface DetailParts {
  lines: InvoiceLineRow[];
  payments: PaymentRow[];
  usages: DiscountUsageRow[];
  names: Names;
}

export function toDetailDto(row: InvoiceRow, parts: DetailParts, today: Date, actor: Actor): InvoiceDto {
  const subscriptionNumber = parts.names.subscriptions.get(row.subscriptionId) ?? '';
  return {
    ...toListItemDto(row, subscriptionNumber, today, actor),
    paymentTermName: row.paymentTermId === null ? null : parts.names.paymentTerms.get(row.paymentTermId) ?? null,
    lines: parts.lines.map((line) => toLineDto(line, parts.names)),
    payments: parts.payments.map((payment) => toPaymentDto(payment, row, parts.names)),
    discountUsages: parts.usages.map((usage) => toUsageDto(usage, row, parts.names)),
  };
}

export function toPreviewDto(parts: PreviewParts, names: Names): InvoicePreviewDto {
  return {
    subscriptionId: parts.subscriptionId,
    subscriptionNumber: parts.subscriptionNumber,
    customerId: parts.customerId,
    customerName: parts.customerName,
    customerEmail: parts.customerEmail,
    customerTaxId: parts.customerTaxId,
    billingAddress: parts.billingAddress,
    paymentTermId: parts.paymentTermId,
    paymentTermName: parts.paymentTermName,
    currency: parts.currency,
    periodStart: parts.periodStart.toISOString(),
    periodEnd: parts.periodEnd.toISOString(),
    issueDate: parts.issueDate.toISOString(),
    dueDate: parts.dueDate.toISOString(),
    subtotal: parts.computed.subtotal,
    discountTotal: parts.computed.discountTotal,
    taxTotal: parts.computed.taxTotal,
    total: parts.computed.total,
    lines: toLineSnapshots(parts.computed.lines, names),
  };
}

/**
 * Taxable base and tax per tax and rate. Lines without a tax are left out. The type comes
 * from the tax's current definition because lines snapshot only the rate.
 */
export function buildTaxSummary(lines: readonly InvoiceLineRow[], names: Names): InvoiceTaxSummaryDto[] {
  const groups = new Map<string, { taxId: number; rate: number; amounts: number[]; taxes: number[] }>();
  for (const line of lines) {
    if (line.taxId === null) continue;
    const key = `${line.taxId}:${line.taxRate}`;
    const group = groups.get(key) ?? { taxId: line.taxId, rate: line.taxRate, amounts: [], taxes: [] };
    group.amounts.push(line.amount);
    group.taxes.push(line.taxAmount);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group): InvoiceTaxSummaryDto => {
      const tax = names.taxes.get(group.taxId);
      return {
        taxName: tax?.name ?? null,
        type: tax?.type ?? TaxType.PERCENTAGE,
        rate: group.rate,
        taxableAmount: sumPaise(group.amounts),
        taxAmount: sumPaise(group.taxes),
      };
    })
    .sort((a, b) => a.rate - b.rate || (a.taxName ?? '').localeCompare(b.taxName ?? ''));
}

export function toPrintDto(
  row: InvoiceRow,
  parts: DetailParts,
  subscriptionNumber: string,
  company: InvoiceCompanyDto,
): InvoicePrintDto {
  const snapshots = toLineSnapshots(parts.lines, parts.names);
  return {
    company,
    number: row.number,
    subscriptionNumber,
    status: row.status,
    currency: row.currency,
    issueDate: isoOf(row.issueDate),
    dueDate: isoOf(row.dueDate),
    periodStart: isoOf(row.periodStart),
    periodEnd: isoOf(row.periodEnd),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerTaxId: row.customerTaxId,
    billingAddress: row.billingAddress,
    paymentTermName: row.paymentTermId === null ? null : parts.names.paymentTerms.get(row.paymentTermId) ?? null,
    lines: snapshots,
    taxSummary: buildTaxSummary(parts.lines, parts.names),
    payments: parts.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      paymentDate: isoOf(payment.paymentDate),
      reference: payment.reference,
    })),
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    total: row.total,
    amountPaid: row.amountPaid,
    amountDue: row.amountDue,
  };
}
