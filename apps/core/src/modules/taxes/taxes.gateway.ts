import type { BasisPoints, Paise, TaxType } from '@brightloop/shared';

/** The tax fields other modules copy into line snapshots. */
export interface TaxRecord {
  id: number;
  name: string;
  type: TaxType;
  /** Basis points for PERCENTAGE, paise per unit for FIXED. */
  rate: BasisPoints | Paise;
  isActive: boolean;
}

export interface TaxesGateway {
  /** Returns the taxes that exist, in no particular order. Callers detect missing ids themselves. */
  getByIds(ids: readonly number[]): Promise<TaxRecord[]>;
}
