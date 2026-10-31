import { Skeleton } from '@/components/ui/skeleton';

interface StatsSkeletonProps { count: number }

/** Mirrors StatRow: one bordered container split into equal cells of label + value. */
export function StatsSkeleton({ count }: StatsSkeletonProps): React.JSX.Element {
  return (
    <div aria-busy="true" className="grid grid-cols-2 divide-border rounded-md border lg:flex lg:divide-x">
      {Array.from({ length: count }, (_, index) => (
        <div key={`s${index}`} className="flex flex-1 flex-col gap-2 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>
  );
}
