import type { PaymentDto, PaymentListItemDto } from '@brightloop/shared';
import type { PaymentRecord } from './payments.repository.js';

export function toPaymentListItemDto(row: PaymentRecord): PaymentListItemDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId,
    customerName: row.customerName,
    method: row.method,
    amount: row.amount,
    paymentDate: row.paymentDate,
    reference: row.reference,
    note: row.note,
    recordedById: row.recordedById,
    recordedByName: row.recordedByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const toPaymentDto = (row: PaymentRecord): PaymentDto => toPaymentListItemDto(row);
