import { Navigate, Link } from 'react-router-dom';
import { OtpForm } from '@/components/forms/otp';
import { useVerificationEmail } from '@/hooks/auth/use-verification-email';
import { ROUTES } from '@/constants/routes';
export default function VerifyOtpPage(): React.JSX.Element {
  const email = useVerificationEmail();
  if (!email) return <Navigate to={ROUTES.SIGNUP} replace />;
  return <><OtpForm email={email} purpose="verify" /><p className="mt-5 text-center text-sm text-muted-foreground"><Link className="underline underline-offset-4" to={ROUTES.LOGIN}>Back to sign in</Link></p></>;
}
