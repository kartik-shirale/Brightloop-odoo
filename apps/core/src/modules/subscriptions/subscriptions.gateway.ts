import type { BillingPeriod, Paise, SubscriptionStatus, TaxType } from '@brightloop/shared';

export interface BillingSubscriptionLine {
  id: number;
  productId: number;
  variantId: number | null;
  taxId: number | null;
  /** Resolved through TaxesGateway; null when the line has no tax or the tax no longer exists. */
  taxType: TaxType | null;
  /** Snapshot: basis points for PERCENTAGE, paise per unit for FIXED. */
  taxRate: number;
  description: string | null;
  quantity: number;
  unitPrice: Paise;
  amount: Paise;
  sortOrder: number;
}

/** What invoice generation needs. Dates are `Date` (UTC midnight for date-only fields). */
export interface BillingSubscription {
  id: number;
  number: string;
  status: SubscriptionStatus;
  customerId: number;
  planId: number;
  billingPeriod: BillingPeriod;
  paymentTermId: number | null;
  startDate: Date;
  expiryDate: Date | null;
  nextBillingDate: Date | null;
  lastBilledUntil: Date | null;
  /** Ordered by sortOrder, then id. */
  lines: BillingSubscriptionLine[];
}

export interface SubscriptionsGateway {
  /** Null when the subscription is missing or soft-deleted. */
  getForBilling(id: number): Promise<BillingSubscription | null>;
  /**
   * Keyset page of ACTIVE, non-deleted subscriptions with `nextBillingDate <= asOf` and
   * (no `expiryDate` or `nextBillingDate <= expiryDate`), `id > afterId`, ascending id.
   */
  listDueIds(asOf: Date, afterId: number, limit: number): Promise<number[]>;
  /**
   * Conditional ACTIVE or PAUSED -> CLOSED with a history row (changedById null) and an
   * audit entry (actor null). Returns false when the subscription is not in such a state.
   */
  closeBySystem(id: number, reason: string): Promise<boolean>;
  /** ACTIVE subscriptions whose `expiryDate` day is before the `asOf` day and whose plan has `autoClose`. */
  listAutoCloseIds(asOf: Date): Promise<number[]>;
}
