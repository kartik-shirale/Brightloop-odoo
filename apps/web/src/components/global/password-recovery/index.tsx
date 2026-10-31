import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ForgotPasswordForm } from '@/components/forms/forgot-password';
import { OtpForm } from '@/components/forms/otp';
import { ResetPasswordForm } from '@/components/forms/reset-password';
import { Button } from '@/components/ui/button';
import { usePasswordRecovery } from '@/hooks/auth/use-password-recovery';
import { ROUTES } from '@/constants/routes';
export function PasswordRecovery(): React.JSX.Element {
  const { step, onSent, onVerified, restart } = usePasswordRecovery();
  return <>{step.kind === 'email' && <ForgotPasswordForm onSent={onSent} />}
    {step.kind === 'otp' && <OtpForm email={step.email} purpose="reset" onVerified={onVerified} />}
    {step.kind === 'reset' && <ResetPasswordForm email={step.email} resetToken={step.resetToken} />}
    <div className="mt-7 flex items-center justify-center gap-4 text-sm">
      <Link to={ROUTES.LOGIN} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to sign in</Link>
      {step.kind !== 'email' && <Button type="button" variant="link" onClick={restart}>Start over</Button>}
    </div></>;
}
