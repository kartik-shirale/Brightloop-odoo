import type { Actor } from '../../core/utils/actor.js';

export interface GenerateInvoiceOptions {
  autoConfirm?: boolean;
  billingRunId?: number | null;
  /** The acting user, or null for system work (billing run, scheduler). */
  actor: Actor | null;
}

export type GenerateInvoiceOutcome =
  | { status: 'CREATED'; invoiceId: number; number: string }
  | { status: 'SKIPPED'; reason: 'NOTHING_TO_BILL' | 'ALREADY_BILLED'; message: string };

export interface InvoicesGateway {
  /**
   * Bills ONE period of a subscription (the one starting at its `nextBillingDate`) in a
   * single transaction. A caller that must catch up loops until it gets SKIPPED.
   * Throws on unexpected errors; expected non-events are returned as SKIPPED.
   */
  generateForSubscription(
    subscriptionId: number,
    asOf: Date,
    opts: GenerateInvoiceOptions,
  ): Promise<GenerateInvoiceOutcome>;
}
