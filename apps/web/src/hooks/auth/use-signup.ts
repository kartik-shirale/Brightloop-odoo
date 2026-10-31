import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UseFormSetError } from 'react-hook-form';
import { authApi } from '@/api/auth';
import { ROUTES } from '@/constants/routes';
import { MESSAGES } from '@/constants/messages';
import { useApiAction } from '@/hooks/auth/use-api-action';
import type { SignupFormValues } from '@/components/forms/signup/schema';
export function useSignup(setError: UseFormSetError<SignupFormValues>): ReturnType<typeof useApiAction<SignupFormValues>> {
  const navigate = useNavigate();
  const action = useCallback(async (values: SignupFormValues) => {
    const result = await authApi.signup({ ...values, name: values.username });
    navigate(ROUTES.VERIFY_OTP, { state: { email: result.email } });
  }, [navigate]);
  return useApiAction(action, MESSAGES.OTP_SENT, setError);
}
