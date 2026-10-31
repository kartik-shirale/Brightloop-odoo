import { useCallback, useEffect, useState } from 'react';
import { client } from '@/api/client';
import type { ApiSuccess, PaginationMeta } from '@brightloop/shared';
import { getErrorMessage, isApiFailure } from '@/lib/errors';
export function useResource<T>(path: string, query = '', enabled = true): { data: T | null; meta: PaginationMeta | undefined; isLoading: boolean; error: string | null; status: number; refetch: () => void } {
 const [data, setData] = useState<T | null>(null);
 const [meta, setMeta] = useState<PaginationMeta>();
 const [isLoading, setLoading] = useState(enabled);
 const [error, setError] = useState<string | null>(null);
 const [status, setStatus] = useState(0);
 const [revision, setRevision] = useState(0);
 const refetch = useCallback(() => setRevision(n => n + 1), []);
 useEffect(() => {
  const controller = new AbortController();
  if (!enabled) { setLoading(false); return; }
  setLoading(true); setError(null); setData(null);
  async function load(): Promise<void> {
   try { const response = await client.get<ApiSuccess<T>>(path, { params: new URLSearchParams(query), signal: controller.signal });
    if (!controller.signal.aborted) { setData(response.data.data); setMeta(response.data.meta); setStatus(200); }
   } catch (failure) { if (!controller.signal.aborted) { setError(getErrorMessage(failure)); setStatus(isApiFailure(failure) ? failure.status : 0); } }
   finally { if (!controller.signal.aborted) setLoading(false); }
  }
  void load(); return () => controller.abort();
 }, [path, query, enabled, revision]);
 return { data, meta, isLoading, error, status, refetch };
}
