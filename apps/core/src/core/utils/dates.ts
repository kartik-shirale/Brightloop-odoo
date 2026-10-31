/**
 * The only place date and billing-period arithmetic is defined (backend plan 3.4).
 * Dates are UTC. A date-only value is the UTC midnight of that calendar date.
 * Billing periods are computed from the anchor, never from the previous period,
 * so month ends do not drift (31 Jan, 28 Feb, 31 Mar).
 */

import { BillingPeriod } from '@brightloop/shared';
import { env } from '../../config/env.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isDateOnly(input: string): boolean {
  return DATE_ONLY.test(input);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS - 1);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parses `YYYY-MM-DD` (UTC midnight, or the last millisecond of the day with
 * `endOfDay`) or a full ISO 8601 instant. Returns null for anything invalid.
 */
export function parseDateInput(input: string, options: { endOfDay?: boolean } = {}): Date | null {
  if (isDateOnly(input)) {
    const date = new Date(`${input}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || toIsoDate(date) !== input) return null;
    return options.endOfDay ? endOfUtcDay(date) : date;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(input)) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Adds calendar months to the anchor's day-of-month, clamped to the target month's length. */
function addMonthsFromAnchor(anchor: Date, months: number): Date {
  const total = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

/** Start of billing period number `index` (0 = the anchor itself). */
export function periodStart(anchor: Date, period: BillingPeriod, index: number): Date {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('period index must be a non-negative integer');
  }
  const base = startOfUtcDay(anchor);
  switch (period) {
    case BillingPeriod.DAILY:
      return addDays(base, index);
    case BillingPeriod.WEEKLY:
      return addDays(base, index * 7);
    case BillingPeriod.MONTHLY:
      return addMonthsFromAnchor(base, index);
    case BillingPeriod.YEARLY:
      return addMonthsFromAnchor(base, index * 12);
  }
}

/** Exclusive end of period `index`, which is the start of the next one. */
export function periodEnd(anchor: Date, period: BillingPeriod, index: number): Date {
  return periodStart(anchor, period, index + 1);
}

function estimateIndex(anchor: Date, period: BillingPeriod, date: Date): number {
  const base = startOfUtcDay(anchor);
  const days = Math.floor((startOfUtcDay(date).getTime() - base.getTime()) / DAY_MS);
  switch (period) {
    case BillingPeriod.DAILY:
      return days;
    case BillingPeriod.WEEKLY:
      return Math.floor(days / 7);
    case BillingPeriod.MONTHLY:
      return Math.floor(days / 31);
    case BillingPeriod.YEARLY:
      return Math.floor(days / 366);
  }
}

/** Index of the first period boundary on or after `date` (0 when `date` is not after the anchor). */
export function firstBoundaryIndexOnOrAfter(anchor: Date, period: BillingPeriod, date: Date): number {
  const target = startOfUtcDay(date).getTime();
  if (target <= startOfUtcDay(anchor).getTime()) return 0;
  let index = Math.max(0, estimateIndex(anchor, period, date));
  while (index > 0 && periodStart(anchor, period, index - 1).getTime() >= target) index -= 1;
  while (periodStart(anchor, period, index).getTime() < target) index += 1;
  return index;
}

export function firstBoundaryOnOrAfter(anchor: Date, period: BillingPeriod, date: Date): Date {
  return periodStart(anchor, period, firstBoundaryIndexOnOrAfter(anchor, period, date));
}

/** Index of the period that starts exactly at `date`, or null when `date` is not a boundary. */
export function periodIndexAt(anchor: Date, period: BillingPeriod, date: Date): number | null {
  const index = firstBoundaryIndexOnOrAfter(anchor, period, date);
  return periodStart(anchor, period, index).getTime() === startOfUtcDay(date).getTime() ? index : null;
}

/** The business calendar date in `timeZone`, as UTC midnight of that date. */
export function businessToday(now: Date = new Date(), timeZone: string = env.APP_TIMEZONE): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}
