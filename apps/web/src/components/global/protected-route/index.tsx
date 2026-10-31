import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/auth/use-auth';
import { PageLoading } from '@/components/global/page-loading';
import { SessionError } from '@/components/global/session-error';
import { ROUTES } from '@/constants/routes';
export function ProtectedRoute(): React.JSX.Element {
  const { isLoading, isAuthenticated, error } = useAuth();
  if (isLoading) return <PageLoading />;
  if (error) return <SessionError />;
  return isAuthenticated ? <Outlet /> : <Navigate to={ROUTES.LOGIN} replace />;
}
