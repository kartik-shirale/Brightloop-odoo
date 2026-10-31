import { TaxType, type CreateTaxRequest, type UpdateTaxRequest } from '@brightloop/shared';
import { z } from 'zod';
import { buildListQuerySchema, commaEnum, queryBoolean } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const TAX_TYPES = [TaxType.PERCENTAGE, TaxType.FIXED] as const;
const MAX_PERCENTAGE_BPS = 10000;
const MAX_INT4 = 2147483647;

const nameField = z.string().trim().min(1).max(100);
const rateField = z.number().int().min(0).max(MAX_INT4);

/** Returns a message when `rate` is invalid for `type`, otherwise null. Shared by the schema and the service. */
export function rateProblem(type: TaxType, rate: number): string | null {
  if (type === TaxType.PERCENTAGE && rate > MAX_PERCENTAGE_BPS) {
    return 'A percentage rate must be between 0 and 10000 basis points';
  }
  return null;
}

export const createTaxSchema = z
  .strictObject({
    name: nameField,
    type: z.enum(TAX_TYPES),
    rate: rateField,
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const problem = rateProblem(value.type, value.rate);
    if (problem !== null) ctx.addIssue({ code: 'custom', path: ['rate'], message: problem });
  });

export const updateTaxSchema = z
  .strictObject({
    name: nameField.optional(),
    type: z.enum(TAX_TYPES).optional(),
    rate: rateField.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
    if (value.type !== undefined && value.rate !== undefined) {
      const problem = rateProblem(value.type, value.rate);
      if (problem !== null) ctx.addIssue({ code: 'custom', path: ['rate'], message: problem });
    }
  });

export const listTaxesQuerySchema = buildListQuerySchema({
  sortable: ['name', 'rate', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    type: commaEnum(TAX_TYPES),
    isActive: queryBoolean,
  },
});

export type CreateTaxInput = z.infer<typeof createTaxSchema>;
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;
export type ListTaxesParams = z.infer<typeof listTaxesQuerySchema>;

export type CreateTaxCheck = AssertAssignable<CreateTaxInput, CreateTaxRequest>;
export type UpdateTaxCheck = AssertAssignable<UpdateTaxInput, UpdateTaxRequest>;
