import type { AddressDto, AddressInput, BasisPoints, DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
import type { InvoiceStatus, PaymentMethod, SubscriptionAction, SubscriptionStatus } from './enums.js';
import type { InvoicePrintDto } from './invoices.js';
export type PortalSubscriptionStatus = Exclude<SubscriptionStatus, 'DRAFT'>;
export type PortalInvoiceStatus = Extract<InvoiceStatus, 'CONFIRMED' | 'PAID'>;
export type PortalSubscriptionAction = Extract<SubscriptionAction, 'PAUSE' | 'RESUME' | 'CLOSE' | 'RENEW'>;
/** Explicit allowlist: never derive portal projections by omitting private staff fields. */
export interface PortalProfileDto extends AddressDto {
  id: number;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  taxId: string | null;
}
export interface UpdatePortalProfileRequest extends AddressInput {
  name?: string;
  companyName?: string | null;
  phone?: string | null;
  taxId?: string | null;
}
export interface PortalSummaryDto {
  activeSubscriptions: number;
  nextBillingDate: IsoDateTime | null;
  outstandingAmount: Paise;
  overdueCount: number;
  overdueAmount: Paise;
}
export interface PortalSubscriptionListItemDto {
  id: number;
  number: string;
  planId: number;
  planName: string;
  status: PortalSubscriptionStatus;
  startDate: IsoDateTime;
  expiryDate: IsoDateTime | null;
  quotationValidUntil: IsoDateTime | null;
  nextBillingDate: IsoDateTime | null;
  subtotal: Paise;
  taxTotal: Paise;
  total: Paise;
  recurringAmount: Paise;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  allowedActions: PortalSubscriptionAction[];
}
export interface PortalSubscriptionLineDto {
  id: number;
  productName: string;
  variantLabel: string | null;
  description: string | null;
  quantity: number;
  unitPrice: Paise;
  taxName: string | null;
  taxRate: BasisPoints;
  taxAmount: Paise;
  amount: Paise;
  sortOrder: number;
}
export interface PortalSubscriptionDto extends PortalSubscriptionListItemDto {
  paymentTermName: string | null;
  lines: PortalSubscriptionLineDto[];
  invoices: PortalInvoiceListItemDto[];
}
export interface PortalInvoiceListItemDto {
  id: number;
  number: string;
  subscriptionId: number;
  subscriptionNumber: string;
  status: PortalInvoiceStatus;
  currency: string;
  issueDate: IsoDateTime;
  dueDate: IsoDateTime;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  subtotal: Paise;
  discountTotal: Paise;
  taxTotal: Paise;
  total: Paise;
  amountPaid: Paise;
  amountDue: Paise;
  isOverdue: boolean;
  daysOverdue: number;
}
export interface PortalInvoiceLineDto {
  id: number;
  description: string;
  productName: string | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: Paise;
  discountAmount: Paise;
  taxName: string | null;
  taxRate: BasisPoints;
  taxAmount: Paise;
  amount: Paise;
  sortOrder: number;
}
export interface PortalInvoiceDto extends PortalInvoiceListItemDto {
  customerName: string;
  customerEmail: string;
  customerTaxId: string | null;
  billingAddress: string | null;
  paymentTermName: string | null;
  confirmedAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
  lines: PortalInvoiceLineDto[];
  payments: PortalPaymentDto[];
}
export interface PortalInvoicePrintDto extends InvoicePrintDto { status: PortalInvoiceStatus }
export interface PortalPaymentDto {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  method: PaymentMethod;
  amount: Paise;
  paymentDate: IsoDateTime;
  reference: string | null;
}
export interface PortalCloseSubscriptionRequest { reason?: string }
export type PortalRenewSubscriptionRequest = Record<string, never>;
export interface ListPortalSubscriptionsQuery extends ListQuery<'startDate' | 'expiryDate' | 'nextBillingDate' | 'status' | 'createdAt'> {
  status?: PortalSubscriptionStatus[];
  planId?: number;
}
export interface ListPortalInvoicesQuery extends ListQuery<'issueDate' | 'dueDate' | 'total' | 'amountDue'> {
  status?: PortalInvoiceStatus[];
  overdue?: boolean;
  outstanding?: boolean;
  subscriptionId?: number;
  issueFrom?: DateInput;
  issueTo?: DateInput;
  dueFrom?: DateInput;
  dueTo?: DateInput;
}
export interface ListPortalPaymentsQuery extends ListQuery<'paymentDate' | 'amount'> {
  invoiceId?: number;
  method?: PaymentMethod[];
  paidFrom?: DateInput;
  paidTo?: DateInput;
}
