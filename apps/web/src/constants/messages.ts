import type { DomainErrorCode } from '@brightloop/shared';

export const MESSAGES = {
  OTP_SENT: 'OTP sent to your email', VERIFIED: 'Email verified. Welcome aboard!',
  SIGNED_IN: 'Welcome back', SIGNED_OUT: 'You have been signed out',
  CODE_VERIFIED: 'Code verified. Choose your new password', PASSWORD_CHANGED: 'Password changed successfully',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  ERROR: 'Something went wrong. Please try again.', NETWORK: 'Cannot reach the server. Please try again.',
  RETRY: 'Too many requests. Please wait before trying again.',
} as const;
export const AUTH_LIMITS = { OTP_LENGTH: 6, RESEND_SECONDS: 60, PASSWORD_MIN: 9, PASSWORD_MAX_BYTES: 72 } as const;

export const DOMAIN_ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Check the highlighted fields and try again.',
  NOT_FOUND: 'The requested record could not be found.',
  DUPLICATE: 'A record with these details already exists.',
  IN_USE: 'This record is in use. Deactivate it where available instead of deleting it.',
  INVALID_STATE_TRANSITION: 'This action is unavailable in the current status. Refresh the record and try again.',
  ACTION_NOT_ALLOWED_BY_PLAN: 'The subscription plan does not allow this action.',
  PLAN_NOT_AVAILABLE: 'The plan is not available on the selected start date.',
  QUOTATION_EXPIRED: 'This quotation has expired and can no longer be confirmed.',
  DISCOUNT_NOT_APPLICABLE: 'This discount is inactive, expired, exhausted, or does not apply.',
  INVOICE_NOT_PAYABLE: 'This invoice cannot accept a payment. Refresh it to see its current status.',
  OVERPAYMENT: 'The payment amount exceeds the invoice amount due.',
  BILLING_RUN_IN_PROGRESS: 'A billing run for this date is already running.',
  DELIVERY_FAILED: 'The invoice could not be sent. Please try again.',
  NOTHING_TO_BILL: 'There are no periods due for billing on the selected date.',
  ALREADY_BILLED: 'This billing period has already been invoiced.',
} as const satisfies Record<DomainErrorCode, string>;
