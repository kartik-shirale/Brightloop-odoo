import type { DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
import type { PaymentMethod } from './enums.js';
export interface PaymentListItemDto {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  method: PaymentMethod;
  amount: Paise;
  paymentDate: IsoDateTime;
  reference: string | null;
  note: string | null;
  recordedById: number | null;
  recordedByName: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export type PaymentDto = PaymentListItemDto;
export interface CreatePaymentRequest {
  invoiceId: number;
  method: PaymentMethod;
  amount: Paise;
  paymentDate: DateInput;
  reference?: string | null;
  note?: string | null;
}
export interface UpdatePaymentRequest { reference?: string | null; note?: string | null }
export interface ListPaymentsQuery extends ListQuery<'paymentDate' | 'amount' | 'createdAt'> {
  invoiceId?: number;
  customerId?: number;
  method?: PaymentMethod[];
  paidFrom?: DateInput;
  paidTo?: DateInput;
  minAmount?: Paise;
  maxAmount?: Paise;
}
