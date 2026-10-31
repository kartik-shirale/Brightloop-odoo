import type { PaymentTermDto } from '@brightloop/shared';
import type { PaymentTermRow } from './payment-terms.repository.js';

export function toPaymentTermDto(row: PaymentTermRow): PaymentTermDto {
  return {
    id: row.id,
    name: row.name,
    dueDays: row.dueDays,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
