import { PASSWORD_POLICY } from '@brightloop/shared';
/**
 * Zod contracts for the auth module (backend-rules.md #8).
 * Validated input is the ONLY thing controllers pass to services.
 */

import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const passwordSchema = z.string()
  .min(PASSWORD_POLICY.MIN_LENGTH, PASSWORD_POLICY.MESSAGE)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[^A-Za-z0-9\s]/, 'Password must contain a special character')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_POLICY.MAX_BYTES, 'Password must be at most 72 bytes');

const otpSchema = z.string().regex(/^\d{6}$/, 'OTP must be 6 digits');

export const registerSchema = z
  .object({
    username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72),
});

export const verifyOtpSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

export const resendOtpSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const verifyResetOtpSchema = verifyOtpSchema;

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    otp: otpSchema.optional(),
    resetToken: z.string().regex(/^[0-9a-f]{96}$/).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }).refine((data) => Boolean(data.otp) !== Boolean(data.resetToken), {
    message: 'Provide a reset token or OTP', path: ['resetToken'],
  });

/** Body is optional: the refresh token normally travels in the httpOnly cookie. */
export const refreshSchema = z.object({
  refreshToken: z.string().regex(/^[0-9a-f]{96}$/).optional(),
}).default({});

export const logoutSchema = refreshSchema;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

export const listSessionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

export type VerifyResetOtpInput = z.infer<typeof verifyResetOtpSchema>;
