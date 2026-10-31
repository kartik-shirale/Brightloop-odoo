/** Schema enum values mirrored as portable constants; no generated-client dependency. */
export const Role = { CUSTOMER: 'CUSTOMER', STAFF: 'STAFF', ADMIN: 'ADMIN' } as const;
export type Role = typeof Role[keyof typeof Role];
export const ProductType = { SERVICE: 'SERVICE', SOFTWARE: 'SOFTWARE', ADDON: 'ADDON', PHYSICAL: 'PHYSICAL' } as const;
export type ProductType = typeof ProductType[keyof typeof ProductType];
export const BillingPeriod = { DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', YEARLY: 'YEARLY' } as const;
export type BillingPeriod = typeof BillingPeriod[keyof typeof BillingPeriod];
export const TaxType = { PERCENTAGE: 'PERCENTAGE', FIXED: 'FIXED' } as const;
export type TaxType = typeof TaxType[keyof typeof TaxType];
export const DiscountType = { FIXED: 'FIXED', PERCENTAGE: 'PERCENTAGE' } as const;
export type DiscountType = typeof DiscountType[keyof typeof DiscountType];
export const DiscountScope = { PRODUCT: 'PRODUCT', SUBSCRIPTION: 'SUBSCRIPTION' } as const;
export type DiscountScope = typeof DiscountScope[keyof typeof DiscountScope];
export const SubscriptionStatus = { DRAFT: 'DRAFT', QUOTATION: 'QUOTATION', CONFIRMED: 'CONFIRMED', ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', CLOSED: 'CLOSED' } as const;
export type SubscriptionStatus = typeof SubscriptionStatus[keyof typeof SubscriptionStatus];
export const InvoiceStatus = { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', PAID: 'PAID', CANCELLED: 'CANCELLED' } as const;
export type InvoiceStatus = typeof InvoiceStatus[keyof typeof InvoiceStatus];
export const PaymentMethod = { CASH: 'CASH', BANK_TRANSFER: 'BANK_TRANSFER', CARD: 'CARD', UPI: 'UPI', CHEQUE: 'CHEQUE', ONLINE: 'ONLINE', OTHER: 'OTHER' } as const;
export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];
export const BillingRunStatus = { RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', PARTIAL: 'PARTIAL', FAILED: 'FAILED' } as const;
export type BillingRunStatus = typeof BillingRunStatus[keyof typeof BillingRunStatus];
export const BillingRunItemStatus = { CREATED: 'CREATED', SKIPPED: 'SKIPPED', FAILED: 'FAILED' } as const;
export type BillingRunItemStatus = typeof BillingRunItemStatus[keyof typeof BillingRunItemStatus];
export const SequenceKey = { SUBSCRIPTION: 'SUBSCRIPTION', INVOICE: 'INVOICE' } as const;
export type SequenceKey = typeof SequenceKey[keyof typeof SequenceKey];
/** API-only enum, not a database column. */
export const SubscriptionAction = { EDIT: 'EDIT', DELETE: 'DELETE', SEND_QUOTATION: 'SEND_QUOTATION', CONFIRM: 'CONFIRM', ACTIVATE: 'ACTIVATE', PAUSE: 'PAUSE', RESUME: 'RESUME', CLOSE: 'CLOSE', RENEW: 'RENEW', GENERATE_INVOICE: 'GENERATE_INVOICE' } as const;
export type SubscriptionAction = typeof SubscriptionAction[keyof typeof SubscriptionAction];
/** API-only enum, not a database column. */
export const InvoiceAction = { EDIT: 'EDIT', CONFIRM: 'CONFIRM', CANCEL: 'CANCEL', SEND: 'SEND', RECORD_PAYMENT: 'RECORD_PAYMENT', PRINT: 'PRINT' } as const;
export type InvoiceAction = typeof InvoiceAction[keyof typeof InvoiceAction];
/** API-only enum, not a database column. */
export const DiscountState = { UPCOMING: 'upcoming', ACTIVE: 'active', EXPIRED: 'expired', EXHAUSTED: 'exhausted' } as const;
export type DiscountState = typeof DiscountState[keyof typeof DiscountState];
/** API-only enum, not a database column. */
export const ReportInterval = { DAY: 'day', WEEK: 'week', MONTH: 'month' } as const;
export type ReportInterval = typeof ReportInterval[keyof typeof ReportInterval];
