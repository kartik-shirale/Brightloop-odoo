import {
  BarChart3, CreditCard, FileText, LayoutDashboard, Package, RefreshCw, Repeat, UserRound, Users,
  type LucideIcon,
} from 'lucide-react';
import type { RoleDto } from '@brightloop/shared';
import { ADMIN_ONLY, CUSTOMER_ONLY, STAFF_ROLES } from '@/constants/roles';
import { ROUTES } from '@/constants/routes';

export interface NavLinkItem { label: string; href: string; allowedRoles: readonly RoleDto[] }
export interface NavItem extends NavLinkItem { icon: LucideIcon; children?: readonly NavLinkItem[] }
export interface NavGroup { label?: string; items: readonly NavItem[] }

/** Main group first, ordered by how often staff use it; reference data under "Manage". */
export const STAFF_NAVIGATION: readonly NavGroup[] = [
  {
    items: [
      { label: 'Overview', href: ROUTES.DASHBOARD, icon: LayoutDashboard, allowedRoles: STAFF_ROLES },
      { label: 'Subscriptions', href: ROUTES.SUBSCRIPTIONS.LIST, icon: Repeat, allowedRoles: STAFF_ROLES },
      { label: 'Customers', href: ROUTES.CUSTOMERS.LIST, icon: Users, allowedRoles: STAFF_ROLES },
      { label: 'Invoices', href: ROUTES.INVOICES.LIST, icon: FileText, allowedRoles: STAFF_ROLES },
      { label: 'Payments', href: ROUTES.PAYMENTS, icon: CreditCard, allowedRoles: STAFF_ROLES },
      { label: 'Reports', href: ROUTES.REPORTS.SUMMARY, icon: BarChart3, allowedRoles: STAFF_ROLES },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Billing runs', href: ROUTES.BILLING_RUNS.LIST, icon: RefreshCw, allowedRoles: STAFF_ROLES },
      {
        label: 'Catalog', href: ROUTES.PRODUCTS.LIST, icon: Package, allowedRoles: STAFF_ROLES,
        children: [
          { label: 'Products', href: ROUTES.PRODUCTS.LIST, allowedRoles: STAFF_ROLES },
          { label: 'Plans', href: ROUTES.PLANS.LIST, allowedRoles: STAFF_ROLES },
          { label: 'Templates', href: ROUTES.TEMPLATES.LIST, allowedRoles: STAFF_ROLES },
          { label: 'Discounts', href: ROUTES.DISCOUNTS.LIST, allowedRoles: STAFF_ROLES },
          { label: 'Taxes', href: ROUTES.TAXES, allowedRoles: STAFF_ROLES },
          { label: 'Payment terms', href: ROUTES.PAYMENT_TERMS, allowedRoles: STAFF_ROLES },
        ],
      },
    ],
  },
];

/** Admin pages live in the account menu in the sidebar footer, not in the sidebar itself. */
export const STAFF_ACCOUNT_LINKS: readonly NavLinkItem[] = [
  { label: 'Account security', href: ROUTES.ACCOUNT, allowedRoles: STAFF_ROLES },
  { label: 'Staff', href: ROUTES.STAFF, allowedRoles: ADMIN_ONLY },
  { label: 'Audit logs', href: ROUTES.AUDIT_LOGS, allowedRoles: ADMIN_ONLY },
];

export const PORTAL_NAVIGATION: readonly NavGroup[] = [
  {
    items: [
      { label: 'Overview', href: ROUTES.PORTAL, icon: LayoutDashboard, allowedRoles: CUSTOMER_ONLY },
      { label: 'Subscriptions', href: ROUTES.PORTAL_SUBSCRIPTIONS.LIST, icon: Repeat, allowedRoles: CUSTOMER_ONLY },
      { label: 'Invoices', href: ROUTES.PORTAL_INVOICES.LIST, icon: FileText, allowedRoles: CUSTOMER_ONLY },
      { label: 'Payments', href: ROUTES.PORTAL_PAYMENTS, icon: CreditCard, allowedRoles: CUSTOMER_ONLY },
      { label: 'Profile', href: ROUTES.PORTAL_PROFILE, icon: UserRound, allowedRoles: CUSTOMER_ONLY },
    ],
  },
];

export const PORTAL_ACCOUNT_LINKS: readonly NavLinkItem[] = [
  { label: 'Security', href: ROUTES.PORTAL_SECURITY, allowedRoles: CUSTOMER_ONLY },
];

/**
 * Every link, flattened, for page titles in the header. Children come before their parent so a
 * child sharing the parent's href ("Products" under "Catalog") supplies the title.
 */
export function flattenNavigation(groups: readonly NavGroup[]): NavLinkItem[] {
  return groups.flatMap(group => group.items.flatMap(item => [...(item.children ?? []), item]));
}
