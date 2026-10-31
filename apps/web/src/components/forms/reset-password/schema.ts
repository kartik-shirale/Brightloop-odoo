import { z } from 'zod';
import { passwordSchema, confirmPasswords, confirmOptions } from '@/lib/auth-validation';
export const resetPasswordSchema = z.object({ password: passwordSchema, confirmPassword: z.string() }).refine(confirmPasswords, confirmOptions);
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
