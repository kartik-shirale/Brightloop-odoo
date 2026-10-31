import type {
  ProductAdminDetailDto,
  ProductAdminDto,
  ProductDetailDto,
  ProductDto,
  ProductVariantDto,
} from '@brightloop/shared';
import type { ProductRow, VariantRow } from './products.repository.js';

export function toVariantDto(row: VariantRow): ProductVariantDto {
  return {
    id: row.id,
    productId: row.productId,
    attribute: row.attribute,
    value: row.value,
    extraPrice: row.extraPrice,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** STAFF projection: no `costPrice`. */
export function toProductDto(row: ProductRow, variants?: readonly VariantRow[]): ProductDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    salesPrice: row.salesPrice,
    notes: row.notes,
    isActive: row.isActive,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(variants === undefined ? {} : { variants: variants.map(toVariantDto) }),
  };
}

/** ADMIN projection. */
export function toProductAdminDto(row: ProductRow, variants?: readonly VariantRow[]): ProductAdminDto {
  return { ...toProductDto(row, variants), costPrice: row.costPrice };
}

export function toProductDetailDto(row: ProductRow, variants: readonly VariantRow[]): ProductDetailDto {
  return { ...toProductDto(row, variants), variants: variants.map(toVariantDto) };
}

export function toProductAdminDetailDto(row: ProductRow, variants: readonly VariantRow[]): ProductAdminDetailDto {
  return { ...toProductAdminDto(row, variants), variants: variants.map(toVariantDto) };
}
