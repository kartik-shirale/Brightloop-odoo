import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@brightloop/shared';
import { cn } from '@/lib/utils';
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
} from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_PAGE_LINKS, PAGE_SIZE_OPTIONS } from '@/constants/pagination';

interface DataPaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

type PageSlot = number | 'gap-start' | 'gap-end';

/** At most MAX_PAGE_LINKS numbered links, with ellipses where pages are skipped. */
function pageSlots(page: number, totalPages: number): PageSlot[] {
  if (totalPages <= MAX_PAGE_LINKS) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const inner = MAX_PAGE_LINKS - 2;
  const start = Math.min(Math.max(page - Math.floor(inner / 2), 2), totalPages - inner);
  const middle = Array.from({ length: inner }, (_, index) => start + index);
  return [
    1,
    ...(start > 2 ? (['gap-start'] as const) : []),
    ...middle,
    ...(start + inner < totalPages ? (['gap-end'] as const) : []),
    totalPages,
  ];
}

/** Table footer: "Showing a-b of n" on the left, rows-per-page and page links on the right. */
export function DataPagination({ meta, onPageChange, onLimitChange }: DataPaginationProps): React.JSX.Element {
  const totalPages = Math.max(meta.totalPages, 1);
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);
  const go = (target: number) => (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    if (target >= 1 && target <= totalPages && target !== meta.page) onPageChange(target);
  };
  const edge = (disabled: boolean): string => cn(disabled && 'pointer-events-none opacity-50');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs text-muted-foreground">Showing {first}-{last} of {meta.total}</p>
      <div className="flex items-center gap-3">
        <Select value={String(meta.limit)} onValueChange={value => onLimitChange(Number(value))}>
          <SelectTrigger size="sm" aria-label="Rows per page" className="w-18"><SelectValue /></SelectTrigger>
          <SelectContent>{PAGE_SIZE_OPTIONS.map(size => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
        </Select>
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationLink href="#" aria-label="Previous page" aria-disabled={!meta.hasPrev} className={edge(!meta.hasPrev)} onClick={go(meta.page - 1)}><ChevronLeft /></PaginationLink>
            </PaginationItem>
            {pageSlots(meta.page, totalPages).map(slot => (
              <PaginationItem key={slot}>
                {typeof slot === 'number'
                  ? <PaginationLink href="#" isActive={slot === meta.page} onClick={go(slot)}>{slot}</PaginationLink>
                  : <PaginationEllipsis />}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationLink href="#" aria-label="Next page" aria-disabled={!meta.hasNext} className={edge(!meta.hasNext)} onClick={go(meta.page + 1)}><ChevronRight /></PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
