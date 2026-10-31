import type { CustomerDto, CustomerListItemDto, CustomerSummaryDto } from '@brightloop/shared';
import type { CustomerRecord, CustomerSnapshot } from './customers.gateway.js';
import type { CustomerRow, CustomerSummaryRow } from './customers.repository.js';

export const EMPTY_SUMMARY: CustomerSummaryDto = { activeSubscriptions: 0, outstandingAmount: 0, overdueCount: 0 };

export function toSummaryDto(row: CustomerSummaryRow | undefined): CustomerSummaryDto {
  return row === undefined ? { ...EMPTY_SUMMARY } : {
    activeSubscriptions: row.activeSubscriptions,
    outstandingAmount: row.outstandingAmount,
    overdueCount: row.overdueCount,
  };
}

export function toCustomerListItemDto(row: CustomerRow, summary?: CustomerSummaryDto): CustomerListItemDto {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    companyName: row.companyName,
    email: row.email,
    phone: row.phone,
    taxId: row.taxId,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(summary === undefined ? {} : { summary }),
  };
}

export function toCustomerDto(row: CustomerRow, summary: CustomerSummaryDto): CustomerDto {
  return { ...toCustomerListItemDto(row), summary };
}

export function toCustomerRecord(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    companyName: row.companyName,
    email: row.email,
    phone: row.phone,
    taxId: row.taxId,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
  };
}

export function toCustomerSnapshot(row: CustomerRow): CustomerSnapshot {
  const address = [row.addressLine1, row.addressLine2, row.city, row.state, row.postalCode, row.country]
    .filter((part): part is string => part !== null && part.trim().length > 0);
  return {
    name: row.name,
    email: row.email,
    taxId: row.taxId,
    billingAddress: address.length === 0 ? null : address.join(', '),
  };
}
