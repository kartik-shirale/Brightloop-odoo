import { Layers } from 'lucide-react';
import { Navigate, Outlet } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '@/components/global/error-fallback';
import { ModeToggle } from '@/components/global/mode-toggle';
import { PageLoading } from '@/components/global/page-loading';
import { SessionError } from '@/components/global/session-error';
import { useAuth } from '@/hooks/auth/use-auth';
import { APP_NAME } from '@/constants/app';
import { getHomeRoute } from '@/constants/roles';
import { CONFIG } from '@/constants/config';
import { ROUTES } from '@/constants/routes';

export function AuthLayout(): React.JSX.Element {
  const { isLoading, isAuthenticated, error, role } = useAuth();
  if (isLoading) return <PageLoading />;
  if (isAuthenticated) return <Navigate to={role ? getHomeRoute(role) : ROUTES.LOGIN} replace />;
  return <main className="grid min-h-svh bg-background lg:grid-cols-2">
    <section className="flex flex-col p-4 md:p-6">
      <div className="flex items-center justify-between">
        <a href={ROUTES.LOGIN} className="flex items-center gap-2 text-sm font-medium" aria-label={`${APP_NAME} sign in`}><Layers className="size-4 text-muted-foreground" />{APP_NAME}</a>
        <ModeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center py-12"><div className="w-full max-w-sm">
        {error && <SessionError />}<ErrorBoundary FallbackComponent={ErrorFallback}><Outlet /></ErrorBoundary>
      </div></div>
      <footer className="text-xs text-muted-foreground">© {new Date().getFullYear()} {APP_NAME}</footer>
    </section>
    <aside className="hidden p-4 lg:block">
      <img src={CONFIG.COVER_IMAGE} alt="Alpine mountains reflected in a calm lake" className="h-full w-full rounded-md object-cover" fetchPriority="high" />
    </aside>
  </main>;
}
