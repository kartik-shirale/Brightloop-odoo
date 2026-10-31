import { useCallback, useEffect, useMemo, useState } from 'react';
import { AUTH_LIMITS } from '@/constants/messages';
export function useCountdown(): { seconds: number; restart: (seconds?: number) => void } {
  const [deadline, setDeadline] = useState(() => Date.now() + AUTH_LIMITS.RESEND_SECONDS * 1000);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const restart = useCallback((seconds: number = AUTH_LIMITS.RESEND_SECONDS) => { const time = Date.now(); setNow(time); setDeadline(time + seconds * 1000); }, []);
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return useMemo(() => ({ seconds, restart }), [seconds, restart]);
}
