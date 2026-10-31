import {
  DiscountScope, DiscountState, DiscountType,
  type AttachDiscountSubscriptionsRequest, type CreateDiscountRequest,
  type SetDiscountProductsRequest, type UpdateDiscountRequest,
} from '@brightloop/shared';
import { z } from 'zod';
import { parseDateInput, startOfUtcDay } from '../../core/utils/dates.js';
import {
  buildListQuerySchema, commaEnum, idParam, queryBoolean, queryDate, queryPositiveInt,
} from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const DISCOUNT_TYPES = [DiscountType.PERCENTAGE, DiscountType.FIXED] as const;
const DISCOUNT_SCOPES = [DiscountScope.PRODUCT, DiscountScope.SUBSCRIPTION] as const;
const DISCOUNT_STATES = [
  DiscountState.UPCOMING, DiscountState.ACTIVE, DiscountState.EXPIRED, DiscountState.EXHAUSTED,
] as const;
const MAX_PERCENTAGE_BPS = 10000;
const MAX_INT4 = 2147483647;
const MAX_IDS = 500;

const nameField = z.string().trim().min(1).max(150);
const codeField = z.string().trim().min(1).max(50).nullable();
const valueField = z.number().int().min(1).max(MAX_INT4);
const minPurchaseField = z.number().int().min(0).max(MAX_INT4).nullable();
const minQuantityField = z.number().int().min(1).max(MAX_INT4).nullable();
const usageLimitField = z.number().int().min(1).max(MAX_INT4).nullable();
const idList = z.array(z.number().int().min(1).max(MAX_INT4)).max(MAX_IDS).refine((ids) => new Set(ids).size === ids.length, {
  message: 'Ids must be unique',
});

/** A calendar date (or instant) normalized to UTC midnight of that date. */
const dateField = z.string().transform((raw, ctx): Date => {
  const parsed = parseDateInput(raw);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected an ISO 8601 date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return startOfUtcDay(parsed);
});

export const END_DATE_PROBLEM = 'endDate must be on or after startDate';

/** Returns a message when `value` is invalid for `type`, otherwise null. Shared by the schema and the service. */
export function valueProblem(type: DiscountType, value: number): string | null {
  if (type === DiscountType.PERCENTAGE && value > MAX_PERCENTAGE_BPS) {
    return 'A percentage value must be between 1 and 10000 basis points';
  }
  return null;
}

/** Returns a message when the window is invalid, otherwise null. Both ends are inclusive calendar days. */
export function windowProblem(startDate: Date, endDate: Date | null): string | null {
  return endDate !== null && endDate.getTime() < startDate.getTime() ? END_DATE_PROBLEM : null;
}

export const createDiscountSchema = z
  .strictObject({
    name: nameField,
    code: codeField.optional(),
    type: z.enum(DISCOUNT_TYPES),
    value: valueField,
    scope: z.enum(DISCOUNT_SCOPES),
    minPurchase: minPurchaseField.optional(),
    minQuantity: minQuantityField.optional(),
    startDate: dateField,
    endDate: dateField.nullable().optional(),
    usageLimit: usageLimitField.optional(),
    isActive: z.boolean().default(true),
    productIds: idList.optional(),
  })
  .superRefine((value, ctx) => {
    const valueIssue = valueProblem(value.type, value.value);
    if (valueIssue !== null) ctx.addIssue({ code: 'custom', path: ['value'], message: valueIssue });
    const windowIssue = windowProblem(value.startDate, value.endDate ?? null);
    if (windowIssue !== null) ctx.addIssue({ code: 'custom', path: ['endDate'], message: windowIssue });
    if (value.scope !== DiscountScope.PRODUCT && value.productIds !== undefined && value.productIds.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'productIds are only allowed when scope is PRODUCT' });
    }
  });

export const updateDiscountSchema = z
  .strictObject({
    name: nameField.optional(),
    code: codeField.optional(),
    type: z.enum(DISCOUNT_TYPES).optional(),
    value: valueField.optional(),
    scope: z.enum(DISCOUNT_SCOPES).optional(),
    minPurchase: minPurchaseField.optional(),
    minQuantity: minQuantityField.optional(),
    startDate: dateField.optional(),
    endDate: dateField.nullable().optional(),
    usageLimit: usageLimitField.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
    if (value.type !== undefined && value.value !== undefined) {
      const problem = valueProblem(value.type, value.value);
      if (problem !== null) ctx.addIssue({ code: 'custom', path: ['value'], message: problem });
    }
    if (value.startDate !== undefined && value.endDate !== undefined) {
      const problem = windowProblem(value.startDate, value.endDate);
      if (problem !== null) ctx.addIssue({ code: 'custom', path: ['endDate'], message: problem });
    }
  });

export const setDiscountProductsSchema = z.strictObject({ productIds: idList });

export const attachDiscountSubscriptionsSchema = z.strictObject({
  subscriptionIds: idList.min(1),
});

export const discountSubscriptionParamsSchema = z.strictObject({ id: idParam, subscriptionId: idParam });

export const listDiscountsQuerySchema = buildListQuerySchema({
  sortable: ['name', 'startDate', 'endDate', 'usedCount', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    type: commaEnum(DISCOUNT_TYPES),
    scope: commaEnum(DISCOUNT_SCOPES),
    isActive: queryBoolean,
    state: commaEnum(DISCOUNT_STATES),
    productId: queryPositiveInt,
  },
});

export const listDiscountUsagesQuerySchema = buildListQuerySchema({
  sortable: ['createdAt', 'amount'] as const,
  defaultSort: 'createdAt',
  filters: {
    invoiceId: queryPositiveInt,
    subscriptionId: queryPositiveInt,
    createdFrom: queryDate('from'),
    createdTo: queryDate('to'),
  },
}).omit({ search: true });

export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
export type SetDiscountProductsInput = z.infer<typeof setDiscountProductsSchema>;
export type AttachDiscountSubscriptionsInput = z.infer<typeof attachDiscountSubscriptionsSchema>;
export type ListDiscountsParams = z.infer<typeof listDiscountsQuerySchema>;
export type ListDiscountUsagesParams = z.infer<typeof listDiscountUsagesQuerySchema>;

export type CreateDiscountCheck = AssertAssignable<z.input<typeof createDiscountSchema>, CreateDiscountRequest>;
export type UpdateDiscountCheck = AssertAssignable<z.input<typeof updateDiscountSchema>, UpdateDiscountRequest>;
export type SetDiscountProductsCheck = AssertAssignable<z.input<typeof setDiscountProductsSchema>, SetDiscountProductsRequest>;
export type AttachDiscountSubscriptionsCheck = AssertAssignable<
  z.input<typeof attachDiscountSubscriptionsSchema>, AttachDiscountSubscriptionsRequest
>;
