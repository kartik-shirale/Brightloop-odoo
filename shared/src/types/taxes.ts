import type { BasisPoints, IsoDateTime, ListQuery, Paise } from './common.js';
import type { TaxType } from './enums.js';

/** rate is basis points for PERCENTAGE, paise per unit for FIXED. */
export interface TaxDto {
  id: number;
  name: string;
  type: TaxType;
  rate: BasisPoints | Paise;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export interface CreateTaxRequest {
  name: string;
  type: TaxType;
  rate: BasisPoints | Paise;
  isActive?: boolean;
}
export interface UpdateTaxRequest {
  name?: string;
  type?: TaxType;
  rate?: BasisPoints | Paise;
  isActive?: boolean;
}
export interface ListTaxesQuery extends ListQuery<'name' | 'rate' | 'createdAt'> {
  type?: TaxType[];
  isActive?: boolean;
}
