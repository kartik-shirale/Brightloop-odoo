import type { ErrorCode } from './error-codes.js';

/** JSON numbers, never formatted currency. Runtime schemas enforce integer/range limits. */
export type Paise = number;
/** 18% = 1800. */
export type BasisPoints = number;
/** UTC ISO 8601 timestamp in responses; never a JavaScript Date. */
export type IsoDateTime = string;
/** YYYY-MM-DD accepted on business-date inputs; normalized to UTC by the server. */
export type IsoDate = string;
export type DateInput = IsoDate | IsoDateTime;
export type SortOrder = 'asc' | 'desc';
export interface DateRange { from?: DateInput; to?: DateInput }
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
export interface ListQuery<S extends string> {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: S;
  sortOrder?: SortOrder;
}
export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}
export interface ApiListSuccess<T> extends ApiSuccess<T[]> { meta: PaginationMeta }
/** Existing message-only actions and planned deletes omit data altogether. */
export interface ApiMessageSuccess { success: true; message: string; data?: never }
export interface ValidationErrorDetail { field: string; message: string }
/** Includes diagnostic details already emitted by the existing global error handler/mailer. */
export type ApiFailureError =
  | { code: Exclude<ErrorCode, 'INTERNAL_ERROR' | 'EMAIL_DELIVERY_FAILED'>; details?: ValidationErrorDetail[] }
  | { code: 'INTERNAL_ERROR'; details?: { fingerprint: string } }
  | { code: 'EMAIL_DELIVERY_FAILED'; details?: { providerStatus: number; reason: string } };
export interface ApiFailure {
  success: false;
  message: string;
  error: ApiFailureError;
}
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
export type ApiListResult<T> = ApiListSuccess<T> | ApiFailure;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Shared writable fields, deliberately excludes userId and internal customer notes. */
export interface AddressInput {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}
export interface AddressDto {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}
