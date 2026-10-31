import {
  ProductType,
  type CreateProductRequest,
  type CreateVariantRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
} from '@brightloop/shared';
import { z } from 'zod';
import { buildListQuerySchema, commaEnum, idParam, includeList, queryBoolean, queryPaise } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const PRODUCT_TYPES = [ProductType.SERVICE, ProductType.SOFTWARE, ProductType.ADDON, ProductType.PHYSICAL] as const;
const MAX_INT4 = 2147483647;

const nameField = z.string().trim().min(1).max(200);
const notesField = z.string().trim().max(2000).nullable();
const priceField = z.number().int().min(0).max(MAX_INT4);
const attributeField = z.string().trim().min(1).max(100);
const valueField = z.string().trim().min(1).max(100);

const variantShape = {
  attribute: attributeField,
  value: valueField,
  extraPrice: priceField.default(0),
  isActive: z.boolean().default(true),
};

export const createVariantSchema = z.strictObject(variantShape);

export const updateVariantSchema = z
  .strictObject({
    attribute: attributeField.optional(),
    value: valueField.optional(),
    extraPrice: priceField.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

export const createProductSchema = z
  .strictObject({
    name: nameField,
    type: z.enum(PRODUCT_TYPES),
    salesPrice: priceField,
    costPrice: priceField,
    notes: notesField.optional(),
    isActive: z.boolean().default(true),
    variants: z.array(createVariantSchema).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    (value.variants ?? []).forEach((variant, index) => {
      const key = `${variant.attribute.toLowerCase()}\u0000${variant.value.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['variants', index, 'value'], message: 'Duplicate attribute and value' });
      }
      seen.add(key);
    });
  });

export const updateProductSchema = z
  .strictObject({
    name: nameField.optional(),
    type: z.enum(PRODUCT_TYPES).optional(),
    salesPrice: priceField.optional(),
    costPrice: priceField.optional(),
    notes: notesField.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

export const listProductsQuerySchema = buildListQuerySchema({
  sortable: ['name', 'salesPrice', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    type: commaEnum(PRODUCT_TYPES),
    isActive: queryBoolean,
    minPrice: queryPaise,
    maxPrice: queryPaise,
    include: includeList(['variants'] as const),
  },
});

export const listVariantsQuerySchema = buildListQuerySchema({
  sortable: ['attribute', 'value', 'extraPrice'] as const,
  defaultSort: 'attribute',
  filters: { isActive: queryBoolean },
});

export const productIdParamsSchema = z.strictObject({ id: idParam });
export const variantsParentParamsSchema = z.strictObject({ productId: idParam });
export const variantParamsSchema = z.strictObject({ productId: idParam, variantId: idParam });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type ListProductsParams = z.infer<typeof listProductsQuerySchema>;
export type ListVariantsParams = z.infer<typeof listVariantsQuerySchema>;

export type CreateProductCheck = AssertAssignable<CreateProductInput, CreateProductRequest>;
export type UpdateProductCheck = AssertAssignable<UpdateProductInput, UpdateProductRequest>;
export type CreateVariantCheck = AssertAssignable<CreateVariantInput, CreateVariantRequest>;
export type UpdateVariantCheck = AssertAssignable<UpdateVariantInput, UpdateVariantRequest>;
