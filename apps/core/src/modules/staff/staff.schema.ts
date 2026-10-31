import type { CreateStaffRequest, ListStaffQuery, UpdateStaffRequest } from '@brightloop/shared';
import { z } from 'zod';
import { buildListQuerySchema, queryBoolean } from '../../core/utils/list-query.js';
import type { AssertAssignable } from '../../core/utils/type-checks.js';
import { passwordSchema } from '../auth/auth.schema.js';

const nameField = z.string().trim().min(2, 'Name must be at least 2 characters').max(80);
const usernameField = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, numbers, _ and -');
const emailField = z.string().trim().toLowerCase().pipe(z.email());

/** `role` is not a field: the strict object rejects it, and the service always sets STAFF. */
export const createStaffSchema = z.strictObject({
  name: nameField,
  email: emailField,
  username: usernameField.optional(),
  password: passwordSchema,
});

export const updateStaffSchema = z
  .strictObject({
    name: nameField.optional(),
    username: usernameField.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update' });
    }
  });

export const listStaffQuerySchema = buildListQuerySchema({
  sortable: ['name', 'email', 'createdAt', 'lastLoginAt'] as const,
  defaultSort: 'createdAt',
  filters: {
    isActive: queryBoolean,
  },
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ListStaffParams = z.infer<typeof listStaffQuerySchema>;

export type CreateStaffCheck = AssertAssignable<CreateStaffInput, CreateStaffRequest>;
export type UpdateStaffCheck = AssertAssignable<UpdateStaffInput, UpdateStaffRequest>;
export type ListStaffCheck = AssertAssignable<ListStaffParams, Pick<ListStaffQuery, 'isActive'>>;
