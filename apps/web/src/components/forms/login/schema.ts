import { z } from 'zod';
import { emailSchema } from '@/lib/auth-validation';
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(72) });
export type LoginFormValues = z.infer<typeof loginSchema>;
