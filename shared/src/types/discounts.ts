import type { BasisPoints, DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
import type { DiscountScope, DiscountState, DiscountType, SubscriptionStatus } from './enums.js';
export interface DiscountListItemDto {
  id: number;
  name: string;
  code: string | null;
  type: DiscountType;
  /** PERCENTAGE: basis points; FIXED: paise. */
  value: BasisPoints | Paise;
  scope: DiscountScope;
  minPurchase: Paise | null;
  minQuantity: number | null;
  startDate: IsoDateTime;
  endDate: IsoDateTime | null;
  usageLimit: number | null;
  usedCount: number;
  state: DiscountState;
  isActive: boolean;
  createdById: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export interface DiscountDto extends DiscountListItemDto { productIds: number[]; attachedSubscriptionCount: number }
export interface DiscountUsageDto {
  id: number;
  discountId: number;
  discountName: string;
  invoiceId: number;
  invoiceNumber: string;
  subscriptionId: number;
  subscriptionNumber: string;
  amount: Paise;
  createdAt: IsoDateTime;
}
export interface CreateDiscountRequest {
  name: string;
  code?: string | null;
  type: DiscountType;
  value: BasisPoints | Paise;
  scope: DiscountScope;
  minPurchase?: Paise | null;
  minQuantity?: number | null;
  startDate: DateInput;
  endDate?: DateInput | null;
  usageLimit?: number | null;
  isActive?: boolean;
  productIds?: number[];
}
export interface UpdateDiscountRequest {
  name?: string;
  code?: string | null;
  type?: DiscountType;
  value?: BasisPoints | Paise;
  scope?: DiscountScope;
  minPurchase?: Paise | null;
  minQuantity?: number | null;
  startDate?: DateInput;
  endDate?: DateInput | null;
  usageLimit?: number | null;
  isActive?: boolean;
}
export interface SetDiscountProductsRequest { productIds: number[] }
export interface AttachDiscountSubscriptionsRequest { subscriptionIds: number[] }
export interface ListDiscountsQuery extends ListQuery<'name' | 'startDate' | 'endDate' | 'usedCount' | 'createdAt'> {
  type?: DiscountType[];
  scope?: DiscountScope[];
  isActive?: boolean;
  state?: DiscountState[];
  productId?: number;
}
export interface ListDiscountUsagesQuery extends ListQuery<'createdAt' | 'amount'> {
  invoiceId?: number;
  subscriptionId?: number;
  createdFrom?: DateInput;
  createdTo?: DateInput;
}
/** Frontend-requested additive endpoint; see shared/README.md. */
export interface DiscountSubscriptionDto {
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  status: SubscriptionStatus;
  createdAt: IsoDateTime;
}
export type ListDiscountSubscriptionsQuery = ListQuery<'createdAt'>;
