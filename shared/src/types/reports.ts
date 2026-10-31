import type { DateInput, DateRange, IsoDateTime, ListQuery, Paise } from './common.js';
import type { PaymentMethod, ReportInterval, SubscriptionStatus } from './enums.js';
export interface ReportSummaryQuery extends DateRange { planId?: number; customerId?: number }
export interface RevenueTimeseriesQuery extends DateRange { interval?: ReportInterval; planId?: number }
export type RevenueByPlanQuery = DateRange;
export type PaymentsSummaryQuery = DateRange;
export interface AgingQuery { customerId?: number }
export interface ReportSummaryDto {
  activeSubscriptions: number;
  subscriptionsByStatus: Record<SubscriptionStatus, number>;
  newSubscriptions: number;
  closedSubscriptions: number;
  invoicedAmount: Paise;
  revenueReceived: Paise;
  outstandingAmount: Paise;
  overdueAmount: Paise;
  overdueCount: number;
  mrr: Paise;
  arr: Paise;
}
export interface RevenueTimeseriesBucketDto { period: IsoDateTime; invoiced: Paise; received: Paise }
/** Non-paginated aggregate arrays are wrapped by ApiSuccess, not ApiListSuccess. */
export type RevenueTimeseriesDto = RevenueTimeseriesBucketDto[];
export interface RevenueByPlanItemDto { planId: number; planName: string; activeSubscriptions: number; mrr: Paise; received: Paise }
export type RevenueByPlanDto = RevenueByPlanItemDto[];
export interface PaymentsSummaryItemDto { method: PaymentMethod; count: number; amount: Paise }
export interface PaymentsSummaryDto { byMethod: PaymentsSummaryItemDto[]; total: Paise }
export interface OverdueInvoiceDto {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  subscriptionId: number;
  subscriptionNumber: string;
  dueDate: IsoDateTime;
  total: Paise;
  amountPaid: Paise;
  amountDue: Paise;
  daysOverdue: number;
}
export interface ListOverdueInvoicesQuery extends ListQuery<'daysOverdue' | 'amountDue' | 'dueDate'> {
  customerId?: number;
  subscriptionId?: number;
  minDaysOverdue?: number;
  minAmount?: Paise;
  dueFrom?: DateInput;
  dueTo?: DateInput;
}
export interface AgingBucketDto { count: number; amount: Paise }
export interface AgingDto {
  notDue: AgingBucketDto;
  days1To30: AgingBucketDto;
  days31To60: AgingBucketDto;
  days61To90: AgingBucketDto;
  over90: AgingBucketDto;
}
export interface ExpiringSubscriptionDto {
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  planId: number;
  planName: string;
  status: 'ACTIVE';
  expiryDate: IsoDateTime;
  nextBillingDate: IsoDateTime | null;
  recurringAmount: Paise;
  autoClose: boolean;
}
export interface ListExpiringSubscriptionsQuery extends ListQuery<'expiryDate'> {
  withinDays?: number;
  planId?: number;
  customerId?: number;
}
