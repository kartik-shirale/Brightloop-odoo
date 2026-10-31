import type { IsoDateTime, ListQuery, Paise } from './common.js';
import type { ProductType } from './enums.js';
export interface ProductVariantDto {
  id: number;
  productId: number;
  attribute: string;
  value: string;
  extraPrice: Paise;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
/** STAFF projection. variants is present only when requested on a list. */
export interface ProductDto {
  id: number;
  name: string;
  type: ProductType;
  salesPrice: Paise;
  notes: string | null;
  isActive: boolean;
  createdById: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  variants?: ProductVariantDto[];
}
export interface ProductAdminDto extends ProductDto { costPrice: Paise }
export interface ProductDetailDto extends ProductDto { variants: ProductVariantDto[] }
export interface ProductAdminDetailDto extends ProductAdminDto { variants: ProductVariantDto[] }
export interface CreateVariantRequest {
  attribute: string;
  value: string;
  extraPrice?: Paise;
  isActive?: boolean;
}
export interface UpdateVariantRequest {
  attribute?: string;
  value?: string;
  extraPrice?: Paise;
  isActive?: boolean;
}
export interface CreateProductRequest {
  name: string;
  type: ProductType;
  salesPrice: Paise;
  costPrice: Paise;
  notes?: string | null;
  isActive?: boolean;
  variants?: CreateVariantRequest[];
}
/** Variant edits use the dedicated endpoints; no nested arbitrary writes. */
export interface UpdateProductRequest {
  name?: string;
  type?: ProductType;
  salesPrice?: Paise;
  costPrice?: Paise;
  notes?: string | null;
  isActive?: boolean;
}
export interface ListProductsQuery extends ListQuery<'name' | 'salesPrice' | 'createdAt'> {
  type?: ProductType[];
  isActive?: boolean;
  minPrice?: Paise;
  maxPrice?: Paise;
  include?: 'variants'[];
}
export interface ListVariantsQuery extends ListQuery<'attribute' | 'value' | 'extraPrice'> { isActive?: boolean }
