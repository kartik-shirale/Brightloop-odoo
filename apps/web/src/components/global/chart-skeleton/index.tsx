import { Skeleton } from '@/components/ui/skeleton';

/** Same fixed height as the charts (h-60) so nothing below moves when data arrives. */
export function ChartSkeleton(): React.JSX.Element {
  return <Skeleton aria-busy="true" className="h-60 w-full" />;
}
