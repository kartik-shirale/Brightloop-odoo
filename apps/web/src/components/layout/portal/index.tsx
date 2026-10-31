import { GalleryVerticalEnd, LogOut } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { APP_NAME } from '@/constants/app';
import { ROUTES } from '@/constants/routes';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ErrorFallback } from '@/components/global/error-fallback';
import { useLogout } from '@/hooks/auth/use-logout';
export function PortalLayout(): React.JSX.Element {
  const { logout, isLoading } = useLogout();
  return <div className="min-h-svh bg-muted/30"><header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-5">
    <Link to={ROUTES.PORTAL} className="flex items-center gap-2.5 text-xl font-semibold"><GalleryVerticalEnd className="size-6" />{APP_NAME}</Link>
    <span className="flex-1 text-sm text-muted-foreground">Customer portal</span><Button variant="outline" onClick={logout} disabled={isLoading} aria-busy={isLoading}>{isLoading ? <Spinner /> : <LogOut />}Sign out</Button>
  </div></header><main className="mx-auto max-w-6xl px-6 py-12"><ErrorBoundary FallbackComponent={ErrorFallback}><Outlet /></ErrorBoundary></main></div>;
}
