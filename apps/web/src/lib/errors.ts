import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { ApiFailure } from '@/types/auth';
import { MESSAGES } from '@/constants/messages';
export function isApiFailure(error: unknown): error is ApiFailure {
  return typeof error === 'object' && error !== null && 'status' in error && 'message' in error && 'details' in error;
}
export function getErrorMessage(error: unknown): string {
  return isApiFailure(error) ? error.message : MESSAGES.ERROR;
}
export function applyFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): void {
  if (!isApiFailure(error)) return;
  for (const detail of error.details) setError(detail.field as Path<T>, { type: 'server', message: detail.message });
}
