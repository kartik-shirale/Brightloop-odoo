import type { BillingPeriod, IsoDateTime, Paise } from '@brightloop/shared';

/** The plan fields other modules read or copy. Soft-deleted plans are never returned. */
export interface PlanRecord {
  id: number;
  name: string;
  price: Paise;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  availableFrom: IsoDateTime;
  availableTo: IsoDateTime | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  isActive: boolean;
}

export interface PlansGateway {
  /** Returns the plan, or null when it does not exist or was deleted. */
  getById(id: number): Promise<PlanRecord | null>;
  /**
   * Returns the plan when it is active and `date` falls inside
   * [availableFrom, availableTo] by UTC calendar day (both ends inclusive).
   * Throws 404 when the plan is missing or deleted, 409 PLAN_NOT_AVAILABLE otherwise.
   */
  assertAvailable(id: number, date: Date): Promise<PlanRecord>;
}
