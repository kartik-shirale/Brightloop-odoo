import type { CreatePaymentTermRequest, UpdatePaymentTermRequest } from '@brightloop/shared';
import { z } from 'zod';
import { buildListQuerySchema, queryBoolean } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const MAX_DUE_DAYS = 365;
export const DEFAULT_MUST_BE_ACTIVE = 'The default payment term must be active';

const nameField = z.string().trim().min(1).max(100);
const dueDaysField = z.number().int().min(0).max(MAX_DUE_DAYS);

export const createPaymentTermSchema = z
  .strictObject({
    name: nameField,
    dueDays: dueDaysField,
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.isDefault && !value.isActive) {
      ctx.addIssue({ code: 'custom', path: ['isActive'], message: DEFAULT_MUST_BE_ACTIVE });
    }
  });

export const updatePaymentTermSchema = z
  .strictObject({
    name: nameField.optional(),
    dueDays: dueDaysField.optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
    if (value.isDefault === true && value.isActive === false) {
      ctx.addIssue({ code: 'custom', path: ['isActive'], message: DEFAULT_MUST_BE_ACTIVE });
    }
  });

export const listPaymentTermsQuerySchema = buildListQuerySchema({
  sortable: ['name', 'dueDays', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    isActive: queryBoolean,
    isDefault: queryBoolean,
  },
});

export type CreatePaymentTermInput = z.infer<typeof createPaymentTermSchema>;
export type UpdatePaymentTermInput = z.infer<typeof updatePaymentTermSchema>;
export type ListPaymentTermsParams = z.infer<typeof listPaymentTermsQuerySchema>;

export type CreatePaymentTermCheck = AssertAssignable<CreatePaymentTermInput, CreatePaymentTermRequest>;
export type UpdatePaymentTermCheck = AssertAssignable<UpdatePaymentTermInput, UpdatePaymentTermRequest>;
