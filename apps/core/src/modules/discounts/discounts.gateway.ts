import type { DiscountScope, DiscountType, Paise } from '@brightloop/shared';

export interface DiscountEvaluationLine {
  /** Any key the caller chooses (a subscription line id or an index). Echoed back in the applications. */
  lineId: number;
  productId: number | null;
  quantity: number;
  /** quantity * unitPrice, before discounts. */
  amount: Paise;
}

export interface DiscountEvaluationInput {
  /** null = no subscription-scope discounts (previews of unsaved subscriptions). */
  subscriptionId: number | null;
  lines: DiscountEvaluationLine[];
  asOf: Date;
}

export interface DiscountApplication {
  discountId: number;
  lineId: number | null;
  amount: Paise;
}

export interface DiscountSummary {
  id: number;
  name: string;
  code: string | null;
  type: DiscountType;
  value: number;
  scope: DiscountScope;
}

export interface DiscountsGateway {
  /**
   * Pure read: never writes and never touches `usedCount`. Returns one application per
   * (discount, line) with an amount above zero. Subscription-scope discounts are split per
   * line, so the amounts of one discount sum to its total and never exceed the base.
   */
  evaluate(input: DiscountEvaluationInput): Promise<DiscountApplication[]>;
  /** Non-deleted discounts attached to the subscription, for its detail view. */
  listAttachedForSubscription(subscriptionId: number): Promise<DiscountSummary[]>;
}
