/**
 * Real-database checks for the sequence statement. Run with `bun run test:db`
 * (needs DATABASE_URL). The test snapshots the SUBSCRIPTION counter row, works
 * on it, and restores the original state afterwards (or deletes the row when it
 * did not exist), so existing numbering is left as it was found.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { SequenceKey } from '@brightloop/shared';
import { prisma } from '../../config/prisma.js';
import { SequencesRepository } from './sequences.repository.js';
import { SequencesService } from './sequences.service.js';

const KEY = SequenceKey.SUBSCRIPTION;
const original = await prisma.orm.public.NumberSequence.whereUnique({ key: KEY }).first();

async function restore(): Promise<void> {
  if (original === null) {
    await prisma.orm.public.NumberSequence.where((row) => row.key.eq(KEY)).deleteAll();
  } else {
    await prisma.orm.public.NumberSequence.whereUnique({ key: KEY }).update({
      year: original.year, lastValue: original.lastValue,
    });
  }
}

after(async () => {
  await restore();
  await prisma.close();
});

test('50 parallel calls give 50 unique, consecutive numbers', async () => {
  await restore();
  const service = new SequencesService(new SequencesRepository(), () => new Date('2031-03-01T00:00:00Z'));
  const numbers = await Promise.all(Array.from({ length: 50 }, () => service.next(KEY)));
  assert.equal(new Set(numbers).size, 50);
  const sorted = [...numbers].sort();
  assert.equal(sorted[0], 'SUB-2031-000001');
  assert.equal(sorted[49], 'SUB-2031-000050');
});

test('a new year restarts at 1 and an older clock never moves the series back', async () => {
  const repository = new SequencesRepository();
  assert.deepEqual(await repository.allocate(KEY, 2032), { value: 1, year: 2032 });
  assert.deepEqual(await repository.allocate(KEY, 2032), { value: 2, year: 2032 });
  assert.deepEqual(await repository.allocate(KEY, 2031), { value: 3, year: 2032 });
});

test('a rolled-back transaction releases its number', async () => {
  await restore();
  const repository = new SequencesRepository();
  await repository.allocate(KEY, 2033);
  await assert.rejects(prisma.transaction(async (tx) => {
    const { allocateSequenceValue } = await import('../../core/utils/sequence-sql.js');
    const inside = await allocateSequenceValue(tx, KEY, 2033);
    assert.equal(inside.value, 2);
    throw new Error('rollback');
  }), /rollback/);
  assert.deepEqual(await repository.allocate(KEY, 2033), { value: 2, year: 2033 });
});
