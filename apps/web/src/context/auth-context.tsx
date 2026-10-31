import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthResult } from '@brightloop/shared';
import { toast } from 'react-toastify';
import { authApi } from '@/api/auth';
import { restoreSession } from '@/api/client';
import { getSession, publishSession, subscribeSession } from '@/api/session';
import { MESSAGES } from '@/constants/messages';
import { getErrorMessage, isApiFailure } from '@/lib/errors';
import type { AuthContextValue } from '@/types/auth';

import { AuthContext } from '@/context/auth-context-value';
export { AuthContext } from '@/context/auth-context-value';
interface AuthProviderProps { children: ReactNode }
export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retrySession = useCallback(() => { setIsLoading(true); setError(null); setAttempt((value) => value + 1); }, []);
  const setSession = useCallback((value: AuthResult | null) => { publishSession(value); setError(null); }, []);
  useEffect(() => {
    let active = true;
    async function initialize(): Promise<void> {
      try { await restoreSession(); }
      catch (failure) {
        if (active && (!isApiFailure(failure) || failure.status !== 401)) setError(getErrorMessage(failure));
      } finally { if (active) setIsLoading(false); }
    }
    void initialize();
    return () => { active = false; };
  }, [attempt]);
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
      publishSession(null);
      toast.success(MESSAGES.SIGNED_OUT);
    } catch (failure) {
      if (isApiFailure(failure) && failure.status === 401) publishSession(null);
      toast.error(getErrorMessage(failure));
      throw failure;
    }
  }, []);
  const value = useMemo<AuthContextValue>(() => ({ user: session?.user ?? null, role: session?.user.role ?? null,
    isAuthenticated: session !== null, isLoading, error, setSession, logout, retrySession }),
  [session, isLoading, error, setSession, logout, retrySession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
