import { APP_NAME } from '@/constants/app';
import { getHomeRoute } from '@/constants/roles';
import { GalleryVerticalEnd, LogOut } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ErrorFallback } from '@/components/global/error-fallback';
import { NAVIGATION } from '@/constants/navigation';
import { ROUTES } from '@/constants/routes';
import { useAuth } from '@/hooks/auth/use-auth';
import { useLogout } from '@/hooks/auth/use-logout';
export function DashboardLayout(): React.JSX.Element {
  const { user, hasRole, role } = useAuth();
  const { logout, isLoading } = useLogout();
  return <div className="min-h-svh bg-muted/30"><header className="border-b bg-background"><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-6 py-5">
    <Link to={role ? getHomeRoute(role) : ROUTES.LOGIN} className="flex items-center gap-2.5 text-xl font-semibold"><GalleryVerticalEnd className="size-6" />{APP_NAME}</Link>
    <nav className="ml-4 flex flex-1 gap-5 text-sm">{NAVIGATION.filter((item) => hasRole(...item.allowedRoles)).map((item) => <Link key={item.href} to={item.href} className="font-medium">{item.label}</Link>)}</nav>
    <Badge variant="secondary">{user?.role.toLowerCase()}</Badge><Button variant="outline" onClick={logout} disabled={isLoading} aria-busy={isLoading}>{isLoading ? <Spinner /> : <LogOut />}Sign out</Button>
  </div></header><main className="mx-auto max-w-6xl px-6 py-12"><ErrorBoundary FallbackComponent={ErrorFallback}><Outlet /></ErrorBoundary></main></div>;
}
