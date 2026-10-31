import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SequenceKey } from '@brightloop/shared';
import { formatSequenceNumber } from '../../core/utils/sequence-sql.js';
import { SequencesRepository } from './sequences.repository.js';
import { SequencesService } from './sequences.service.js';
import type { AllocatedSequence } from '../../core/utils/sequence-sql.js';

class FakeSequencesRepository extends SequencesRepository {
  calls: { key: SequenceKey; year: number }[] = [];
  private counters = new Map<SequenceKey, AllocatedSequence>();

  override async allocate(key: SequenceKey, year: number): Promise<AllocatedSequence> {
    this.calls.push({ key, year });
    const current = this.counters.get(key);
    const next: AllocatedSequence = current === undefined || current.year < year
      ? { value: 1, year }
      : { value: current.value + 1, year: current.year };
    this.counters.set(key, next);
    return next;
  }
}

test('formatSequenceNumber pads to six digits and keeps growing past them', () => {
  assert.equal(formatSequenceNumber(SequenceKey.SUBSCRIPTION, 2026, 123), 'SUB-2026-000123');
  assert.equal(formatSequenceNumber(SequenceKey.INVOICE, 2026, 456), 'INV-2026-000456');
  assert.equal(formatSequenceNumber(SequenceKey.INVOICE, 2026, 1234567), 'INV-2026-1234567');
});

test('next uses the business year and separate counters per key', async () => {
  const repository = new FakeSequencesRepository();
  const service = new SequencesService(repository, () => new Date('2026-06-15T10:00:00Z'));
  assert.equal(await service.next(SequenceKey.SUBSCRIPTION), 'SUB-2026-000001');
  assert.equal(await service.next(SequenceKey.SUBSCRIPTION), 'SUB-2026-000002');
  assert.equal(await service.next(SequenceKey.INVOICE), 'INV-2026-000001');
  assert.deepEqual(repository.calls[0], { key: 'SUBSCRIPTION', year: 2026 });
});

test('year rollover restarts at 1, judged in APP_TIMEZONE not UTC', async () => {
  const repository = new FakeSequencesRepository();
  let now = new Date('2026-12-31T10:00:00Z');
  const service = new SequencesService(repository, () => now);
  assert.equal(await service.next(SequenceKey.INVOICE), 'INV-2026-000001');
  assert.equal(await service.next(SequenceKey.INVOICE), 'INV-2026-000002');
  // 19:00 UTC on 31 Dec is already 1 Jan in Asia/Kolkata.
  now = new Date('2026-12-31T19:00:00Z');
  assert.equal(await service.next(SequenceKey.INVOICE), 'INV-2027-000001');
});
