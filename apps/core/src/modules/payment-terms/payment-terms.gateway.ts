/** The payment term fields other modules need when they copy or default a term. */
export interface PaymentTermRecord {
  id: number;
  name: string;
  dueDays: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface PaymentTermsGateway {
  /** Returns the term, or null when it does not exist. Callers decide whether an inactive term is acceptable. */
  getById(id: number): Promise<PaymentTermRecord | null>;
  /** Returns the active default term, or null when none is configured. */
  getDefault(): Promise<PaymentTermRecord | null>;
}
