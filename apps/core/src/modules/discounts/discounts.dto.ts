import type {
  DiscountDto, DiscountListItemDto, DiscountState, DiscountUsageDto,
} from '@brightloop/shared';
import type { DiscountRow, DiscountUsageRow } from './discounts.repository.js';

export function toDiscountListItemDto(row: DiscountRow, state: DiscountState): DiscountListItemDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    value: row.value,
    scope: row.scope,
    minPurchase: row.minPurchase,
    minQuantity: row.minQuantity,
    startDate: row.startDate,
    endDate: row.endDate,
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    state,
    isActive: row.isActive,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toDiscountDto(
  row: DiscountRow,
  state: DiscountState,
  productIds: number[],
  attachedSubscriptionCount: number,
): DiscountDto {
  return { ...toDiscountListItemDto(row, state), productIds, attachedSubscriptionCount };
}

export function toDiscountUsageDto(
  row: DiscountUsageRow,
  discountName: string,
  invoiceNumber: string,
  subscriptionNumber: string,
): DiscountUsageDto {
  return {
    id: row.id,
    discountId: row.discountId,
    discountName,
    invoiceId: row.invoiceId,
    invoiceNumber,
    subscriptionId: row.subscriptionId,
    subscriptionNumber,
    amount: row.amount,
    createdAt: row.createdAt,
  };
}
