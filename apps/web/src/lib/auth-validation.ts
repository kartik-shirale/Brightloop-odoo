import { z } from 'zod';
import { PASSWORD_POLICY } from '@brightloop/shared';
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
export const passwordSchema = z.string().min(PASSWORD_POLICY.MIN_LENGTH, PASSWORD_POLICY.MESSAGE)
  .regex(/[A-Z]/, 'Include an uppercase letter').regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[^A-Za-z0-9\s]/, 'Include a special character')
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_POLICY.MAX_BYTES, 'Use at most 72 bytes');
export const confirmPasswords = (values: { password: string; confirmPassword: string }): boolean => values.password === values.confirmPassword;
export const confirmOptions = { message: 'Passwords do not match', path: ['confirmPassword'] };
