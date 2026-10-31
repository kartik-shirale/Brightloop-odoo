import type { ValidationErrorDetail } from '@brightloop/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

export function applyServerErrors<T extends FieldValues>(
  details: readonly ValidationErrorDetail[],
  setError: UseFormSetError<T>,
): void {
  for (const detail of details) {
    // Backend paths are dynamic (including array indices); field-level schemas remain the authority.
    const field = (detail.field.trim() || 'root.server') as Path<T>;
    setError(field, { type: 'server', message: detail.message });
  }
}
