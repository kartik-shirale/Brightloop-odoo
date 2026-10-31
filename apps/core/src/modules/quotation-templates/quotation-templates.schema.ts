import type { CreateQuotationTemplateRequest, UpdateQuotationTemplateRequest } from '@brightloop/shared';
import { z } from 'zod';
import { buildListQuerySchema, queryBoolean, queryPositiveInt } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const MAX_INT4 = 2147483647;
const MAX_LINES = 100;

const nameField = z.string().trim().min(1).max(150);
const notesField = z.string().trim().max(2000).nullable();
const planIdField = z.number().int().min(1).max(MAX_INT4);
const validityDaysField = z.number().int().min(1).max(365);

const lineSchema = z.strictObject({
  productId: z.number().int().min(1).max(MAX_INT4),
  variantId: z.number().int().min(1).max(MAX_INT4).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_INT4),
  /** Accepted for contract compatibility; the stored order always follows the array index. */
  sortOrder: z.number().int().min(0).max(MAX_INT4).optional(),
});

const linesField = z.array(lineSchema).min(1).max(MAX_LINES);

export const createTemplateSchema = z.strictObject({
  name: nameField,
  planId: planIdField,
  validityDays: validityDaysField,
  notes: notesField.optional(),
  isActive: z.boolean().default(true),
  lines: linesField,
});

export const updateTemplateSchema = z
  .strictObject({
    name: nameField.optional(),
    planId: planIdField.optional(),
    validityDays: validityDaysField.optional(),
    notes: notesField.optional(),
    isActive: z.boolean().optional(),
    lines: linesField.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

export const listTemplatesQuerySchema = buildListQuerySchema({
  sortable: ['name', 'validityDays', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    planId: queryPositiveInt,
    isActive: queryBoolean,
  },
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type TemplateLineInput = z.infer<typeof lineSchema>;
export type ListTemplatesParams = z.infer<typeof listTemplatesQuerySchema>;

export type CreateTemplateCheck = AssertAssignable<z.input<typeof createTemplateSchema>, CreateQuotationTemplateRequest>;
export type UpdateTemplateCheck = AssertAssignable<z.input<typeof updateTemplateSchema>, UpdateQuotationTemplateRequest>;
