/**
 * Factories for the domain error codes in backend plan 3.3. Codes come from
 * `@brightloop/shared` so the frontend can branch on the same values.
 */

import { DOMAIN_ERROR_CODES, type DomainErrorCode } from '@brightloop/shared';
import { AppError, notFound } from '../errors.js';

function domainError(status: number, code: DomainErrorCode, message: string, details?: unknown): AppError {
  return new AppError({ status, code, message, details });
}

export const duplicate = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.DUPLICATE, message);

export const inUse = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.IN_USE, message);

export const invalidStateTransition = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.INVALID_STATE_TRANSITION, message);

export const actionNotAllowedByPlan = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.ACTION_NOT_ALLOWED_BY_PLAN, message);

export const planNotAvailable = (message = 'Plan is not available on the requested date'): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.PLAN_NOT_AVAILABLE, message);

export const quotationExpired = (message = 'The quotation has expired'): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.QUOTATION_EXPIRED, message);

export const discountNotApplicable = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.DISCOUNT_NOT_APPLICABLE, message);

export const invoiceNotPayable = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.INVOICE_NOT_PAYABLE, message);

export const overpayment = (message = 'Payment amount exceeds the amount due'): AppError =>
  domainError(400, DOMAIN_ERROR_CODES.OVERPAYMENT, message);

export const billingRunInProgress = (message = 'A billing run for this date is already running'): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.BILLING_RUN_IN_PROGRESS, message);

export const deliveryFailed = (message = 'The email could not be delivered. Please retry.'): AppError =>
  domainError(503, DOMAIN_ERROR_CODES.DELIVERY_FAILED, message);

export const nothingToBill = (message: string): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.NOTHING_TO_BILL, message);

export const alreadyBilled = (message = 'This billing period has already been invoiced'): AppError =>
  domainError(409, DOMAIN_ERROR_CODES.ALREADY_BILLED, message);

export type DbErrorKind = 'unique' | 'foreign-key' | 'not-found';

function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : undefined;
}

/** Classifies a database failure by its Postgres or Prisma code, or returns undefined. */
export function classifyDbError(error: unknown): DbErrorKind | undefined {
  const code = readCode(error);
  if (code === '23505' || code === 'P2002') return 'unique';
  if (code === '23503' || code === 'P2003') return 'foreign-key';
  if (code === 'P2025') return 'not-found';
  return undefined;
}

/**
 * Repositories call this in a catch block. Known database failures become domain
 * errors with a caller-supplied message; anything else is rethrown untouched for
 * the global handler, so raw database errors never reach the client.
 */
export function rethrowDbError(
  error: unknown,
  messages: { unique?: string; foreignKey?: string; notFound?: string },
): never {
  const kind = classifyDbError(error);
  if (kind === 'unique') throw duplicate(messages.unique ?? 'Resource already exists');
  if (kind === 'foreign-key') throw inUse(messages.foreignKey ?? 'Resource is referenced by other records');
  if (kind === 'not-found') throw notFound(messages.notFound ?? 'Resource not found');
  throw error;
}
