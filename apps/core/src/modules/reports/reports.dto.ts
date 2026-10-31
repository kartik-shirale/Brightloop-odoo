import type { AgingDto, ExpiringSubscriptionDto, OverdueInvoiceDto } from '@brightloop/shared';
import { startOfUtcDay } from '../../core/utils/dates.js';
import type { AgingRow, ExpiringSubscriptionRow, OverdueInvoiceRow } from './reports.repository.js';

const DAY_MS = 86_400_000;

const isoOf = (value: string): string => new Date(value).toISOString();

/** Whole days from the start of the due date's day to business today; 0 when not yet past due. */
export function daysOverdueOn(dueDate: string | Date, today: Date): number {
  const due = startOfUtcDay(new Date(dueDate)).getTime();
  const days = Math.round((today.getTime() - due) / DAY_MS);
  return days > 0 ? days : 0;
}

export type AgingBucket = keyof AgingDto;

/** The aging bucket for an outstanding invoice. Mirrors the cut-offs the repository applies in SQL. */
export function agingBucketFor(dueDate: string | Date, today: Date): AgingBucket {
  const days = daysOverdueOn(dueDate, today);
  if (days === 0) return 'notDue';
  if (days <= 30) return 'days1To30';
  if (days <= 60) return 'days31To60';
  if (days <= 90) return 'days61To90';
  return 'over90';
}

export function toAgingDto(row: AgingRow): AgingDto {
  return {
    notDue: { count: row.notDueCount, amount: row.notDueAmount },
    days1To30: { count: row.d1To30Count, amount: row.d1To30Amount },
    days31To60: { count: row.d31To60Count, amount: row.d31To60Amount },
    days61To90: { count: row.d61To90Count, amount: row.d61To90Amount },
    over90: { count: row.over90Count, amount: row.over90Amount },
  };
}

export function toOverdueInvoiceDto(row: OverdueInvoiceRow, today: Date): OverdueInvoiceDto {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.customerName,
    subscriptionId: row.subscriptionId,
    subscriptionNumber: row.subscriptionNumber,
    dueDate: isoOf(row.dueDate),
    total: row.total,
    amountPaid: row.amountPaid,
    amountDue: row.amountDue,
    daysOverdue: daysOverdueOn(row.dueDate, today),
  };
}

export function toExpiringSubscriptionDto(row: ExpiringSubscriptionRow): ExpiringSubscriptionDto {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.customerName,
    planId: row.planId,
    planName: row.planName,
    status: 'ACTIVE',
    expiryDate: isoOf(row.expiryDate),
    nextBillingDate: row.nextBillingDate === null ? null : isoOf(row.nextBillingDate),
    recurringAmount: row.recurringAmount,
    autoClose: row.autoClose,
  };
}
