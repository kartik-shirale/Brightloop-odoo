import type { DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
import type { BillingPeriod } from './enums.js';
export interface PlanRefDto { id: number; name: string; billingPeriod: BillingPeriod }
export interface PlanListItemDto extends PlanRefDto {
  description: string | null;
  price: Paise;
  minQuantity: number;
  availableFrom: IsoDateTime;
  availableTo: IsoDateTime | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  isActive: boolean;
  createdById: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export interface PlanDto extends PlanListItemDto { activeSubscriptionCount: number }
export interface CreatePlanRequest {
  name: string;
  description?: string | null;
  price: Paise;
  billingPeriod: BillingPeriod;
  minQuantity?: number;
  availableFrom: DateInput;
  availableTo?: DateInput | null;
  autoClose?: boolean;
  closable?: boolean;
  pausable?: boolean;
  renewable?: boolean;
  isActive?: boolean;
}
export interface UpdatePlanRequest {
  name?: string;
  description?: string | null;
  price?: Paise;
  billingPeriod?: BillingPeriod;
  minQuantity?: number;
  availableFrom?: DateInput;
  availableTo?: DateInput | null;
  autoClose?: boolean;
  closable?: boolean;
  pausable?: boolean;
  renewable?: boolean;
  isActive?: boolean;
}
export interface ListPlansQuery extends ListQuery<'name' | 'price' | 'availableFrom' | 'createdAt'> {
  billingPeriod?: BillingPeriod[];
  isActive?: boolean;
  availableOn?: DateInput;
  autoClose?: boolean;
  closable?: boolean;
  pausable?: boolean;
  renewable?: boolean;
}
