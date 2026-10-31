import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UseFormSetError } from 'react-hook-form';
import { authApi } from '@/api/auth';
import { ROUTES } from '@/constants/routes';
import { MESSAGES } from '@/constants/messages';
import { useApiAction } from '@/hooks/auth/use-api-action';
import type { ResetPasswordFormValues } from '@/components/forms/reset-password/schema';
export function useResetPassword(email: string, resetToken: string, setError: UseFormSetError<ResetPasswordFormValues>): ReturnType<typeof useApiAction<ResetPasswordFormValues>> {
  const navigate = useNavigate();
  const action = useCallback(async (values: ResetPasswordFormValues) => {
    await authApi.resetPassword({ email, resetToken, ...values });
    navigate(ROUTES.LOGIN, { replace: true });
  }, [email, resetToken, navigate]);
  return useApiAction(action, MESSAGES.PASSWORD_CHANGED, setError);
}
