import type { BasisPoints, DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
import type { InvoiceAction, InvoiceStatus, PaymentMethod, TaxType } from './enums.js';
import type { DiscountUsageDto } from './discounts.js';
import type { PaymentDto } from './payments.js';
/** Frozen financial line; reusable in previews/print without database identifiers. */
export interface InvoiceLineSnapshotDto {
  productId: number | null;
  productName: string | null;
  variantId: number | null;
  variantLabel: string | null;
  taxId: number | null;
  taxName: string | null;
  discountId: number | null;
  discountName: string | null;
  description: string;
  quantity: number;
  unitPrice: Paise;
  discountAmount: Paise;
  taxRate: BasisPoints;
  taxAmount: Paise;
  /** After discount, before tax. */
  amount: Paise;
  sortOrder: number;
}
export interface InvoiceLineDto extends InvoiceLineSnapshotDto { id: number; invoiceId: number }
export interface InvoiceTotalsDto {
  subtotal: Paise;
  discountTotal: Paise;
  taxTotal: Paise;
  total: Paise;
}
export interface InvoiceListItemDto extends InvoiceTotalsDto {
  id: number;
  number: string;
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  paymentTermId: number | null;
  status: InvoiceStatus;
  currency: string;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  issueDate: IsoDateTime;
  dueDate: IsoDateTime;
  customerName: string;
  customerEmail: string;
  customerTaxId: string | null;
  billingAddress: string | null;
  amountPaid: Paise;
  amountDue: Paise;
  confirmedAt: IsoDateTime | null;
  sentAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  cancelReason: string | null;
  notes: string | null;
  billingRunId: number | null;
  createdById: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isOverdue: boolean;
  daysOverdue: number;
  allowedActions: InvoiceAction[];
}
export interface InvoiceDto extends InvoiceListItemDto {
  paymentTermName: string | null;
  lines: InvoiceLineDto[];
  payments: PaymentDto[];
  discountUsages: DiscountUsageDto[];
}
/** Computation only: no saved invoice id/number or workflow state. */
export interface InvoicePreviewDto extends InvoiceTotalsDto {
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
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  issueDate: IsoDateTime;
  dueDate: IsoDateTime;
  lines: InvoiceLineSnapshotDto[];
}
export interface InvoiceCompanyDto {
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  logoUrl: string | null;
}
export interface InvoiceTaxSummaryDto {
  taxName: string | null;
  type: TaxType;
  /** PERCENTAGE: basis points; FIXED: paise per unit. */
  rate: BasisPoints | Paise;
  taxableAmount: Paise;
  taxAmount: Paise;
}
export interface InvoicePrintPaymentDto {
  method: PaymentMethod;
  amount: Paise;
  paymentDate: IsoDateTime;
  reference: string | null;
}
/** Public printable projection. Deliberately excludes staff notes and audit identifiers. */
export interface InvoicePrintDto extends InvoiceTotalsDto {
  company: InvoiceCompanyDto;
  number: string;
  subscriptionNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: IsoDateTime;
  dueDate: IsoDateTime;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  customerName: string;
  customerEmail: string;
  customerTaxId: string | null;
  billingAddress: string | null;
  paymentTermName: string | null;
  lines: InvoiceLineSnapshotDto[];
  taxSummary: InvoiceTaxSummaryDto[];
  payments: InvoicePrintPaymentDto[];
  amountPaid: Paise;
  amountDue: Paise;
}
export interface GenerateInvoiceRequest { subscriptionId: number; asOf?: DateInput; autoConfirm?: boolean }
export interface PreviewInvoiceQuery { subscriptionId: number }
export interface UpdateInvoiceRequest { notes?: string | null; dueDate?: DateInput }
export interface CancelInvoiceRequest { reason: string }
export interface ListInvoicesQuery extends ListQuery<'number' | 'issueDate' | 'dueDate' | 'total' | 'amountDue' | 'status' | 'createdAt'> {
  status?: InvoiceStatus[];
  customerId?: number;
  subscriptionId?: number;
  issueFrom?: DateInput;
  issueTo?: DateInput;
  dueFrom?: DateInput;
  dueTo?: DateInput;
  overdue?: boolean;
  outstanding?: boolean;
  billingRunId?: number;
  minTotal?: Paise;
  maxTotal?: Paise;
}
