import '../test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BillingRunDto } from '@brightloop/shared';
import type { ScheduledRunResult } from '../../modules/billing-runs/billing-runs.service.js';
import { fixedClock } from '../testing/fakes.js';
import {
  PLAN_ENDED_REASON, startScheduler, stopScheduler, type SchedulerDeps, type SchedulerHandle,
} from './scheduler.js';

const RUN: BillingRunDto = {
  id: 1, runDate: '2026-10-31T00:00:00.000Z', status: 'COMPLETED', triggeredById: null, triggeredByName: null,
  totalDue: 0, createdCount: 0, skippedCount: 0, failedCount: 0,
  startedAt: '2026-10-31T06:00:00.000Z', finishedAt: '2026-10-31T06:00:01.000Z',
};

interface Calls {
  events: string[];
  closed: { id: number; reason: string }[];
  errors: string[];
}

function setup(over: Partial<SchedulerDeps> = {}) {
  // 06:00 UTC on 31 Oct is 11:30 on 31 Oct in Asia/Kolkata.
  const clock = fixedClock('2026-10-31T06:00:00.000Z');
  const calls: Calls = { events: [], closed: [], errors: [] };
  const behaviour = {
    scheduled: [] as (ScheduledRunResult | Error)[],
    recoverError: null as Error | null,
    autoClose: [] as number[],
    closeFails: new Set<number>(),
    autoCloseError: null as Error | null,
  };
  const deps: SchedulerDeps = {
    clock: clock.now,
    enabled: true,
    runHourUtc: 5,
    // Ticks are driven by the test; the real timer never fires during a test.
    intervalMs: 3_600_000,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: (obj: unknown, message?: string) => {
        calls.errors.push(message ?? '');
      },
    } as unknown as NonNullable<SchedulerDeps['logger']>,
    billingRuns: {
      async recoverStuckRuns() {
        calls.events.push('recover');
        if (behaviour.recoverError !== null) throw behaviour.recoverError;
        return 1;
      },
      async runScheduled() {
        calls.events.push(`bill:${clock.now().toISOString().slice(0, 10)}`);
        const next = behaviour.scheduled.shift() ?? { outcome: 'FINISHED', run: RUN };
        if (next instanceof Error) throw next;
        return next;
      },
    },
    subscriptions: {
      async listAutoCloseIds(asOf) {
        calls.events.push(`lifecycle:${asOf.toISOString().slice(0, 10)}`);
        if (behaviour.autoCloseError !== null) throw behaviour.autoCloseError;
        return behaviour.autoClose;
      },
      async closeBySystem(id, reason) {
        if (behaviour.closeFails.has(id)) throw new Error('close failed');
        calls.closed.push({ id, reason });
        return true;
      },
    },
    ...over,
  };
  return { clock, calls, behaviour, deps };
}

async function started(t: { after(fn: () => void): void }, deps: SchedulerDeps): Promise<SchedulerHandle> {
  const handle = startScheduler(deps);
  assert.ok(handle !== null);
  t.after(() => stopScheduler(handle));
  await handle.idle();
  return handle;
}

test('disabled: returns null and runs nothing', () => {
  const s = setup({ enabled: false });
  assert.equal(startScheduler(s.deps), null);
  stopScheduler(null);
  assert.deepEqual(s.calls.events, []);
});

test('start: recovery runs first, then billing, then lifecycle for the business date', async (t) => {
  const s = setup();
  s.behaviour.autoClose = [7, 8];
  await started(t, s.deps);
  assert.deepEqual(s.calls.events, ['recover', 'bill:2026-10-31', 'lifecycle:2026-10-31']);
  assert.deepEqual(s.calls.closed, [{ id: 7, reason: PLAN_ENDED_REASON }, { id: 8, reason: 'Plan ended' }]);
});

test('billing waits for BILLING_RUN_HOUR_UTC, then runs once per date', async (t) => {
  const s = setup({ runHourUtc: 8 });
  const handle = await started(t, s.deps);
  assert.deepEqual(s.calls.events, ['recover']);
  s.clock.set('2026-10-31T08:00:00.000Z');
  await handle.tick();
  await handle.tick();
  s.clock.set('2026-10-31T12:00:00.000Z');
  await handle.tick();
  assert.deepEqual(s.calls.events, ['recover', 'bill:2026-10-31', 'lifecycle:2026-10-31']);
  // Next business date (Asia/Kolkata): runs again.
  s.clock.set('2026-11-01T08:30:00.000Z');
  await handle.tick();
  assert.deepEqual(s.calls.events.slice(3), ['bill:2026-11-01', 'lifecycle:2026-11-01']);
});

test('an automatic run that already exists counts as done; one in progress is retried on the next tick', async (t) => {
  const s = setup();
  s.behaviour.scheduled = [{ outcome: 'IN_PROGRESS' }, { outcome: 'ALREADY_RAN' }];
  const handle = await started(t, s.deps);
  assert.deepEqual(s.calls.events, ['recover', 'bill:2026-10-31']);
  await handle.tick();
  await handle.tick();
  assert.deepEqual(s.calls.events, ['recover', 'bill:2026-10-31', 'bill:2026-10-31', 'lifecycle:2026-10-31']);
});

test('a tick never throws: errors are logged and the job is retried on the next tick', async (t) => {
  const s = setup();
  s.behaviour.recoverError = new Error('db down');
  s.behaviour.scheduled = [new Error('db down')];
  const handle = await started(t, s.deps);
  assert.deepEqual(s.calls.errors, ['Billing run recovery failed', 'Scheduler tick failed']);
  s.behaviour.autoCloseError = new Error('db down');
  await handle.tick();
  assert.equal(s.calls.errors.length, 3);
  s.behaviour.autoCloseError = null;
  await handle.tick();
  assert.deepEqual(s.calls.events, ['recover', 'bill:2026-10-31', 'bill:2026-10-31', 'lifecycle:2026-10-31', 'lifecycle:2026-10-31']);
});

test('lifecycle: one failed close does not stop the others and the job is retried', async (t) => {
  const s = setup();
  s.behaviour.autoClose = [1, 2, 3];
  s.behaviour.closeFails.add(2);
  const handle = await started(t, s.deps);
  assert.deepEqual(s.calls.closed.map((call) => call.id), [1, 3]);
  assert.deepEqual(s.calls.errors, ['Scheduled close failed']);
  s.behaviour.closeFails.clear();
  s.behaviour.autoClose = [2];
  await handle.tick();
  assert.deepEqual(s.calls.closed.map((call) => call.id), [1, 3, 2]);
  await handle.tick();
  assert.equal(s.calls.events.filter((event) => event.startsWith('lifecycle')).length, 2);
});

test('overlapping ticks share one execution; stop prevents further ticks', async (t) => {
  const s = setup();
  const handle = await started(t, s.deps);
  s.clock.set('2026-11-01T06:00:00.000Z');
  await Promise.all([handle.tick(), handle.tick(), handle.tick()]);
  assert.equal(s.calls.events.filter((event) => event === 'bill:2026-11-01').length, 1);
  handle.stop();
  s.clock.set('2026-11-02T06:00:00.000Z');
  await handle.tick();
  assert.equal(s.calls.events.some((event) => event.endsWith('2026-11-02')), false);
});
