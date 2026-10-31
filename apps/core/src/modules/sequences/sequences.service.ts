import type { SequenceKey } from '@brightloop/shared';
import { businessToday } from '../../core/utils/dates.js';
import { formatSequenceNumber } from '../../core/utils/sequence-sql.js';
import type { SequenceGateway } from './sequences.gateway.js';
import type { SequencesRepository } from './sequences.repository.js';

export class SequencesService implements SequenceGateway {
  constructor(
    private readonly repository: SequencesRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Returns the next number for `key`. The year is the business year in
   * APP_TIMEZONE; a new year restarts the series at 1.
   */
  async next(key: SequenceKey): Promise<string> {
    const year = businessToday(this.clock()).getUTCFullYear();
    const allocated = await this.repository.allocate(key, year);
    return formatSequenceNumber(key, allocated.year, allocated.value);
  }
}
