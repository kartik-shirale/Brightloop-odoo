/**
 * API contracts shared between `@odoo/core` and `@odoo/web`.
 * Add request/response payloads, DTOs, and route types here.
 *
 * Every `/api/v1` response follows the envelope mandated by
 * `docs/backend-rules.md`:
 *
 *   success → { success: true, message, data?, meta? }
 *   failure → { success: false, message, error: { code, details? } }
 */

import type { ListMeta } from './list-meta.js';

/** Response of `GET /api/health`. */
export interface HealthResponse {
  ok: boolean;
  service: string;
  timestamp: string;
}

/** Pagination metadata attached to `meta` on list endpoints. */
export type ApiMeta = ListMeta;

/** Machine-readable error code, e.g. `AUTH_INVALID_CREDENTIALS`. */
export interface ApiErrorBody {
  code: string;
  details?: unknown;
}

/** Success envelope. */
export interface ApiResponse<T> {
  success: true;
  message: string;
  data?: T;
  meta?: ApiMeta;
}

/** Failure envelope. */
export interface ApiError {
  success: false;
  message: string;
  error: ApiErrorBody;
}

/** Any API response. */
export type ApiEnvelope<T> = ApiResponse<T> | ApiError;
