import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MAX_SKELETON_ROWS } from '@/constants/pagination';

interface TableSkeletonProps { columns: number; rows?: number }

/** Same header and h-10 rows as DataTable, so the real table replaces it without a shift. */
export function TableSkeleton({ columns, rows = 5 }: TableSkeletonProps): React.JSX.Element {
  const count = Math.min(Math.max(rows, 1), MAX_SKELETON_ROWS);
  const columnKeys = Array.from({ length: Math.max(columns, 1) }, (_, index) => `c${index}`);
  return (
    <Table aria-busy="true" aria-label="Loading">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columnKeys.map(key => <TableHead key={key} className="h-10"><Skeleton className="h-3 w-16" /></TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: count }, (_, row) => (
          <TableRow key={`r${row}`} className="h-10 hover:bg-transparent">
            {columnKeys.map(key => <TableCell key={key} className="py-0"><Skeleton className="h-4 w-3/4" /></TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
