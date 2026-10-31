import type { BillingRunDto, BillingRunItemDto } from '@brightloop/shared';
import type { BillingRunItemRow, BillingRunRow, ItemNames } from './billing-runs.repository.js';

const isoOf = (value: string): string => new Date(value).toISOString();
const isoOrNull = (value: string | null): string | null => (value === null ? null : isoOf(value));

export function toBillingRunDto(row: BillingRunRow, userNames: ReadonlyMap<number, string>): BillingRunDto {
  return {
    id: row.id,
    runDate: isoOf(row.runDate),
    status: row.status,
    triggeredById: row.triggeredById,
    triggeredByName: row.triggeredById === null ? null : userNames.get(row.triggeredById) ?? null,
    totalDue: row.totalDue,
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    startedAt: isoOf(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  };
}

export function toBillingRunItemDto(row: BillingRunItemRow, names: ItemNames): BillingRunItemDto {
  return {
    id: row.id,
    billingRunId: row.billingRunId,
    subscriptionId: row.subscriptionId,
    subscriptionNumber: names.subscriptions.get(row.subscriptionId) ?? '',
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceId === null ? null : names.invoices.get(row.invoiceId) ?? null,
    status: row.status,
    message: row.message,
    createdAt: isoOf(row.createdAt),
  };
}
