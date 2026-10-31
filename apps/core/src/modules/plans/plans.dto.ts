import type { PlanDto, PlanListItemDto } from '@brightloop/shared';
import type { PlanRow } from './plans.repository.js';

export function toPlanListItemDto(row: PlanRow): PlanListItemDto {
  return {
    id: row.id,
    name: row.name,
    billingPeriod: row.billingPeriod,
    description: row.description,
    price: row.price,
    minQuantity: row.minQuantity,
    availableFrom: row.availableFrom,
    availableTo: row.availableTo,
    autoClose: row.autoClose,
    closable: row.closable,
    pausable: row.pausable,
    renewable: row.renewable,
    isActive: row.isActive,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPlanDto(row: PlanRow, activeSubscriptionCount: number): PlanDto {
  return { ...toPlanListItemDto(row), activeSubscriptionCount };
}
