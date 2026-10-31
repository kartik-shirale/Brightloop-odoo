import { useCallback, useMemo, useState } from 'react';
import type { VerifyResetOtpResultDto } from '@brightloop/shared';
import type { RecoveryStep } from '@/types/auth';
export function usePasswordRecovery(): { step: RecoveryStep; onSent: (email: string) => void; onVerified: (result: VerifyResetOtpResultDto) => void; restart: () => void } {
  const [step, setStep] = useState<RecoveryStep>({ kind: 'email' });
  const onSent = useCallback((email: string) => setStep({ kind: 'otp', email }), []);
  const onVerified = useCallback((result: VerifyResetOtpResultDto) => setStep((current) => current.kind === 'otp' ?
    { kind: 'reset', email: current.email, resetToken: result.resetToken } : current), []);
  const restart = useCallback(() => setStep({ kind: 'email' }), []);
  return useMemo(() => ({ step, onSent, onVerified, restart }), [step, onSent, onVerified, restart]);
}
