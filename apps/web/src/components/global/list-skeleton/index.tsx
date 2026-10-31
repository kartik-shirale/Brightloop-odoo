import { Skeleton } from '@/components/ui/skeleton';

interface ListSkeletonProps {
  rows?: number;
  /** `grid` mirrors a label/value detail grid; `rows` mirrors a bordered list of items. */
  variant?: 'rows' | 'grid';
}

export function ListSkeleton({ rows = 6, variant = 'rows' }: ListSkeletonProps): React.JSX.Element {
  const keys = Array.from({ length: rows }, (_, index) => `l${index}`);
  if (variant === 'grid') {
    return (
      <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map(key => <div key={key} className="flex flex-col gap-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-32" /></div>)}
      </div>
    );
  }
  return (
    <div aria-busy="true" className="divide-y">
      {keys.map(key => <div key={key} className="flex h-14 items-center justify-between gap-4"><div className="flex flex-col gap-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div><Skeleton className="h-8 w-16" /></div>)}
    </div>
  );
}
