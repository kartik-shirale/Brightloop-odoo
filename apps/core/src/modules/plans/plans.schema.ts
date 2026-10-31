import { BillingPeriod, type CreatePlanRequest, type UpdatePlanRequest } from '@brightloop/shared';
import { z } from 'zod';
import { parseDateInput, startOfUtcDay } from '../../core/utils/dates.js';
import { buildListQuerySchema, commaEnum, queryBoolean, queryDate } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const BILLING_PERIODS = [BillingPeriod.DAILY, BillingPeriod.WEEKLY, BillingPeriod.MONTHLY, BillingPeriod.YEARLY] as const;
const MAX_INT4 = 2147483647;

const nameField = z.string().trim().min(1).max(150);
const descriptionField = z.string().trim().max(2000).nullable();
const priceField = z.number().int().min(0).max(MAX_INT4);
const minQuantityField = z.number().int().min(1).max(MAX_INT4);

/** A calendar date (or instant) normalized to UTC midnight of that date. */
const dateField = z.string().transform((raw, ctx): Date => {
  const parsed = parseDateInput(raw);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'Expected an ISO 8601 date (YYYY-MM-DD)' });
    return z.NEVER;
  }
  return startOfUtcDay(parsed);
});

export const AVAILABLE_TO_PROBLEM = 'availableTo must be after availableFrom';

/** Returns a message when the window is invalid, otherwise null. Shared by the schema and the service. */
export function availabilityProblem(availableFrom: Date, availableTo: Date | null): string | null {
  return availableTo !== null && availableTo.getTime() <= availableFrom.getTime() ? AVAILABLE_TO_PROBLEM : null;
}

export const createPlanSchema = z
  .strictObject({
    name: nameField,
    description: descriptionField.optional(),
    price: priceField,
    billingPeriod: z.enum(BILLING_PERIODS),
    minQuantity: minQuantityField.default(1),
    availableFrom: dateField,
    availableTo: dateField.nullable().optional(),
    autoClose: z.boolean().default(false),
    closable: z.boolean().default(false),
    pausable: z.boolean().default(false),
    renewable: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const problem = availabilityProblem(value.availableFrom, value.availableTo ?? null);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['availableTo'], message: problem });
  });

export const updatePlanSchema = z
  .strictObject({
    name: nameField.optional(),
    description: descriptionField.optional(),
    price: priceField.optional(),
    billingPeriod: z.enum(BILLING_PERIODS).optional(),
    minQuantity: minQuantityField.optional(),
    availableFrom: dateField.optional(),
    availableTo: dateField.nullable().optional(),
    autoClose: z.boolean().optional(),
    closable: z.boolean().optional(),
    pausable: z.boolean().optional(),
    renewable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
    if (value.availableFrom !== undefined && value.availableTo !== undefined) {
      const problem = availabilityProblem(value.availableFrom, value.availableTo);
      if (problem !== null) ctx.addIssue({ code: 'custom', path: ['availableTo'], message: problem });
    }
  });

export const listPlansQuerySchema = buildListQuerySchema({
  sortable: ['name', 'price', 'availableFrom', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    billingPeriod: commaEnum(BILLING_PERIODS),
    isActive: queryBoolean,
    availableOn: queryDate(),
    autoClose: queryBoolean,
    closable: queryBoolean,
    pausable: queryBoolean,
    renewable: queryBoolean,
  },
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type ListPlansParams = z.infer<typeof listPlansQuerySchema>;

export type CreatePlanCheck = AssertAssignable<z.input<typeof createPlanSchema>, CreatePlanRequest>;
export type UpdatePlanCheck = AssertAssignable<z.input<typeof updatePlanSchema>, UpdatePlanRequest>;
