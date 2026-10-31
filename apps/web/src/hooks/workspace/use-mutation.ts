import { useCallback, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import type { ApiEndpoint } from '@brightloop/shared';
import { mutateResource } from '@/api/workspace';
import { getErrorMessage, isApiFailure } from '@/lib/errors';
export function useMutation(onSuccess: (data: unknown) => void): { busy: boolean; error: string | null; fields: Record<string,string>; submit: (endpoint: ApiEndpoint, body: unknown, id?: string) => Promise<void> } {
 const lock = useRef(false); const [busy,setBusy] = useState(false); const [error,setError] = useState<string | null>(null); const [fields,setFields] = useState<Record<string,string>>({});
 const submit = useCallback(async (endpoint: ApiEndpoint, body: unknown, id?: string) => {
  if (lock.current) return; lock.current = true; setBusy(true); setError(null); setFields({});
  try { const data = await mutateResource(endpoint,body,id); toast.success('Saved successfully'); onSuccess(data); }
  catch(failure) { const message = getErrorMessage(failure); setError(message); if(isApiFailure(failure)) setFields(Object.fromEntries(failure.details.map(d => [d.field,d.message]))); toast.error(message); }
  finally { lock.current = false; setBusy(false); }
 },[onSuccess]); return {busy,error,fields,submit};
}
