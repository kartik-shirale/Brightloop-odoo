import type { AddressDto, AddressInput, DateInput, IsoDateTime, ListQuery, Paise } from './common.js';
export interface CustomerRefDto { id: number; name: string; companyName: string | null; email: string }
export interface CustomerSummaryDto { activeSubscriptions: number; outstandingAmount: Paise; overdueCount: number }
export interface CustomerListItemDto extends CustomerRefDto, AddressDto {
  userId: number | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  summary?: CustomerSummaryDto;
}
export interface CustomerDto extends CustomerListItemDto { summary: CustomerSummaryDto }
export interface CreateCustomerRequest extends AddressInput {
  name: string;
  email: string;
  companyName?: string | null;
  phone?: string | null;
  taxId?: string | null;
  notes?: string | null;
}
export interface UpdateCustomerRequest extends AddressInput {
  name?: string;
  email?: string;
  companyName?: string | null;
  phone?: string | null;
  taxId?: string | null;
  notes?: string | null;
}
export interface ListCustomersQuery extends ListQuery<'name' | 'companyName' | 'createdAt'> {
  hasPortalAccount?: boolean;
  hasOutstanding?: boolean;
  city?: string;
  state?: string;
  createdFrom?: DateInput;
  createdTo?: DateInput;
  include?: 'summary'[];
}
