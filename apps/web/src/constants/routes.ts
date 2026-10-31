export const ROUTE_PATHS = {
  HOME: '/', LOGIN: '/login', SIGNUP: '/signup', VERIFY_OTP: '/verify-otp',
  FORGOT_PASSWORD: '/forgot-password', DASHBOARD: '/dashboard', PORTAL: '/portal',
  FORBIDDEN: '/403', NOT_FOUND: '*',
  CUSTOMERS: { LIST: '/customers', NEW: '/customers/new', DETAIL: '/customers/:id', EDIT: '/customers/:id/edit' },
  SUBSCRIPTIONS: {
    LIST: '/subscriptions', NEW: '/subscriptions/new', FROM_TEMPLATE: '/subscriptions/from-template',
    DETAIL: '/subscriptions/:id', EDIT: '/subscriptions/:id/edit',
  },
  INVOICES: { LIST: '/invoices', DETAIL: '/invoices/:id', PRINT: '/invoices/:id/print' },
  PAYMENTS: '/payments',
  BILLING_RUNS: { LIST: '/billing-runs', DETAIL: '/billing-runs/:id' },
  REPORTS: {
    SUMMARY: '/reports', REVENUE: '/reports/revenue', PAYMENTS: '/reports/payments',
    OVERDUE: '/reports/overdue', AGING: '/reports/aging', RENEWALS: '/reports/renewals',
  },
  PRODUCTS: { LIST: '/catalog/products', NEW: '/catalog/products/new', DETAIL: '/catalog/products/:id', EDIT: '/catalog/products/:id/edit' },
  PLANS: { LIST: '/catalog/plans', NEW: '/catalog/plans/new', DETAIL: '/catalog/plans/:id', EDIT: '/catalog/plans/:id/edit' },
  TEMPLATES: { LIST: '/catalog/templates', NEW: '/catalog/templates/new', DETAIL: '/catalog/templates/:id', EDIT: '/catalog/templates/:id/edit' },
  DISCOUNTS: { LIST: '/catalog/discounts', NEW: '/catalog/discounts/new', DETAIL: '/catalog/discounts/:id', EDIT: '/catalog/discounts/:id/edit' },
  TAXES: '/catalog/taxes', PAYMENT_TERMS: '/catalog/payment-terms',
  STAFF: '/admin/staff', AUDIT_LOGS: '/admin/audit-logs',
  PORTAL_SUBSCRIPTIONS: { LIST: '/portal/subscriptions', DETAIL: '/portal/subscriptions/:id' },
  PORTAL_INVOICES: { LIST: '/portal/invoices', DETAIL: '/portal/invoices/:id', PRINT: '/portal/invoices/:id/print' },
  PORTAL_PAYMENTS: '/portal/payments', PORTAL_PROFILE: '/portal/profile',
  ACCOUNT: '/account', PORTAL_SECURITY: '/portal/security',
} as const;

function recordRoute(pattern: string, id: number): string {
  return pattern.replace(':id', String(id));
}

