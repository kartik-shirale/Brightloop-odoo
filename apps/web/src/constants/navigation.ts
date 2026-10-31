import { Role } from '@/constants/roles';
import { ROUTES } from '@/constants/routes';
export const NAVIGATION = [{ label: 'Overview', href: ROUTES.DASHBOARD, allowedRoles: [Role.ADMIN, Role.STAFF] }] as const;
export const PORTAL_NAVIGATION = [{ label: 'Overview', href: ROUTES.PORTAL, allowedRoles: [Role.CUSTOMER] }] as const;
