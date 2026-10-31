import { getHomeRoute } from '@/constants/roles';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UseFormSetError } from 'react-hook-form';
import { authApi } from '@/api/auth';
import { ROUTES } from '@/constants/routes';
import { MESSAGES } from '@/constants/messages';
import { useAuth } from '@/hooks/auth/use-auth';
import { useApiAction } from '@/hooks/auth/use-api-action';
import { isApiFailure } from '@/lib/errors';
import type { LoginFormValues } from '@/components/forms/login/schema';
export function useLogin(setError: UseFormSetError<LoginFormValues>): ReturnType<typeof useApiAction<LoginFormValues>> {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const action = useCallback(async (values: LoginFormValues) => {
    try {
      const session = await authApi.login(values);
      setSession(session);
      navigate(getHomeRoute(session.user.role), { replace: true });
    } catch (error) {
      if (isApiFailure(error) && error.code === 'AUTH_EMAIL_NOT_VERIFIED') navigate(ROUTES.VERIFY_OTP, { state: { email: values.email } });
      throw error;
    }
  }, [setSession, navigate]);
  return useApiAction(action, MESSAGES.SIGNED_IN, setError);
}
