import type { ProductType } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type {
  CreateProductInput,
  CreateVariantInput,
  ListProductsParams,
  ListVariantsParams,
  UpdateProductInput,
  UpdateVariantInput,
} from './products.schema.js';

export interface ProductRow {
  id: number;
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  isActive: boolean;
  createdById: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariantRow {
  id: number;
  productId: number;
  attribute: string;
  value: string;
  extraPrice: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProductAccessor = ModelAccessor<Contract, 'Product', 'public'>;
type VariantAccessor = ModelAccessor<Contract, 'ProductVariant', 'public'>;

function productWhere(query: ListProductsParams) {
  return (product: ProductAccessor) => {
    const conditions = [product.deletedAt.isNull()];
    if (query.search !== undefined) {
      conditions.push(or(product.name.ilike(`%${query.search}%`), product.notes.ilike(`%${query.search}%`)));
    }
    if (query.type !== undefined) conditions.push(or(...query.type.map((type) => product.type.eq(type))));
    if (query.isActive !== undefined) conditions.push(product.isActive.eq(query.isActive));
    if (query.minPrice !== undefined) conditions.push(product.salesPrice.gte(query.minPrice));
    if (query.maxPrice !== undefined) conditions.push(product.salesPrice.lte(query.maxPrice));
    return and(...conditions);
  };
}

function variantWhere(productId: number, query: ListVariantsParams) {
  return (variant: VariantAccessor) => {
    const conditions = [variant.productId.eq(productId)];
    if (query.search !== undefined) {
      conditions.push(or(variant.attribute.ilike(`%${query.search}%`), variant.value.ilike(`%${query.search}%`)));
    }
    if (query.isActive !== undefined) conditions.push(variant.isActive.eq(query.isActive));
    return and(...conditions);
  };
}

export class ProductsRepository {
  async listProducts(query: ListProductsParams): Promise<ProductRow[]> {
    const asc = query.sortOrder === 'asc';
    return prisma.orm.public.Product
      .where(productWhere(query))
      .orderBy([
        (product) => {
          const column = query.sortBy === 'name' ? product.name : query.sortBy === 'salesPrice' ? product.salesPrice : product.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (product) => (asc ? product.id.asc() : product.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async countProducts(query: ListProductsParams): Promise<number> {
    const result = await prisma.orm.public.Product.where(productWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Returns null for a missing or soft-deleted product. */
  async findProduct(id: number): Promise<ProductRow | null> {
    return prisma.orm.public.Product.where((product) => and(product.id.eq(id), product.deletedAt.isNull())).first();
  }

  /** One query for the whole page, never one per product. */
  async listVariantsForProducts(productIds: readonly number[]): Promise<VariantRow[]> {
    if (productIds.length === 0) return [];
    return prisma.orm.public.ProductVariant
      .where((variant) => or(...productIds.map((id) => variant.productId.eq(id))))
      .orderBy([(variant) => variant.attribute.asc(), (variant) => variant.value.asc(), (variant) => variant.id.asc()])
      .all();
  }

  /** The product and its variants commit together, or neither does. */
  async createProduct(input: CreateProductInput, createdById: number): Promise<{ product: ProductRow; variants: VariantRow[] }> {
    return prisma.transaction(async (tx) => {
      const product = await tx.orm.public.Product.create({
        name: input.name,
        type: input.type,
        salesPrice: input.salesPrice,
        costPrice: input.costPrice,
        notes: input.notes ?? null,
        isActive: input.isActive,
        createdById,
      });
      const variants = input.variants === undefined || input.variants.length === 0
        ? []
        : await tx.orm.public.ProductVariant.createAll(input.variants.map((variant) => ({
          productId: product.id,
          attribute: variant.attribute,
          value: variant.value,
          extraPrice: variant.extraPrice,
          isActive: variant.isActive,
        })));
      return { product, variants };
    });
  }

  /** Conditional on the product not being soft-deleted. */
  async updateProduct(id: number, patch: UpdateProductInput): Promise<ProductRow | null> {
    const rows = await prisma.orm.public.Product
      .where((product) => and(product.id.eq(id), product.deletedAt.isNull()))
      .updateAll({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.salesPrice !== undefined ? { salesPrice: patch.salesPrice } : {}),
        ...(patch.costPrice !== undefined ? { costPrice: patch.costPrice } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      });
    return rows[0] ?? null;
  }

  async softDeleteProduct(id: number): Promise<ProductRow | null> {
    const rows = await prisma.orm.public.Product
      .where((product) => and(product.id.eq(id), product.deletedAt.isNull()))
      .updateAll({ deletedAt: new Date().toISOString() });
    return rows[0] ?? null;
  }

  async listVariants(productId: number, query: ListVariantsParams): Promise<VariantRow[]> {
    const asc = query.sortOrder === 'asc';
    return prisma.orm.public.ProductVariant
      .where(variantWhere(productId, query))
      .orderBy([
        (variant) => {
          const column = query.sortBy === 'value' ? variant.value : query.sortBy === 'extraPrice' ? variant.extraPrice : variant.attribute;
          return asc ? column.asc() : column.desc();
        },
        (variant) => (asc ? variant.id.asc() : variant.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async countVariants(productId: number, query: ListVariantsParams): Promise<number> {
    const result = await prisma.orm.public.ProductVariant.where(variantWhere(productId, query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async findVariant(productId: number, variantId: number): Promise<VariantRow | null> {
    return prisma.orm.public.ProductVariant
      .where((variant) => and(variant.id.eq(variantId), variant.productId.eq(productId)))
      .first();
  }

  async createVariant(productId: number, input: CreateVariantInput): Promise<VariantRow> {
    return prisma.orm.public.ProductVariant.create({
      productId,
      attribute: input.attribute,
      value: input.value,
      extraPrice: input.extraPrice,
      isActive: input.isActive,
    });
  }

  async updateVariant(productId: number, variantId: number, patch: UpdateVariantInput): Promise<VariantRow | null> {
    const rows = await prisma.orm.public.ProductVariant
      .where((variant) => and(variant.id.eq(variantId), variant.productId.eq(productId)))
      .updateAll({
        ...(patch.attribute !== undefined ? { attribute: patch.attribute } : {}),
        ...(patch.value !== undefined ? { value: patch.value } : {}),
        ...(patch.extraPrice !== undefined ? { extraPrice: patch.extraPrice } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      });
    return rows[0] ?? null;
  }

  /** Returns the deleted row, or null when it did not exist. A referenced variant fails on the foreign key. */
  async deleteVariant(productId: number, variantId: number): Promise<VariantRow | null> {
    const rows = await prisma.orm.public.ProductVariant
      .where((variant) => and(variant.id.eq(variantId), variant.productId.eq(productId)))
      .deleteAll();
    return rows[0] ?? null;
  }
}
