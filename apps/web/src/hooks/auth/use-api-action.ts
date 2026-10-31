import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import { applyFieldErrors, getErrorMessage } from '@/lib/errors';
export function useApiAction<T extends FieldValues>(action: (values: T) => Promise<void>, successMessage: string,
  setError?: UseFormSetError<T>): { submit: (values: T) => Promise<void>; isLoading: boolean; error: string | null } {
  const locked = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setFailure] = useState<string | null>(null);
  const submit = useCallback(async (values: T) => {
    if (locked.current) return;
    locked.current = true;
    setIsLoading(true);
    setFailure(null);
    try { await action(values); toast.success(successMessage); }
    catch (failure) {
      const message = getErrorMessage(failure);
      setFailure(message);
      if (setError) applyFieldErrors(failure, setError);
      toast.error(message);
    } finally { locked.current = false; setIsLoading(false); }
  }, [action, successMessage, setError]);
  return useMemo(() => ({ submit, isLoading, error }), [submit, isLoading, error]);
}
