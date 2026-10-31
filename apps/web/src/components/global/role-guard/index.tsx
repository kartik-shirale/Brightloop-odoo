import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import type { RoleDto } from '@brightloop/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAuth } from '@/hooks/auth/use-auth';
import { getHomeRoute } from '@/constants/roles';
interface RoleGuardProps { roles: readonly RoleDto[]; children?: ReactNode; redirect?: boolean }
export function RoleGuard({ roles, children, redirect = false }: RoleGuardProps): React.JSX.Element {
  const { hasRole, role } = useAuth();
  if (!hasRole(...roles)) {
    if (redirect && role) return <Navigate to={getHomeRoute(role)} replace />;
    return <Alert><AlertTitle>Access restricted</AlertTitle><AlertDescription>This area is not available for your role.</AlertDescription></Alert>;
  }
  return children ? <>{children}</> : <Outlet />;
}
