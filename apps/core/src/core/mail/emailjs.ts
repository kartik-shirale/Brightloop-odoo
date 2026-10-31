import { APP_NAME } from '@brightloop/shared';
/**
 * EmailJS REST client (transactional e-mail without owning an SMTP server).
 *
 * EmailJS is browser-first, but exposes a REST endpoint that accepts a
 * private key (`accessToken`) for server-side calls — chosen over nodemailer
 * because the product spec mandates EmailJS and no SMTP relay exists in dev.
 * Template must expose: {{name}}, {{otp}}, {{expiry_minutes}}, {{to_email}}.
 */

import { env } from '../../config/env.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

/** Interface so OTP flows can be unit-tested with a fake mailer. */
export interface OtpMailer {
  sendOtp(input: {
    toEmail: string;
    name: string;
    otp: string;
    expiryMinutes: number;
    kind: string;
  }): Promise<void>;
}

/** Separate interface so invoice sending can be unit-tested with a fake mailer. */
export interface InvoiceMailer {
  sendInvoice(input: {
    toEmail: string;
    name: string;
    invoiceNumber: string;
    /** Display text such as `INR 1,234.56`. */
    total: string;
    dueDate: string;
    portalUrl: string;
  }): Promise<void>;
}

export class EmailJsClient implements OtpMailer, InvoiceMailer {
  /** Sends the invoice summary mail; throws a 503 AppError so the caller can keep the invoice retryable. */
  async sendInvoice(input: {
    toEmail: string;
    name: string;
    invoiceNumber: string;
    total: string;
    dueDate: string;
    portalUrl: string;
  }): Promise<void> {
    if (env.EMAILJS_INVOICE_TEMPLATE_ID === undefined) {
      throw new AppError({ status: 503, code: 'EMAIL_DELIVERY_FAILED',
        message: 'Invoice email is not configured (EMAILJS_INVOICE_TEMPLATE_ID is missing).' });
    }
    const payload = {
      service_id: env.EMAILJS_SERVICE_ID,
      template_id: env.EMAILJS_INVOICE_TEMPLATE_ID,
      user_id: env.EMAILJS_PUBLIC_KEY,
      accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: input.toEmail,
        name: input.name,
        invoice_number: input.invoiceNumber,
        total: input.total,
        due_date: input.dueDate,
        portal_url: input.portalUrl,
      },
    };

    let response: Response;
    try {
      response = await fetch(EMAILJS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      logger.error({ err: error, to: '[redacted]' }, 'emailjs invoice request failed');
      throw new AppError({ status: 503, code: 'EMAIL_DELIVERY_FAILED',
        message: 'Could not reach the email service. Please try again shortly.' });
    }

    if (!response.ok) {
      const reasonText = await response.text();
      const failure = classifyEmailFailure(response.status, reasonText);
      logger.error({ providerStatus: response.status, reason: failure.reason }, 'EmailJS rejected the invoice send');
      throw new AppError({ status: 503, code: 'EMAIL_DELIVERY_FAILED',
        message: env.NODE_ENV === 'production' ? 'Could not send the invoice email. Please try again shortly.' : failure.action,
        details: env.NODE_ENV === 'production' ? undefined : { providerStatus: response.status, reason: failure.reason },
      });
    }

    logger.info({ invoiceNumber: input.invoiceNumber, to: '[redacted]' }, 'invoice email sent');
  }

  /** Sends the OTP mail; throws a 503 AppError so the caller can decide policy. */
  async sendOtp(input: { toEmail: string; name: string; otp: string; expiryMinutes: number; kind: string }): Promise<void> {
    const purpose = input.kind === 'reset' ? 'reset your password' : 'verify your email';
    const payload = {
      service_id: env.EMAILJS_SERVICE_ID,
      template_id: env.EMAILJS_TEMPLATE_ID,
      user_id: env.EMAILJS_PUBLIC_KEY,
      accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: {
        app_name: APP_NAME,
        to_email: input.toEmail,
        name: input.name,
        otp: input.otp,
        expiry_minutes: input.expiryMinutes,
        purpose,
      },
    };

    let response: Response;
    try {
      response = await fetch(EMAILJS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      logger.error({ err: error, to: '[redacted]' }, 'emailjs request failed');
      throw new AppError({ status: 503, code: 'EMAIL_DELIVERY_FAILED',
        message: 'Could not reach the email service. Please try again shortly.' });
    }

    if (!response.ok) {
      const reasonText = await response.text();
      const failure = classifyEmailFailure(response.status, reasonText);
      logger.error({ providerStatus: response.status, reason: failure.reason }, 'EmailJS rejected the send');
      throw new AppError({ status: 503, code: 'EMAIL_DELIVERY_FAILED',
        message: env.NODE_ENV === 'production' ? 'Could not send the verification email. Please try again shortly.' : failure.action,
        details: env.NODE_ENV === 'production' ? undefined : { providerStatus: response.status, reason: failure.reason },
      });
    }

    logger.info({ kind: input.kind, to: '[redacted]' }, 'otp email sent');
  }
}

function classifyEmailFailure(status: number, text: string): { reason: string; action: string } {
  if (/non.?browser|api (?:calls|requests).*disabled/i.test(text)) {
    return { reason: 'SERVER_REQUESTS_DISABLED', action: 'EmailJS blocks server requests. Enable API requests for non-browser applications in EmailJS Account > Security.' };
  }
  if (/recipient.*(?:empty|invalid|corrupt)|(?:empty|invalid).*recipient/i.test(text)) {
    return { reason: 'RECIPIENT_TEMPLATE_INVALID', action: 'EmailJS recipient is missing or invalid. Set the template To Email field to {{to_email}} and save it.' };
  }
  if (/private.?key|access.?token/i.test(text)) {
    return { reason: 'PRIVATE_KEY_INVALID', action: 'EmailJS rejected the private key. Check EMAILJS_PRIVATE_KEY and private-key authorization in Account > Security.' };
  }
  if (/public.?key|user.?id/i.test(text)) {
    return { reason: 'PUBLIC_KEY_INVALID', action: 'EmailJS rejected the public key. Check EMAILJS_PUBLIC_KEY in apps/core/.env.' };
  }
  if (/invalid.?grant|oauth|smtp|gmail_api/i.test(text)) {
    return { reason: 'MAIL_SERVICE_AUTH_FAILED', action: 'EmailJS could not authenticate with the mail provider. Reconnect the email service in the EmailJS dashboard.' };
  }
  if (/template/i.test(text)) {
    return { reason: 'TEMPLATE_INVALID', action: 'EmailJS rejected the template. Check EMAILJS_TEMPLATE_ID and save the OTP template configuration.' };
  }
  if (/service/i.test(text)) {
    return { reason: 'SERVICE_INVALID', action: 'EmailJS rejected the email service. Check EMAILJS_SERVICE_ID and its connection in the dashboard.' };
  }
  if (status === 429 || /quota|limit/i.test(text)) {
    return { reason: 'PROVIDER_LIMIT', action: 'EmailJS rate limit or quota reached. Check your EmailJS usage and try again later.' };
  }
  return { reason: 'PROVIDER_REJECTED', action: 'EmailJS rejected the email. Check server-side API permissions, the connected service, and the OTP template recipient setting.' };
}
