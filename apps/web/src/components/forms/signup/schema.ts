import { z } from 'zod';
import { emailSchema, passwordSchema, confirmPasswords, confirmOptions } from '@/lib/auth-validation';
export const signupSchema = z.object({ username: z.string().trim().min(3, 'Use at least 3 characters').max(40).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, underscores or hyphens'), email: emailSchema, password: passwordSchema, confirmPassword: z.string() }).refine(confirmPasswords, confirmOptions);
export type SignupFormValues = z.infer<typeof signupSchema>;
