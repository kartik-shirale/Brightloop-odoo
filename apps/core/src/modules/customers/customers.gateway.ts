import type { AddressDto } from '@brightloop/shared';

/** The customer fields other modules need. Soft-deleted customers are never returned. */
export interface CustomerRecord extends AddressDto {
  id: number;
  userId: number | null;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  taxId: string | null;
}

/** Copied onto an invoice at generation time. `billingAddress` is null when no address field is set. */
export interface CustomerSnapshot {
  name: string;
  email: string;
  taxId: string | null;
  billingAddress: string | null;
}

export interface CustomersGateway {
  /** Null when the customer does not exist or is soft-deleted. */
  getById(id: number): Promise<CustomerRecord | null>;
  /**
   * The customer of a portal user, created on first use from the user's name and
   * email. An unlinked customer with the same email (case-insensitive) is linked
   * instead of duplicated. Safe under parallel calls. Throws 404 for an unknown
   * user and 403 when the linked customer was deleted.
   */
  getOrCreateForUser(userId: number): Promise<CustomerRecord>;
  /** Throws 404 when the customer does not exist or is soft-deleted. */
  snapshot(id: number): Promise<CustomerSnapshot>;
}
