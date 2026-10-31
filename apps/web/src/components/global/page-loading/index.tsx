import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
export function PageLoading(): React.JSX.Element {
  return <div className="flex min-h-svh items-center justify-center bg-background p-6" role="status" aria-label="Restoring your session">
    <div className="w-full max-w-sm space-y-6"><Spinner className="size-6" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-11 w-full" /><span className="sr-only">Loading your workspace</span></div></div>;
}