export const ROUTES = {
  HOME: ROUTE_PATHS.HOME,
  LOGIN: ROUTE_PATHS.LOGIN,
  SIGNUP: ROUTE_PATHS.SIGNUP,
  VERIFY_OTP: ROUTE_PATHS.VERIFY_OTP,
  FORGOT_PASSWORD: ROUTE_PATHS.FORGOT_PASSWORD,
  DASHBOARD: ROUTE_PATHS.DASHBOARD,
  PORTAL: ROUTE_PATHS.PORTAL,
  FORBIDDEN: ROUTE_PATHS.FORBIDDEN,
  CUSTOMERS: {
    LIST: ROUTE_PATHS.CUSTOMERS.LIST, NEW: ROUTE_PATHS.CUSTOMERS.NEW,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.CUSTOMERS.DETAIL, id),
    EDIT: (id: number): string => recordRoute(ROUTE_PATHS.CUSTOMERS.EDIT, id),
  },
  SUBSCRIPTIONS: {
    LIST: ROUTE_PATHS.SUBSCRIPTIONS.LIST, NEW: ROUTE_PATHS.SUBSCRIPTIONS.NEW,
    FROM_TEMPLATE: ROUTE_PATHS.SUBSCRIPTIONS.FROM_TEMPLATE,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.SUBSCRIPTIONS.DETAIL, id),
    EDIT: (id: number): string => recordRoute(ROUTE_PATHS.SUBSCRIPTIONS.EDIT, id),
  },
  INVOICES: {
    LIST: ROUTE_PATHS.INVOICES.LIST,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.INVOICES.DETAIL, id),
    PRINT: (id: number): string => recordRoute(ROUTE_PATHS.INVOICES.PRINT, id),
  },
  PAYMENTS: ROUTE_PATHS.PAYMENTS,
  BILLING_RUNS: {
    LIST: ROUTE_PATHS.BILLING_RUNS.LIST,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.BILLING_RUNS.DETAIL, id),
  },
  REPORTS: ROUTE_PATHS.REPORTS,
  PRODUCTS: {
    LIST: ROUTE_PATHS.PRODUCTS.LIST, NEW: ROUTE_PATHS.PRODUCTS.NEW,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.PRODUCTS.DETAIL, id),
    EDIT: (id: number): string => recordRoute(ROUTE_PATHS.PRODUCTS.EDIT, id),
  },
  PLANS: {
    LIST: ROUTE_PATHS.PLANS.LIST, NEW: ROUTE_PATHS.PLANS.NEW,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.PLANS.DETAIL, id),
    EDIT: (id: number): string => recordRoute(ROUTE_PATHS.PLANS.EDIT, id),
  },
  TEMPLATES: {
    LIST: ROUTE_PATHS.TEMPLATES.LIST, NEW: ROUTE_PATHS.TEMPLATES.NEW,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.TEMPLATES.DETAIL, id),
    EDIT: (id: number): string => recordRoute(ROUTE_PATHS.TEMPLATES.EDIT, id),
  },
  DISCOUNTS: {
    LIST: ROUTE_PATHS.DISCOUNTS.LIST, NEW: ROUTE_PATHS.DISCOUNTS.NEW,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.DISCOUNTS.DETAIL, id),
    EDIT: (id: number): string => recordRoute(ROUTE_PATHS.DISCOUNTS.EDIT, id),
  },
  TAXES: ROUTE_PATHS.TAXES, PAYMENT_TERMS: ROUTE_PATHS.PAYMENT_TERMS,
  STAFF: ROUTE_PATHS.STAFF, AUDIT_LOGS: ROUTE_PATHS.AUDIT_LOGS,
  PORTAL_SUBSCRIPTIONS: {
    LIST: ROUTE_PATHS.PORTAL_SUBSCRIPTIONS.LIST,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.PORTAL_SUBSCRIPTIONS.DETAIL, id),
  },
  PORTAL_INVOICES: {
    LIST: ROUTE_PATHS.PORTAL_INVOICES.LIST,
    DETAIL: (id: number): string => recordRoute(ROUTE_PATHS.PORTAL_INVOICES.DETAIL, id),
    PRINT: (id: number): string => recordRoute(ROUTE_PATHS.PORTAL_INVOICES.PRINT, id),
  },
  PORTAL_PAYMENTS: ROUTE_PATHS.PORTAL_PAYMENTS, PORTAL_PROFILE: ROUTE_PATHS.PORTAL_PROFILE,
  ACCOUNT: ROUTE_PATHS.ACCOUNT, PORTAL_SECURITY: ROUTE_PATHS.PORTAL_SECURITY,
} as const;

/** Staff detail page for a nested record key in an API response (`customer`, `plan`, ...). */
export const RELATED_RECORD_ROUTES: Readonly<Partial<Record<string, (id: number) => string>>> = {
  customer: ROUTES.CUSTOMERS.DETAIL,
  plan: (id: number): string => recordRoute(ROUTE_PATHS.PLANS.DETAIL, id),
  template: (id: number): string => recordRoute(ROUTE_PATHS.TEMPLATES.DETAIL, id),
  product: (id: number): string => recordRoute(ROUTE_PATHS.PRODUCTS.DETAIL, id),
  subscription: ROUTES.SUBSCRIPTIONS.DETAIL,
  renewedFrom: ROUTES.SUBSCRIPTIONS.DETAIL,
};
