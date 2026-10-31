import { getHomeRoute } from '@/constants/roles';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UseFormSetError } from 'react-hook-form';
import type { VerifyResetOtpResultDto } from '@brightloop/shared';
import { authApi } from '@/api/auth';
import { MESSAGES } from '@/constants/messages';
import { useAuth } from '@/hooks/auth/use-auth';
import { useApiAction } from '@/hooks/auth/use-api-action';
import { useCountdown } from '@/hooks/auth/use-countdown';
import { isApiFailure } from '@/lib/errors';
import type { OtpFormValues } from '@/components/forms/otp/schema';
interface OtpOptions {
  email: string;
  purpose: 'verify' | 'reset';
  onVerified?: (result: VerifyResetOtpResultDto) => void;
  setError: UseFormSetError<OtpFormValues>;
}
export function useOtp({ email, purpose, onVerified, setError }: OtpOptions): {
  verify: ReturnType<typeof useApiAction<OtpFormValues>>;
  resend: ReturnType<typeof useApiAction<Record<string, never>>>;
  seconds: number;
  resendCode: () => Promise<void>;
} {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const { seconds, restart } = useCountdown();
  const verifyAction = useCallback(async (values: OtpFormValues) => {
    if (purpose === 'reset') {
      const grant = await authApi.verifyResetOtp({ email, otp: values.otp });
      onVerified?.(grant);
    } else {
      const session = await authApi.verifyOtp({ email, otp: values.otp });
      setSession(session);
      navigate(getHomeRoute(session.user.role), { replace: true });
    }
  }, [email, purpose, onVerified, setSession, navigate]);
  const resendAction = useCallback(async () => {
    try {
      if (purpose === 'reset') await authApi.forgotPassword({ email });
      else await authApi.resendOtp({ email });
      restart();
    } catch (error) {
      if (isApiFailure(error) && error.retryAfter) restart(error.retryAfter);
      throw error;
    }
  }, [email, purpose, restart]);
  const verify = useApiAction(verifyAction, purpose === 'reset' ? MESSAGES.CODE_VERIFIED : MESSAGES.VERIFIED, setError);
  const resend = useApiAction<Record<string, never>>(resendAction, MESSAGES.OTP_SENT);
  const { submit: resendSubmit } = resend;
  const resendCode = useCallback(async () => { if (seconds === 0) await resendSubmit({}); }, [seconds, resendSubmit]);
  return { verify, resend, seconds, resendCode };
}
