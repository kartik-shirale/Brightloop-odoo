import { Role, type RoleDto } from '@brightloop/shared';
import { ROUTES } from '@/constants/routes';
export { Role };
export const STAFF_ROLES = [Role.ADMIN, Role.STAFF] as const;
export const ADMIN_ONLY = [Role.ADMIN] as const;
export const CUSTOMER_ONLY = [Role.CUSTOMER] as const;
export function getHomeRoute(role: RoleDto): string { return role === Role.CUSTOMER ? ROUTES.PORTAL : ROUTES.DASHBOARD; }
