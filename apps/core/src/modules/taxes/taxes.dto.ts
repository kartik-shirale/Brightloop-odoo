import type { TaxDto } from '@brightloop/shared';
import type { TaxRow } from './taxes.repository.js';

export function toTaxDto(row: TaxRow): TaxDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    rate: row.rate,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
