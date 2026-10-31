import type { BasisPoints, DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
import type { SubscriptionAction, SubscriptionStatus } from './enums.js';
import type { CustomerRefDto } from './customers.js';
import type { DiscountListItemDto } from './discounts.js';
import type { InvoiceListItemDto } from './invoices.js';
import type { PaymentTermDto } from './payment-terms.js';
import type { PlanRefDto } from './plans.js';
export interface SubscriptionLineInput {
  productId: number;
  variantId?: number | null;
  /** Missing/null means no tax; prices and tax snapshots are always server-owned. */
  taxId?: number | null;
  description?: string | null;
  quantity: number;
  sortOrder?: number;
}
export interface SubscriptionLineDto {
  id: number;
  subscriptionId: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  taxId: number | null;
  taxName: string | null;
  description: string | null;
  quantity: number;
  unitPrice: Paise;
  /** Stored snapshot; fixed taxes are represented by taxAmount, not a percentage. */
  taxRate: BasisPoints;
  taxAmount: Paise;
  amount: Paise;
  sortOrder: number;
}
export interface SubscriptionStatusHistoryDto {
  id: number;
  subscriptionId: number;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  changedById: number | null;
  changedByName: string | null;
  reason: string | null;
  createdAt: IsoDateTime;
}
export interface SubscriptionListItemDto {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  planId: number;
  planName: string;
  templateId: number | null;
  paymentTermId: number | null;
  status: SubscriptionStatus;
  startDate: IsoDateTime;
  expiryDate: IsoDateTime | null;
  quotationValidUntil: IsoDateTime | null;
  nextBillingDate: IsoDateTime | null;
  lastBilledUntil: IsoDateTime | null;
  confirmedAt: IsoDateTime | null;
  activatedAt: IsoDateTime | null;
  pausedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
  closeReason: string | null;
  renewedFromId: number | null;
  subtotal: Paise;
  taxTotal: Paise;
  total: Paise;
  recurringAmount: Paise;
  notes: string | null;
  createdById: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  allowedActions: SubscriptionAction[];
  lines?: SubscriptionLineDto[];
}
export interface SubscriptionDto extends SubscriptionListItemDto {
  customer: CustomerRefDto;
  plan: PlanRefDto;
  paymentTerm: PaymentTermDto | null;
  lines: SubscriptionLineDto[];
  statusHistory: SubscriptionStatusHistoryDto[];
  discounts: DiscountListItemDto[];
  /** Most recent five; use the invoice list endpoint for the full history. */
  invoices: InvoiceListItemDto[];
}
export interface CreateSubscriptionRequest {
  customerId: number;
  planId: number;
  startDate: DateInput;
  expiryDate?: DateInput | null;
  paymentTermId?: number | null;
  notes?: string | null;
  lines: SubscriptionLineInput[];
}
export interface CreateSubscriptionFromTemplateRequest {
  templateId: number;
  customerId: number;
  startDate: DateInput;
  expiryDate?: DateInput | null;
  paymentTermId?: number | null;
  notes?: string | null;
}
/** Header/line edits require DRAFT or QUOTATION; other states allow notes/paymentTermId only. */
export interface UpdateSubscriptionRequest {
  customerId?: number;
  planId?: number;
  startDate?: DateInput;
  expiryDate?: DateInput | null;
  paymentTermId?: number | null;
  notes?: string | null;
  /** Replaces all lines and recalculates server-owned prices and totals. */
  lines?: SubscriptionLineInput[];
}
export interface CloseSubscriptionRequest { reason: string }
/** Renewal dates/lines are derived by the server. No client-owned overrides. */
export type RenewSubscriptionRequest = Record<string, never>;
export interface ListSubscriptionsQuery extends ListQuery<'number' | 'startDate' | 'expiryDate' | 'nextBillingDate' | 'total' | 'status' | 'createdAt'> {
  status?: SubscriptionStatus[];
  customerId?: number;
  planId?: number;
  templateId?: number;
  startFrom?: DateInput;
  startTo?: DateInput;
  expiryFrom?: DateInput;
  expiryTo?: DateInput;
  nextBillingFrom?: DateInput;
  nextBillingTo?: DateInput;
  createdFrom?: DateInput;
  createdTo?: DateInput;
  dueForBilling?: boolean;
  expiringWithinDays?: number;
  include?: 'lines'[];
}
