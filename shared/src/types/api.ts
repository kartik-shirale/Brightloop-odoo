/**
 * API contracts shared between `@odoo/core` and `@odoo/web`.
 * Add request/response payloads, DTOs, and route types here.
 */

/** Response of `GET /api/health`. */
export interface HealthResponse {
  ok: boolean;
  service: string;
  timestamp: string;
}

/** Standard error envelope for failed API calls. */
export interface ApiError {
  error: string;
  status: number;
}
