import type { SequenceKey } from '@brightloop/shared';
import { prisma } from '../../config/prisma.js';
import { allocateSequenceValue, type AllocatedSequence } from '../../core/utils/sequence-sql.js';

export class SequencesRepository {
  /** One atomic statement: no read-then-write gap, so parallel callers never share a number. */
  async allocate(key: SequenceKey, year: number): Promise<AllocatedSequence> {
    return allocateSequenceValue(prisma, key, year);
  }
}
