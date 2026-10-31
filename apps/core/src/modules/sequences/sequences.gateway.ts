import type { SequenceKey } from '@brightloop/shared';

/** Allocates the next document number, for example `SUB-2026-000123` or `INV-2026-000456`. */
export interface SequenceGateway {
  next(key: SequenceKey): Promise<string>;
}
