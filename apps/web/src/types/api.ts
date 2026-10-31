import type { PaginationMeta, ValidationErrorDetail } from '@brightloop/shared';

export interface ListResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface NormalizedApiError {
  message: string;
  status: number;
  code: string;
  details: ValidationErrorDetail[];
  retryAfter?: number;
}

export type QueryScalar = string | number | boolean | null | undefined;
export type QueryValue = QueryScalar | readonly QueryScalar[];
