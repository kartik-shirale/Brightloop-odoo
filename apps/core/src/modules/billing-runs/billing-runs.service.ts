import {
  BillingRunItemStatus, BillingRunStatus,
  type BillingRunDto, type BillingRunItemDto, type ListMeta,
} from '@brightloop/shared';
import { env } from '../../config/env.js';
import { AppError, forbidden, notFound, validationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { businessToday, startOfUtcDay, toIsoDate } from '../../core/utils/dates.js';
import { billingRunInProgress, invalidStateTransition } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import type { InvoicesGateway } from '../invoices/invoices.gateway.js';
import type { SubscriptionsGateway } from '../subscriptions/subscriptions.gateway.js';
import { toBillingRunDto, toBillingRunItemDto } from './billing-runs.dto.js';
import type {
  BillingRunCounters, BillingRunItemWrite, BillingRunRow, BillingRunsRepository,
} from './billing-runs.repository.js';
import type { CreateBillingRunInput, ListBillingRunItemsParams, ListBillingRunsParams } from './billing-runs.schema.js';

const MAX_MESSAGE_LENGTH = 500;
const MINUTE_MS = 60_000;
const UNEXPECTED_FAILURE = 'Unexpected error while generating the invoice. See the server log';

export interface BillingRunsOptions {
  /** Subscriptions per keyset batch (`BILLING_BATCH_SIZE`). */
  batchSize: number;
  /** Periods billed for one subscription in one run (`BILLING_MAX_CATCHUP_PERIODS`). */
  maxCatchUpPeriods: number;
  /** Age after which a RUNNING run counts as stuck (`BILLING_STUCK_RUN_MINUTES`). */
  stuckRunMinutes: number;
}

export function billingRunsOptionsFromEnv(): BillingRunsOptions {
  return {
    batchSize: env.BILLING_BATCH_SIZE,
    maxCatchUpPeriods: env.BILLING_MAX_CATCHUP_PERIODS,
    stuckRunMinutes: env.BILLING_STUCK_RUN_MINUTES,
  };
}

/** What the scheduler learns from one automatic attempt. */
export type ScheduledRunResult =
  | { outcome: 'FINISHED'; run: BillingRunDto }
  /** An automatic run for today exists already (this or another instance made it). */
  | { outcome: 'ALREADY_RAN' }
  /** Another run for today is RUNNING; try again on a later tick. */
  | { outcome: 'IN_PROGRESS' };

/** The only subscription operation a run needs. */
export type DueSubscriptionsGateway = Pick<SubscriptionsGateway, 'listDueIds'>;

interface RunWork {
  runId: number;
  asOf: Date;
  autoConfirm: boolean;
  /** Explicit subscriptions (manual selection or retry); null walks every due subscription. */
  subscriptionIds: number[] | null;
}

type ItemOutcome = Omit<BillingRunItemWrite, 'billingRunId' | 'subscriptionId'>;

const plural = (count: number): string => (count === 1 ? '1 invoice' : `${count} invoices`);

function truncate(message: string): string {
  return message.length <= MAX_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
}

/** Domain errors carry client-safe messages. Anything else is logged and replaced. */
function sanitizedMessage(error: unknown): string {
  return error instanceof AppError ? error.message : UNEXPECTED_FAILURE;
}

/** COMPLETED with no failure, FAILED when nothing succeeded, PARTIAL otherwise. */
export function finalStatusFor(counters: BillingRunCounters): BillingRunStatus {
  if (counters.failedCount === 0) return BillingRunStatus.COMPLETED;
  return counters.createdCount + counters.skippedCount === 0 ? BillingRunStatus.FAILED : BillingRunStatus.PARTIAL;
}

/**
 * Billing runs (backend plan M11). A run is created RUNNING and processed in the background:
 * `create` returns at once and the client polls `get`. Each subscription is billed in its
 * own invoice transaction through the InvoicesGateway, so one failure never blocks the rest,
 * and double billing is prevented by the invoice constraints, not by this service.
 */
export class BillingRunsService {
  /** Background work by run id. `waitForIdle` awaits it (tests, shutdown). */
  private readonly inFlight = new Map<number, Promise<BillingRunRow | null>>();

  constructor(
    private readonly repository: BillingRunsRepository,
    private readonly invoices: InvoicesGateway,
    private readonly subscriptions: DueSubscriptionsGateway,
    private readonly audit: AuditGateway,
    private readonly options: BillingRunsOptions = billingRunsOptionsFromEnv(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(actor: Actor, query: ListBillingRunsParams): Promise<{ runs: BillingRunDto[]; meta: ListMeta }> {
    this.assertStaff(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    return { runs: await this.toDtos(rows), meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<BillingRunDto> {
    this.assertStaff(actor);
    return this.toDto(await this.requireRun(id));
  }

  async listItems(
    actor: Actor,
    id: number,
    query: ListBillingRunItemsParams,
  ): Promise<{ items: BillingRunItemDto[]; meta: ListMeta }> {
    this.assertStaff(actor);
    await this.requireRun(id);
    const [rows, total] = await Promise.all([this.repository.listItems(id, query), this.repository.countItems(id, query)]);
    const names = await this.repository.lookupItemNames(
      rows.map((row) => row.subscriptionId),
      rows.flatMap((row) => (row.invoiceId === null ? [] : [row.invoiceId])),
    );
    return { items: rows.map((row) => toBillingRunItemDto(row, names)), meta: listMetaFor(total, query.page, query.limit) };
  }

  /**
   * Manual run. `runDate` defaults to the business today and cannot be in the future. 409
   * BILLING_RUN_IN_PROGRESS when a run for the date is RUNNING. Returns the RUNNING run;
   * processing continues in the background.
   */
  async create(actor: Actor, input: CreateBillingRunInput, ip?: string): Promise<BillingRunDto> {
    this.assertStaff(actor);
    const today = this.today();
    const runDate = input.runDate ?? today;
    if (runDate.getTime() > today.getTime()) {
      throw validationError('Validation failed', [{ field: 'runDate', message: 'runDate cannot be in the future' }]);
    }
    const subscriptionIds = input.subscriptionIds === undefined ? null : [...new Set(input.subscriptionIds)];
    const autoConfirm = input.autoConfirm === true;
    const created = await this.repository.createRun({
      runDate, triggeredById: actor.userId, onlyIfNoSchedulerRun: false, startedAt: this.clock(),
    });
    if (created.kind !== 'CREATED') throw billingRunInProgress();
    await this.audit.record({
      actor, action: 'billing-run.create', entityType: 'BillingRun', entityId: created.run.id, ip,
      metadata: { runDate: toIsoDate(runDate), autoConfirm, subscriptionIds },
    });
    void this.launch({ runId: created.run.id, asOf: runDate, autoConfirm, subscriptionIds });
    return this.toDto(created.run);
  }

  /**
   * Re-bills the subscriptions of the run's FAILED items on the run's original date. Items
   * are updated in place and the counters recomputed. Retried invoices are DRAFT, because a
   * run does not store its `autoConfirm` choice.
   */
  async retryFailed(actor: Actor, id: number, ip?: string): Promise<BillingRunDto> {
    this.assertStaff(actor);
    const run = await this.requireRun(id);
    if (run.status === BillingRunStatus.RUNNING) throw billingRunInProgress('This billing run is still running');
    const failedIds = await this.repository.listFailedSubscriptionIds(id);
    if (failedIds.length === 0) throw invalidStateTransition('This billing run has no failed items to retry');
    const reopened = await this.repository.reopenRun(id, this.clock());
    if (reopened.kind === 'NOT_FOUND') throw notFound('Billing run not found');
    if (reopened.kind === 'IN_PROGRESS') throw billingRunInProgress();
    await this.audit.record({
      actor, action: 'billing-run.retry-failed', entityType: 'BillingRun', entityId: id, ip,
      metadata: { runDate: toIsoDate(new Date(run.runDate)), previousStatus: run.status, subscriptionIds: failedIds },
    });
    void this.launch({
      runId: id, asOf: startOfUtcDay(new Date(run.runDate)), autoConfirm: false, subscriptionIds: failedIds,
    });
    return this.toDto(reopened.run);
  }

  /**
   * The scheduler's daily run for the business today: `triggeredById` null, DRAFT invoices.
   * Skipped when an automatic run for the date exists. Unlike `create`, it waits for the run
   * to finish, so the scheduler can run its lifecycle job afterwards.
   */
  async runScheduled(): Promise<ScheduledRunResult> {
    const runDate = this.today();
    const created = await this.repository.createRun({
      runDate, triggeredById: null, onlyIfNoSchedulerRun: true, startedAt: this.clock(),
    });
    if (created.kind === 'IN_PROGRESS') return { outcome: 'IN_PROGRESS' };
    if (created.kind === 'SCHEDULER_RUN_EXISTS') return { outcome: 'ALREADY_RAN' };
    await this.audit.record({
      actor: null, action: 'billing-run.create', entityType: 'BillingRun', entityId: created.run.id,
      metadata: { runDate: toIsoDate(runDate), autoConfirm: false, subscriptionIds: null, trigger: 'scheduler' },
    });
    const finished = await this.launch({ runId: created.run.id, asOf: runDate, autoConfirm: false, subscriptionIds: null });
    const row = finished ?? (await this.repository.findById(created.run.id)) ?? created.run;
    return { outcome: 'FINISHED', run: await this.toDto(row) };
  }

  /**
   * Marks runs RUNNING for longer than `stuckRunMinutes` as FAILED (their process died).
   * Called once on server start, before any run of this process exists. Re-running a date
   * is always safe. Returns how many runs were recovered.
   */
  async recoverStuckRuns(): Promise<number> {
    const now = this.clock();
    const cutoff = new Date(now.getTime() - this.options.stuckRunMinutes * MINUTE_MS);
    const ids = await this.repository.failStuckRuns(cutoff, now);
    for (const id of ids) {
      await this.audit.record({
        actor: null, action: 'billing-run.recover', entityType: 'BillingRun', entityId: id,
        metadata: { reason: `RUNNING for more than ${this.options.stuckRunMinutes} minutes` },
      });
    }
    if (ids.length > 0) logger.warn({ billingRunIds: ids }, 'Stuck billing runs marked FAILED');
    return ids.length;
  }

  /** Resolves once every background run of this instance has finished. */
  async waitForIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(this.inFlight.values());
    }
  }

  private launch(work: RunWork): Promise<BillingRunRow | null> {
    const task = this.execute(work);
    this.inFlight.set(work.runId, task);
    return task;
  }

  /**
   * Never rejects: a crash is logged and the run is marked FAILED (best effort; if even that
   * fails, startup recovery picks it up later).
   */
  private async execute(work: RunWork): Promise<BillingRunRow | null> {
    try {
      const row = await this.process(work);
      logger.info({ billingRunId: work.runId, status: row?.status }, 'Billing run finished');
      return row;
    } catch (error) {
      logger.error({ err: error, billingRunId: work.runId }, 'Billing run crashed');
      try {
        const counters = await this.repository.tallyItems(work.runId);
        return await this.repository.finish(work.runId, BillingRunStatus.FAILED, counters, this.clock());
      } catch (finishError) {
        logger.error({ err: finishError, billingRunId: work.runId }, 'Could not mark the billing run FAILED');
        return null;
      }
    } finally {
      this.inFlight.delete(work.runId);
    }
  }

  private async process(work: RunWork): Promise<BillingRunRow | null> {
    const batches = work.subscriptionIds === null ? this.dueBatches(work.asOf) : this.fixedBatches(work.subscriptionIds);
    for await (const batch of batches) {
      for (const subscriptionId of batch) await this.processSubscription(work, subscriptionId);
      await this.repository.updateCounters(work.runId, await this.repository.tallyItems(work.runId));
    }
    const counters = await this.repository.tallyItems(work.runId);
    return this.repository.finish(work.runId, finalStatusFor(counters), counters, this.clock());
  }

  /**
   * Keyset pages of due subscriptions. A subscription that stays due (failed, or capped
   * catch-up) is not seen twice because the cursor only moves forward.
   */
  private async *dueBatches(asOf: Date): AsyncGenerator<number[]> {
    let afterId = 0;
    for (;;) {
      const ids = await this.subscriptions.listDueIds(asOf, afterId, this.options.batchSize);
      if (ids.length === 0) return;
      yield ids;
      afterId = ids[ids.length - 1]!;
      if (ids.length < this.options.batchSize) return;
    }
  }

  private async *fixedBatches(ids: readonly number[]): AsyncGenerator<number[]> {
    for (let start = 0; start < ids.length; start += this.options.batchSize) {
      yield ids.slice(start, start + this.options.batchSize);
    }
  }

  /** Bills one subscription and stores its item. Never throws, so the run always moves on. */
  private async processSubscription(work: RunWork, subscriptionId: number): Promise<void> {
    const outcome = await this.billSubscription(work, subscriptionId);
    if (outcome === null) return;
    try {
      await this.repository.saveItem({ billingRunId: work.runId, subscriptionId, ...outcome });
    } catch (error) {
      logger.error({ err: error, billingRunId: work.runId, subscriptionId }, 'Could not store the billing run item');
    }
  }

  /**
   * Catch-up loop: one period per gateway call until the gateway answers SKIPPED (nothing more
   * is due) or `maxCatchUpPeriods` invoices were created. The schema allows one item per
   * subscription per run, so the item summarizes the loop: CREATED with the last invoice when
   * at least one was created, SKIPPED when none was, FAILED on an error (invoices created
   * before the error are kept). Null means "record no item" (unknown subscription).
   */
  private async billSubscription(work: RunWork, subscriptionId: number): Promise<ItemOutcome | null> {
    let created = 0;
    let lastInvoiceId: number | null = null;
    let skipMessage: string | null = null;
    try {
      while (created < this.options.maxCatchUpPeriods) {
        const outcome = await this.invoices.generateForSubscription(subscriptionId, work.asOf, {
          autoConfirm: work.autoConfirm, billingRunId: work.runId, actor: null,
        });
        if (outcome.status === 'SKIPPED') {
          skipMessage = outcome.message;
          break;
        }
        created += 1;
        lastInvoiceId = outcome.invoiceId;
      }
    } catch (error) {
      if (error instanceof AppError && error.status === 404 && created === 0) {
        // An unknown id from an explicit selection: an item would violate its foreign key.
        logger.warn({ billingRunId: work.runId, subscriptionId }, 'Billing run skipped an unknown subscription');
        return null;
      }
      if (!(error instanceof AppError)) {
        logger.error({ err: error, billingRunId: work.runId, subscriptionId }, 'Invoice generation failed in a billing run');
      }
      const prefix = created > 0 ? `${plural(created)} created, then failed: ` : '';
      return {
        status: BillingRunItemStatus.FAILED, invoiceId: lastInvoiceId, message: truncate(`${prefix}${sanitizedMessage(error)}`),
      };
    }
    if (created === 0) {
      return { status: BillingRunItemStatus.SKIPPED, invoiceId: null, message: truncate(skipMessage ?? 'Nothing to bill') };
    }
    const capped = skipMessage === null
      ? `; catch-up limit of ${this.options.maxCatchUpPeriods} periods reached, run again to bill the rest`
      : '';
    return { status: BillingRunItemStatus.CREATED, invoiceId: lastInvoiceId, message: truncate(`${plural(created)} created${capped}`) };
  }

  private async toDto(row: BillingRunRow): Promise<BillingRunDto> {
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  private async toDtos(rows: readonly BillingRunRow[]): Promise<BillingRunDto[]> {
    const names = await this.repository.lookupUserNames(
      rows.flatMap((row) => (row.triggeredById === null ? [] : [row.triggeredById])),
    );
    return rows.map((row) => toBillingRunDto(row, names));
  }

  private async requireRun(id: number): Promise<BillingRunRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound('Billing run not found');
    return row;
  }

  private today(): Date {
    return businessToday(this.clock());
  }

  private assertStaff(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}
