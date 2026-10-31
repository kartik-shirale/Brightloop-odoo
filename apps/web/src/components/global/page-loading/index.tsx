import { Skeleton } from '@/components/ui/skeleton';
/** Shown while the session is restored; a skeleton of the sign-in column, no spinner. */
export function PageLoading(): React.JSX.Element {
  return <div className="flex min-h-svh items-center justify-center bg-background p-4" role="status" aria-label="Restoring your session">
    <div className="flex w-full max-w-sm flex-col gap-4"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><span className="sr-only">Loading your workspace</span></div></div>;
}
