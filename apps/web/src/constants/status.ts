import type { BillingRunItemStatus, BillingRunStatus, DiscountState, InvoiceStatus, SubscriptionStatus } from '@brightloop/shared';
import type { StatusPresentation } from '@/types/status';

export const SUBSCRIPTION_STATUS = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  QUOTATION: { label: 'Quotation', variant: 'secondary' },
  CONFIRMED: { label: 'Confirmed', variant: 'secondary' },
  ACTIVE: { label: 'Active', variant: 'default' },
  PAUSED: { label: 'Paused', variant: 'outline' },
  CLOSED: { label: 'Closed', variant: 'secondary' },
} as const satisfies Record<SubscriptionStatus, StatusPresentation>;

export const INVOICE_STATUS = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  CONFIRMED: { label: 'Confirmed', variant: 'secondary' },
  PAID: { label: 'Paid', variant: 'default' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
} as const satisfies Record<InvoiceStatus, StatusPresentation>;

export const BILLING_RUN_STATUS = {
  RUNNING: { label: 'Running', variant: 'secondary' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  PARTIAL: { label: 'Partial', variant: 'outline' },
  FAILED: { label: 'Failed', variant: 'destructive' },
} as const satisfies Record<BillingRunStatus, StatusPresentation>;

export const BILLING_RUN_ITEM_STATUS = {
  CREATED: { label: 'Created', variant: 'default' },
  SKIPPED: { label: 'Skipped', variant: 'secondary' },
  FAILED: { label: 'Failed', variant: 'destructive' },
} as const satisfies Record<BillingRunItemStatus, StatusPresentation>;

export const DISCOUNT_STATE = {
  upcoming: { label: 'Upcoming', variant: 'outline' },
  active: { label: 'Active', variant: 'default' },
  expired: { label: 'Expired', variant: 'secondary' },
  exhausted: { label: 'Exhausted', variant: 'destructive' },
} as const satisfies Record<DiscountState, StatusPresentation>;
