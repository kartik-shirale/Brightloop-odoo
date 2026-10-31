import { useCallback } from 'react';
import type { UseFormSetError } from 'react-hook-form';
import { authApi } from '@/api/auth';
import { MESSAGES } from '@/constants/messages';
import { useApiAction } from '@/hooks/auth/use-api-action';
import type { ForgotPasswordFormValues } from '@/components/forms/forgot-password/schema';
export function useForgotPassword(onSent: (email: string) => void, setError: UseFormSetError<ForgotPasswordFormValues>): ReturnType<typeof useApiAction<ForgotPasswordFormValues>> {
  const action = useCallback(async (values: ForgotPasswordFormValues) => { await authApi.forgotPassword(values); onSent(values.email); }, [onSent]);
  return useApiAction(action, MESSAGES.OTP_SENT, setError);
}
