import type { IsoDateTime, ListQuery } from './common.js';
export interface PaymentTermDto {
  id: number;
  name: string;
  dueDays: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export interface CreatePaymentTermRequest {
  name: string;
  dueDays: number;
  isDefault?: boolean;
  isActive?: boolean;
}
export interface UpdatePaymentTermRequest {
  name?: string;
  dueDays?: number;
  isDefault?: boolean;
  isActive?: boolean;
}
export interface ListPaymentTermsQuery extends ListQuery<'name' | 'dueDays' | 'createdAt'> {
  isActive?: boolean;
  isDefault?: boolean;
}
