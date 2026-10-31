/**
 * HTTP error taxonomy (backend-rules.md #5).
 *
 * Feature code throws these; the global error handler maps anything else to a
 * 500 with the same shape.
 */

export interface AppErrorPayload {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  /** Seconds until the client may retry (429 only). */
  readonly retryAfterSeconds?: number;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryAfterSeconds?: number;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = 'AppError';
    this.status = payload.status;
    this.code = payload.code;
    this.details = payload.details;
    this.retryAfterSeconds = payload.retryAfterSeconds;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError({ status: 400, code: 'BAD_REQUEST', message, details });

export const validationError = (message: string, details?: unknown): AppError =>
  new AppError({ status: 400, code: 'VALIDATION_ERROR', message, details });

export const unauthorized = (code: 'AUTH_REQUIRED' | 'SESSION_REVOKED' | 'SESSION_INVALIDATED' | 'AUTH_EMAIL_NOT_VERIFIED', message: string): AppError =>
  new AppError({ status: 401, code, message });

export const forbidden = (message: string): AppError =>
  new AppError({ status: 403, code: 'FORBIDDEN', message });

/** 403 — the account exists but the e-mail OTP was never verified. */
export const emailNotVerified = (): AppError =>
  new AppError({
    status: 403,
    code: 'AUTH_EMAIL_NOT_VERIFIED',
    message: 'Email is not verified. Check your inbox or request a new OTP at /auth/resend-otp.',
  });

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError({ status: 404, code: 'NOT_FOUND', message });

export const conflict = (code: 'EMAIL_IN_USE' | 'CONFLICT', message: string): AppError =>
  new AppError({ status: 409, code, message });

export const rateLimited = (message: string, retryAfterSeconds?: number): AppError =>
  new AppError({ status: 429, code: 'RATE_LIMITED', message, retryAfterSeconds });

export const serviceUnavailable = (message: string): AppError =>
  new AppError({ status: 503, code: 'SERVICE_UNAVAILABLE', message });
