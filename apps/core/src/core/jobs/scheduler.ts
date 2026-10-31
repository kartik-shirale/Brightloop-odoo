/**
 * In-process scheduled jobs (backend plan section 8). No queue and no Redis: a 60 second
 * timer calls the same billing-run service as `POST /billing-runs`. Two instances firing
 * together cannot double-bill, because the invoice and BillingRunItem unique constraints
 * absorb the overlap, and an automatic run is skipped when one for the date exists.
 *
 * | Job       | When                                                   |
 * |-----------|--------------------------------------------------------|
 * | Recovery  | Once on start: stuck RUNNING runs become FAILED          |
 * | Billing   | First tick at or after BILLING_RUN_HOUR_UTC, per date    |
 * | Lifecycle | Same tick, after billing: close ended plans              |
 *
 * A tick never throws; errors are logged and the job is retried on the next tick.
 */

import { env } from '../../config/env.js';
import type { ScheduledRunResult } from '../../modules/billing-runs/billing-runs.service.js';
import type { SubscriptionsGateway } from '../../modules/subscriptions/subscriptions.gateway.js';
import { logger as defaultLogger, type Logger } from '../logger.js';
import { businessToday, toIsoDate } from '../utils/dates.js';

export const SCHEDULER_INTERVAL_MS = 60_000;
export const PLAN_ENDED_REASON = 'Plan ended';

/** The billing-run operations the scheduler needs (BillingRunsService satisfies it). */
export interface SchedulerBillingRuns {
  runScheduled(): Promise<ScheduledRunResult>;
  recoverStuckRuns(): Promise<number>;
}

export type SchedulerSubscriptions = Pick<SubscriptionsGateway, 'listAutoCloseIds' | 'closeBySystem'>;

export interface SchedulerDeps {
  billingRuns: SchedulerBillingRuns;
  subscriptions: SchedulerSubscriptions;
  clock?: () => Date;
  /** Defaults to `BILLING_SCHEDULER_ENABLED`. */
  enabled?: boolean;
  /** Defaults to `BILLING_RUN_HOUR_UTC`. */
  runHourUtc?: number;
  intervalMs?: number;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export interface SchedulerHandle {
  /** Runs one tick now (skipped when a tick is already running). Never rejects. */
  tick(): Promise<void>;
  /** Resolves once start-up recovery and any running tick are done. */
  idle(): Promise<void>;
  stop(): void;
}

/**
 * Starts the scheduler: recovery first, then an immediate tick, then one tick per interval.
 * Returns null when disabled. The timer is unref'd so it never keeps the process alive.
 */
export function startScheduler(deps: SchedulerDeps): SchedulerHandle | null {
  const enabled = deps.enabled ?? env.BILLING_SCHEDULER_ENABLED;
  const log = deps.logger ?? defaultLogger;
  if (!enabled) {
    log.info({}, 'Billing scheduler disabled');
    return null;
  }
  const clock = deps.clock ?? (() => new Date());
  const runHourUtc = deps.runHourUtc ?? env.BILLING_RUN_HOUR_UTC;

  /** Business dates whose job finished in this process. A restart relies on the DB check instead. */
  let billedDate: string | null = null;
  let lifecycleDate: string | null = null;
  let current: Promise<void> | null = null;
  let stopped = false;

  async function billing(date: string): Promise<boolean> {
    if (billedDate === date) return true;
    const result = await deps.billingRuns.runScheduled();
    if (result.outcome === 'IN_PROGRESS') {
      log.info({ date }, 'Scheduled billing deferred: a run for today is in progress');
      return false;
    }
    billedDate = date;
    if (result.outcome === 'FINISHED') {
      log.info({ date, billingRunId: result.run.id, status: result.run.status }, 'Scheduled billing run finished');
    }
    return true;
  }

  /** Closes every ACTIVE subscription whose plan ended. One failure does not stop the others. */
  async function lifecycle(date: string, today: Date): Promise<void> {
    if (lifecycleDate === date) return;
    const ids = await deps.subscriptions.listAutoCloseIds(today);
    let closed = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        if (await deps.subscriptions.closeBySystem(id, PLAN_ENDED_REASON)) closed += 1;
      } catch (error) {
        failed += 1;
        log.error({ err: error, subscriptionId: id }, 'Scheduled close failed');
      }
    }
    if (failed === 0) lifecycleDate = date;
    if (ids.length > 0) log.info({ date, closed, failed }, 'Scheduled lifecycle job finished');
  }

  async function runTick(): Promise<void> {
    await recovery;
    try {
      const now = clock();
      if (now.getUTCHours() < runHourUtc) return;
      const today = businessToday(now);
      const date = toIsoDate(today);
      // Billing first, so the final period of an ending plan is invoiced before it is closed.
      if (!(await billing(date))) return;
      await lifecycle(date, today);
    } catch (error) {
      log.error({ err: error }, 'Scheduler tick failed');
    }
  }

  function tick(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (current !== null) return current;
    const run = runTick();
    current = run;
    return settle(run);
  }

  async function settle(run: Promise<void>): Promise<void> {
    try {
      await run;
    } finally {
      if (current === run) current = null;
    }
  }

  // Recovery runs before the first tick, so a stuck run for today cannot block today's billing.
  async function recover(): Promise<void> {
    try {
      const recovered = await deps.billingRuns.recoverStuckRuns();
      if (recovered > 0) log.warn({ recovered }, 'Recovered stuck billing runs on start');
    } catch (error) {
      log.error({ err: error }, 'Billing run recovery failed');
    }
  }

  const recovery = recover();
  const started = tick();
  const timer = setInterval(() => {
    void tick();
  }, deps.intervalMs ?? SCHEDULER_INTERVAL_MS);
  timer.unref();

  return {
    tick,
    async idle(): Promise<void> {
      await started;
      if (current !== null) await current;
    },
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Stops the timer. A tick already running finishes on its own; it never throws. */
export function stopScheduler(handle: SchedulerHandle | null): void {
  handle?.stop();
}
