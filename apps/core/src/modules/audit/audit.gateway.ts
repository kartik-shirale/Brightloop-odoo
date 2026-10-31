import type { Actor } from '../../core/utils/actor.js';

export interface AuditRecordInput {
  /** The acting user, or null for system work such as scheduled jobs. */
  actor: Actor | null;
  /** Dotted verb, for example `invoice.confirm`. */
  action: string;
  /** Model name, for example `Invoice`. */
  entityType: string;
  entityId?: number | null;
  /** Credentials and tokens are redacted before storage. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Consumed by every mutating module. `record` never throws: a failed write is
 * logged and the main operation still succeeds.
 */
export interface AuditGateway {
  record(input: AuditRecordInput): Promise<void>;
}
