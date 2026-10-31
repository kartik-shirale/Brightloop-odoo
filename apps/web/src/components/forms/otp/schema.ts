import { z } from 'zod';
export const otpSchema = z.object({ otp: z.string().regex(/^\d{6}$/, 'Enter the six-digit code') });
export type OtpFormValues = z.infer<typeof otpSchema>;
