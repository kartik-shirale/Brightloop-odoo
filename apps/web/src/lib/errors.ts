import { isAxiosError } from 'axios';
import type { DomainErrorCode, ValidationErrorDetail } from '@brightloop/shared';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import { DOMAIN_ERROR_MESSAGES, MESSAGES } from '@/constants/messages';
import { applyServerErrors } from '@/lib/apply-server-errors';
import type { NormalizedApiError } from '@/types/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidationDetail(value: unknown): value is ValidationErrorDetail {
  return isRecord(value) && typeof value.field === 'string' && typeof value.message === 'string';
}

export function isApiFailure(error: unknown): error is NormalizedApiError {
  return isRecord(error) && typeof error.status === 'number' && Number.isFinite(error.status)
    && typeof error.message === 'string' && typeof error.code === 'string'
    && Array.isArray(error.details) && error.details.every(isValidationDetail)
    && (error.retryAfter === undefined || (typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter)));
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (isApiFailure(error)) return error;
  if (!isAxiosError<unknown>(error)) return { message: MESSAGES.ERROR, status: 0, code: 'UNKNOWN', details: [] };
  const response = error.response;
  const body = isRecord(response?.data) ? response.data : undefined;
  const failure = isRecord(body?.error) ? body.error : undefined;
  const status = response?.status ?? 0;
  const code = typeof failure?.code === 'string' ? failure.code : error.code ?? 'REQUEST_FAILED';
  const details = Array.isArray(failure?.details) ? failure.details.filter(isValidationDetail) : [];
  let message = typeof body?.message === 'string' && body.message ? body.message : MESSAGES.ERROR;
  if (!response) message = MESSAGES.NETWORK;
  if (status >= 500 && code !== 'EMAIL_DELIVERY_FAILED') message = MESSAGES.ERROR;
  if (status === 429 && !body?.message) message = MESSAGES.RETRY;
  const retryAfter = Number(response?.headers['retry-after']);
  return { message, status, code, details,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined };
}

function isDomainErrorCode(code: string): code is DomainErrorCode {
  return Object.hasOwn(DOMAIN_ERROR_MESSAGES, code);
}

export function getErrorMessage(error: unknown): string {
  const failure = normalizeApiError(error);
  return isDomainErrorCode(failure.code) ? DOMAIN_ERROR_MESSAGES[failure.code] : failure.message;
}

export function applyFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): void {
  applyServerErrors(normalizeApiError(error).details, setError);
}
