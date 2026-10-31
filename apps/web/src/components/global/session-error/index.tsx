import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/auth/use-auth';
export function SessionError(): React.JSX.Element {
  const { error, retrySession, isLoading } = useAuth();
  return <div className="mx-auto my-12 grid max-w-sm gap-4 p-6"><Alert variant="destructive"><AlertTitle>Connection interrupted</AlertTitle><AlertDescription>{error}</AlertDescription></Alert><Button onClick={retrySession} disabled={isLoading}>Retry connection</Button></div>;
}
