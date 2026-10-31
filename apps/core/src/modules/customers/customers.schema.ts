import type { CreateCustomerRequest, UpdateCustomerRequest } from '@brightloop/shared';
import { z } from 'zod';
import { buildListQuerySchema, includeList, queryBoolean, queryDate } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';

const INCLUDES = ['summary'] as const;

const nameField = z.string().trim().min(1).max(150);
const emailField = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const profileFields = {
  companyName: optionalText(150),
  phone: optionalText(30),
  taxId: optionalText(50),
  notes: optionalText(2000),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
};

/** `userId` is deliberately absent: the strict schema rejects it. */
export const createCustomerSchema = z.strictObject({
  name: nameField,
  email: emailField,
  ...profileFields,
});

export const updateCustomerSchema = z
  .strictObject({
    name: nameField.optional(),
    email: emailField.optional(),
    ...profileFields,
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

const filterText = z.string().trim().min(1).max(100);

export const listCustomersQuerySchema = buildListQuerySchema({
  sortable: ['name', 'companyName', 'createdAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    hasPortalAccount: queryBoolean,
    hasOutstanding: queryBoolean,
    city: filterText,
    state: filterText,
    createdFrom: queryDate('from'),
    createdTo: queryDate('to'),
    include: includeList(INCLUDES),
  },
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersParams = z.infer<typeof listCustomersQuerySchema>;

export type CreateCustomerCheck = AssertAssignable<CreateCustomerInput, CreateCustomerRequest>;
export type UpdateCustomerCheck = AssertAssignable<UpdateCustomerInput, UpdateCustomerRequest>;
