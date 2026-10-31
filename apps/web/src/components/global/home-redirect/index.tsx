import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/auth/use-auth';
import { getHomeRoute } from '@/constants/roles';
import { ROUTES } from '@/constants/routes';
export function HomeRedirect(): React.JSX.Element { const { role } = useAuth(); return <Navigate to={role ? getHomeRoute(role) : ROUTES.LOGIN} replace />; }
