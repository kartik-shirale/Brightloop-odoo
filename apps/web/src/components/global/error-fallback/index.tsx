import type { FallbackProps } from 'react-error-boundary';

import { Button } from '@/components/ui/button';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function ErrorFallback({ resetErrorBoundary }: FallbackProps): React.JSX.Element {

  return <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6"><Alert variant="destructive"><AlertTitle>We couldn’t open this page</AlertTitle><AlertDescription>Something unexpected happened. Please try again.</AlertDescription></Alert>

    <Button onClick={resetErrorBoundary}>Try again</Button></div>;

}
