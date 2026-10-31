import type { DateInput, IsoDateTime, ListQuery } from './common.js';
import type { BillingRunItemStatus, BillingRunStatus } from './enums.js';
export interface BillingRunDto {
  id: number;
  runDate: IsoDateTime;
  status: BillingRunStatus;
  triggeredById: number | null;
  triggeredByName: string | null;
  /** Count of due subscriptions, NOT a monetary amount. */
  totalDue: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
}
export interface BillingRunItemDto {
  id: number;
  billingRunId: number;
  subscriptionId: number;
  subscriptionNumber: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  status: BillingRunItemStatus;
  message: string | null;
  createdAt: IsoDateTime;
}
export interface CreateBillingRunRequest { runDate?: DateInput; autoConfirm?: boolean; subscriptionIds?: number[] }
export interface ListBillingRunsQuery extends ListQuery<'runDate' | 'startedAt' | 'createdCount' | 'status'> {
  status?: BillingRunStatus[];
  runFrom?: DateInput;
  runTo?: DateInput;
  triggeredById?: number;
}
export interface ListBillingRunItemsQuery extends ListQuery<'id' | 'status'> {
  status?: BillingRunItemStatus[];
  subscriptionId?: number;
}
