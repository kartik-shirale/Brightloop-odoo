/**
 * Pagination helpers (backend-rules.md rules 3/12).
 */

import type { ListMeta } from '@brightloop/shared';

export const MAX_PAGE_SIZE = 100;

export const offsetFor = (page: number, limit: number): number => (page - 1) * limit;

export function listMetaFor(total: number, page: number, limit: number): ListMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1 && total > 0,
  };
}
