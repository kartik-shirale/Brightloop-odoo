import { PASSWORD_POLICY } from '@brightloop/shared';
/**
 * Zod contracts for the users module (backend-rules.md #2, #8).
 * List endpoint supports pagination, search, sorting (whitelist), filters.
 */

import { z } from 'zod';
import { Role } from '@brightloop/shared';


export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  /** Case-insensitive search over name/email/username. */
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['createdAt', 'name', 'email', 'lastLoginAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  role: z.enum(Role).optional(),
  /** `true` → verified accounts only, `false` → unverified only. */
  verified: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdTo: z.iso.datetime({ offset: true }).optional(),
});

export const userIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username may only contain letters, digits, - and _')
      .nullish(),
  })
  .refine((data) => data.name !== undefined || data.username !== undefined, {
    message: 'Nothing to update',
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    password: z.string().min(PASSWORD_POLICY.MIN_LENGTH, PASSWORD_POLICY.MESSAGE)
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[^A-Za-z0-9\s]/, 'Password must contain a special character')
      .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_POLICY.MAX_BYTES, 'Password must be at most 72 bytes'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type { Role };
