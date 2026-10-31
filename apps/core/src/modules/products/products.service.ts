import type {
  ListMeta,
  ProductAdminDetailDto,
  ProductAdminDto,
  ProductDetailDto,
  ProductDto,
  ProductVariantDto,
} from '@brightloop/shared';
import { forbidden, notFound } from '../../core/errors.js';
import { isAdmin, isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { rethrowDbError } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import {
  toProductAdminDetailDto,
  toProductAdminDto,
  toProductDetailDto,
  toProductDto,
  toVariantDto,
} from './products.dto.js';
import type { CatalogGateway, PricedItem } from './products.gateway.js';
import type { ProductRow, ProductsRepository, VariantRow } from './products.repository.js';
import type {
  CreateProductInput,
  CreateVariantInput,
  ListProductsParams,
  ListVariantsParams,
  UpdateProductInput,
  UpdateVariantInput,
} from './products.schema.js';

const PRODUCT_NOT_FOUND = 'Product not found';
const VARIANT_NOT_FOUND = 'Variant not found';
const DUPLICATE_VARIANT = 'This product already has a variant with this attribute and value';
const VARIANT_IN_USE = 'This variant is used by template, subscription or invoice lines. Deactivate it instead of deleting it';

export class ProductsService implements CatalogGateway {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly audit: AuditGateway,
  ) {}

  async list(actor: Actor, query: ListProductsParams): Promise<{ products: (ProductDto | ProductAdminDto)[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const [rows, total] = await Promise.all([this.repository.listProducts(query), this.repository.countProducts(query)]);
    const variants = query.include?.includes('variants')
      ? await this.repository.listVariantsForProducts(rows.map((row) => row.id))
      : undefined;
    const products = rows.map((row) => this.toProduct(actor, row, variants?.filter((variant) => variant.productId === row.id)));
    return { products, meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<ProductDetailDto | ProductAdminDetailDto> {
    this.assertCanRead(actor);
    const row = await this.requireProduct(id);
    return this.toDetail(actor, row, await this.repository.listVariantsForProducts([id]));
  }

  async create(actor: Actor, input: CreateProductInput, ip?: string): Promise<ProductDetailDto | ProductAdminDetailDto> {
    this.assertAdmin(actor);
    let created: { product: ProductRow; variants: VariantRow[] };
    try {
      created = await this.repository.createProduct(input, actor.userId);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_VARIANT });
    }
    await this.audit.record({
      actor, action: 'product.create', entityType: 'Product', entityId: created.product.id, ip,
      metadata: {
        name: created.product.name, type: created.product.type, salesPrice: created.product.salesPrice,
        costPrice: created.product.costPrice, isActive: created.product.isActive, variantCount: created.variants.length,
      },
    });
    return this.toDetail(actor, created.product, created.variants);
  }

  async update(actor: Actor, id: number, patch: UpdateProductInput, ip?: string): Promise<ProductDto | ProductAdminDto> {
    this.assertAdmin(actor);
    const existing = await this.requireProduct(id);
    const row = await this.repository.updateProduct(id, patch);
    if (row === null) throw notFound(PRODUCT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'product.update', entityType: 'Product', entityId: id, ip,
      metadata: { changes: patch, previous: pickPrevious(existing, patch) },
    });
    return this.toProduct(actor, row);
  }

  /** Soft delete. Variants stay in the table but become unreachable. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    const row = await this.repository.softDeleteProduct(id);
    if (row === null) throw notFound(PRODUCT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'product.delete', entityType: 'Product', entityId: id, ip,
      metadata: { name: row.name, type: row.type, salesPrice: row.salesPrice },
    });
  }

  async listVariants(actor: Actor, productId: number, query: ListVariantsParams): Promise<{ variants: ProductVariantDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    await this.requireProduct(productId);
    const [rows, total] = await Promise.all([
      this.repository.listVariants(productId, query),
      this.repository.countVariants(productId, query),
    ]);
    return { variants: rows.map(toVariantDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  async createVariant(actor: Actor, productId: number, input: CreateVariantInput, ip?: string): Promise<ProductVariantDto> {
    this.assertAdmin(actor);
    await this.requireProduct(productId);
    let row: VariantRow;
    try {
      row = await this.repository.createVariant(productId, input);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_VARIANT });
    }
    await this.audit.record({
      actor, action: 'product.variant.create', entityType: 'ProductVariant', entityId: row.id, ip,
      metadata: { productId, attribute: row.attribute, value: row.value, extraPrice: row.extraPrice, isActive: row.isActive },
    });
    return toVariantDto(row);
  }

  async updateVariant(actor: Actor, productId: number, variantId: number, patch: UpdateVariantInput, ip?: string): Promise<ProductVariantDto> {
    this.assertAdmin(actor);
    await this.requireProduct(productId);
    const existing = await this.requireVariant(productId, variantId);
    let row: VariantRow | null;
    try {
      row = await this.repository.updateVariant(productId, variantId, patch);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_VARIANT });
    }
    if (row === null) throw notFound(VARIANT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'product.variant.update', entityType: 'ProductVariant', entityId: variantId, ip,
      metadata: { productId, changes: patch, previous: pickPreviousVariant(existing, patch) },
    });
    return toVariantDto(row);
  }

  /** A referenced variant fails on the foreign key and becomes 409 IN_USE. */
  async removeVariant(actor: Actor, productId: number, variantId: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    await this.requireProduct(productId);
    let row: VariantRow | null;
    try {
      row = await this.repository.deleteVariant(productId, variantId);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: VARIANT_IN_USE });
    }
    if (row === null) throw notFound(VARIANT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'product.variant.delete', entityType: 'ProductVariant', entityId: variantId, ip,
      metadata: { productId, attribute: row.attribute, value: row.value, extraPrice: row.extraPrice },
    });
  }

  async getPricedItem(productId: number, variantId?: number): Promise<PricedItem> {
    const product = await this.requireProduct(productId);
    if (variantId === undefined) {
      return { productId, variantId: null, name: product.name, unitPrice: product.salesPrice, isActive: product.isActive };
    }
    const variant = await this.requireVariant(productId, variantId);
    return {
      productId,
      variantId,
      name: `${product.name} (${variant.attribute}: ${variant.value})`,
      unitPrice: product.salesPrice + variant.extraPrice,
      isActive: product.isActive && variant.isActive,
    };
  }

  private async requireProduct(id: number): Promise<ProductRow> {
    const row = await this.repository.findProduct(id);
    if (row === null) throw notFound(PRODUCT_NOT_FOUND);
    return row;
  }

  private async requireVariant(productId: number, variantId: number): Promise<VariantRow> {
    const row = await this.repository.findVariant(productId, variantId);
    if (row === null) throw notFound(VARIANT_NOT_FOUND);
    return row;
  }

  private toProduct(actor: Actor, row: ProductRow, variants?: readonly VariantRow[]): ProductDto | ProductAdminDto {
    return isAdmin(actor) ? toProductAdminDto(row, variants) : toProductDto(row, variants);
  }

  private toDetail(actor: Actor, row: ProductRow, variants: readonly VariantRow[]): ProductDetailDto | ProductAdminDetailDto {
    return isAdmin(actor) ? toProductAdminDetailDto(row, variants) : toProductDetailDto(row, variants);
  }

  private assertCanRead(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

function pickPrevious(existing: ProductRow, patch: UpdateProductInput): Partial<ProductRow> {
  const previous: Partial<ProductRow> = {};
  if (patch.name !== undefined) previous.name = existing.name;
  if (patch.type !== undefined) previous.type = existing.type;
  if (patch.salesPrice !== undefined) previous.salesPrice = existing.salesPrice;
  if (patch.costPrice !== undefined) previous.costPrice = existing.costPrice;
  if (patch.notes !== undefined) previous.notes = existing.notes;
  if (patch.isActive !== undefined) previous.isActive = existing.isActive;
  return previous;
}

function pickPreviousVariant(existing: VariantRow, patch: UpdateVariantInput): Partial<VariantRow> {
  const previous: Partial<VariantRow> = {};
  if (patch.attribute !== undefined) previous.attribute = existing.attribute;
  if (patch.value !== undefined) previous.value = existing.value;
  if (patch.extraPrice !== undefined) previous.extraPrice = existing.extraPrice;
  if (patch.isActive !== undefined) previous.isActive = existing.isActive;
  return previous;
}
