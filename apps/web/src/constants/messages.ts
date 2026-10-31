export const MESSAGES = {
  OTP_SENT: 'OTP sent to your email', VERIFIED: 'Email verified. Welcome aboard!',
  SIGNED_IN: 'Welcome back', SIGNED_OUT: 'You have been signed out',
  CODE_VERIFIED: 'Code verified. Choose your new password', PASSWORD_CHANGED: 'Password changed successfully',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  ERROR: 'Something went wrong. Please try again.', NETWORK: 'Cannot reach the server. Please try again.',
  RETRY: 'Too many requests. Please wait before trying again.',
} as const;
export const AUTH_LIMITS = { OTP_LENGTH: 6, RESEND_SECONDS: 60, PASSWORD_MIN: 9, PASSWORD_MAX_BYTES: 72 } as const;
