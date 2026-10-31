export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 100;
/** Most page links shown at once in the pagination control. */
export const MAX_PAGE_LINKS = 5;
/** Skeleton rows never exceed this, whatever the page size. */
export const MAX_SKELETON_ROWS = 8;
