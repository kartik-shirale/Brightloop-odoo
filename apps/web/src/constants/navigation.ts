import { ADMIN_ONLY, CUSTOMER_ONLY, STAFF_ROLES } from '@/constants/roles';
import { ROUTES } from '@/constants/routes';

const OVERVIEW_NAVIGATION_ITEM = {
  label: 'Overview', href: ROUTES.DASHBOARD, allowedRoles: STAFF_ROLES, group: 'Overview',
} as const;

export const STAFF_NAVIGATION = [
  OVERVIEW_NAVIGATION_ITEM,
  { label: 'Customers', href: ROUTES.CUSTOMERS.LIST, allowedRoles: STAFF_ROLES, group: 'Sales' },
  { label: 'Subscriptions', href: ROUTES.SUBSCRIPTIONS.LIST, allowedRoles: STAFF_ROLES, group: 'Sales' },
  { label: 'Invoices', href: ROUTES.INVOICES.LIST, allowedRoles: STAFF_ROLES, group: 'Billing' },
  { label: 'Payments', href: ROUTES.PAYMENTS, allowedRoles: STAFF_ROLES, group: 'Billing' },
  { label: 'Billing runs', href: ROUTES.BILLING_RUNS.LIST, allowedRoles: STAFF_ROLES, group: 'Billing' },
  { label: 'Reports', href: ROUTES.REPORTS.SUMMARY, allowedRoles: STAFF_ROLES, group: 'Reports' },
  { label: 'Products', href: ROUTES.PRODUCTS.LIST, allowedRoles: STAFF_ROLES, group: 'Catalog' },
  { label: 'Plans', href: ROUTES.PLANS.LIST, allowedRoles: STAFF_ROLES, group: 'Catalog' },
  { label: 'Templates', href: ROUTES.TEMPLATES.LIST, allowedRoles: STAFF_ROLES, group: 'Catalog' },
  { label: 'Discounts', href: ROUTES.DISCOUNTS.LIST, allowedRoles: STAFF_ROLES, group: 'Catalog' },
  { label: 'Taxes', href: ROUTES.TAXES, allowedRoles: STAFF_ROLES, group: 'Catalog' },
  { label: 'Payment terms', href: ROUTES.PAYMENT_TERMS, allowedRoles: STAFF_ROLES, group: 'Catalog' },
  { label: 'Staff', href: ROUTES.STAFF, allowedRoles: ADMIN_ONLY, group: 'Admin' },
  { label: 'Audit logs', href: ROUTES.AUDIT_LOGS, allowedRoles: ADMIN_ONLY, group: 'Admin' },
] as const;

// The current header has only the overview route; FE-F5 will consume the full sidebar definition.
export const NAVIGATION = [OVERVIEW_NAVIGATION_ITEM] as const;

export const PORTAL_NAVIGATION = [
  { label: 'Overview', href: ROUTES.PORTAL, allowedRoles: CUSTOMER_ONLY },
  { label: 'Subscriptions', href: ROUTES.PORTAL_SUBSCRIPTIONS.LIST, allowedRoles: CUSTOMER_ONLY },
  { label: 'Invoices', href: ROUTES.PORTAL_INVOICES.LIST, allowedRoles: CUSTOMER_ONLY },
  { label: 'Payments', href: ROUTES.PORTAL_PAYMENTS, allowedRoles: CUSTOMER_ONLY },
  { label: 'Profile', href: ROUTES.PORTAL_PROFILE, allowedRoles: CUSTOMER_ONLY },
] as const;
