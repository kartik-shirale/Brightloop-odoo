import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/auth/use-auth';
import { ROUTES } from '@/constants/routes';
export function useLogout(): { logout: () => Promise<void>; isLoading: boolean } {
  const { logout: signOut } = useAuth();
  const navigate = useNavigate();
  const busy = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const logout = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setIsLoading(true);
    try { await signOut(); navigate(ROUTES.LOGIN, { replace: true }); }
    catch { /* AuthProvider reports failure and preserves the session for retry. */ }
    finally { busy.current = false; setIsLoading(false); }
  }, [signOut, navigate]);
  return { logout, isLoading };
}
