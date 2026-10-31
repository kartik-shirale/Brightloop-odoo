import { z } from 'zod';
import { emailSchema } from '@/lib/auth-validation';
export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
