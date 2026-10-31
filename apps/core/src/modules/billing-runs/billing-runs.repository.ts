/**
 * Billing run data access. Writes only `BillingRun` and `BillingRunItem`; subscriptions,
 * invoices and users are read for display names. Invoices are created through the
 * InvoicesGateway, never here.
 */

import { BillingRunItemStatus, BillingRunStatus } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { SequenceExecutor } from '../../core/utils/sequence-sql.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { ListBillingRunItemsParams, ListBillingRunsParams } from './billing-runs.schema.js';

export interface BillingRunRow {
  id: number;
  runDate: string;
  status: BillingRunStatus;
  triggeredById: number | null;
  totalDue: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface BillingRunItemRow {
  id: number;
  billingRunId: number;
  subscriptionId: number;
  invoiceId: number | null;
  status: BillingRunItemStatus;
  message: string | null;
  createdAt: string;
}

export interface BillingRunCounters {
  totalDue: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface BillingRunItemWrite {
  billingRunId: number;
  subscriptionId: number;
  invoiceId: number | null;
  status: BillingRunItemStatus;
  message: string | null;
}

export interface CreateRunWrite {
  runDate: Date;
  triggeredById: number | null;
  /** Scheduler only: also refuse when a run with `triggeredById = null` exists for the date. */
  onlyIfNoSchedulerRun: boolean;
  startedAt: Date;
}

export type CreateRunResult =
  | { kind: 'CREATED'; run: BillingRunRow }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'SCHEDULER_RUN_EXISTS' };

export type ReopenRunResult =
  | { kind: 'REOPENED'; run: BillingRunRow }
  | { kind: 'NOT_FOUND' }
  | { kind: 'IN_PROGRESS' };

export interface ItemNames {
  subscriptions: Map<number, string>;
  invoices: Map<number, string>;
}

type RunAccessor = ModelAccessor<Contract, 'BillingRun', 'public'>;
type ItemAccessor = ModelAccessor<Contract, 'BillingRunItem', 'public'>;

const unique = (values: readonly number[]): number[] => [...new Set(values)];

/** Makes `%`, `_` and `\` literal so user input cannot act as an ILIKE wildcard. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Serializes run creation per date for the rest of the transaction, so the "is a run
 * RUNNING for this date?" check and the insert cannot interleave with another instance.
 */
async function lockRunDate(tx: SequenceExecutor, runDate: Date): Promise<void> {
  const key = `billing-run:${runDate.toISOString().slice(0, 10)}`;
  const plan = tx.raw.sql`SELECT 1 AS "id" FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS "lock"`
    .returnsRow({ id: tx.sql.public.BillingRun.columns.id })
    .build();
  await tx.query(plan);
}

function buildRunWhere(query: ListBillingRunsParams) {
  return (run: RunAccessor) => {
    const conditions = [];
    if (query.status !== undefined) conditions.push(run.status.in(query.status));
    if (query.runFrom !== undefined) conditions.push(run.runDate.gte(query.runFrom.toISOString()));
    if (query.runTo !== undefined) conditions.push(run.runDate.lte(query.runTo.toISOString()));
    if (query.triggeredById !== undefined) conditions.push(run.triggeredById.eq(query.triggeredById));
    return and(...conditions);
  };
}

function buildItemWhere(billingRunId: number, query: ListBillingRunItemsParams) {
  return (item: ItemAccessor) => {
    const conditions = [item.billingRunId.eq(billingRunId)];
    if (query.status !== undefined) conditions.push(item.status.in(query.status));
    if (query.subscriptionId !== undefined) conditions.push(item.subscriptionId.eq(query.subscriptionId));
    if (query.search !== undefined) {
      const pattern = `%${likeLiteral(query.search)}%`;
      conditions.push(or(
        item.message.ilike(pattern),
        item.subscription.some((subscription) => subscription.number.ilike(pattern)),
      ));
    }
    return and(...conditions);
  };
}

export class BillingRunsRepository {
  async list(query: ListBillingRunsParams): Promise<BillingRunRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.BillingRun
      .where(buildRunWhere(query))
      .orderBy([
        (run) => {
          const column = query.sortBy === 'runDate' ? run.runDate
            : query.sortBy === 'createdCount' ? run.createdCount
              : query.sortBy === 'status' ? run.status
                : run.startedAt;
          return asc ? column.asc() : column.desc();
        },
        (run) => (asc ? run.id.asc() : run.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toRunRow);
  }

  async count(query: ListBillingRunsParams): Promise<number> {
    const result = await prisma.orm.public.BillingRun.where(buildRunWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async findById(id: number): Promise<BillingRunRow | null> {
    const row = await prisma.orm.public.BillingRun.where((run) => run.id.eq(id)).first();
    return row === null ? null : toRunRow(row);
  }

  async listItems(billingRunId: number, query: ListBillingRunItemsParams): Promise<BillingRunItemRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.BillingRunItem
      .where(buildItemWhere(billingRunId, query))
      .orderBy([
        (item) => {
          const column = query.sortBy === 'status' ? item.status : item.id;
          return asc ? column.asc() : column.desc();
        },
        (item) => (asc ? item.id.asc() : item.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toItemRow);
  }

  async countItems(billingRunId: number, query: ListBillingRunItemsParams): Promise<number> {
    const result = await prisma.orm.public.BillingRunItem
      .where(buildItemWhere(billingRunId, query))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /**
   * One transaction, serialized per date by an advisory lock: refuse when a run for the
   * date is RUNNING (and, for the scheduler, when an automatic run for the date exists),
   * otherwise insert the RUNNING run.
   */
  async createRun(write: CreateRunWrite): Promise<CreateRunResult> {
    const runDate = write.runDate.toISOString();
    return prisma.transaction(async (tx): Promise<CreateRunResult> => {
      await lockRunDate(tx, write.runDate);
      const running = await tx.orm.public.BillingRun
        .where((run) => and(run.runDate.eq(runDate), run.status.eq(BillingRunStatus.RUNNING)))
        .first();
      if (running !== null) return { kind: 'IN_PROGRESS' };
      if (write.onlyIfNoSchedulerRun) {
        const automatic = await tx.orm.public.BillingRun
          .where((run) => and(run.runDate.eq(runDate), run.triggeredById.isNull()))
          .first();
        if (automatic !== null) return { kind: 'SCHEDULER_RUN_EXISTS' };
      }
      const row = await tx.orm.public.BillingRun.create({
        runDate,
        status: BillingRunStatus.RUNNING,
        triggeredById: write.triggeredById,
        startedAt: write.startedAt.toISOString(),
      });
      return { kind: 'CREATED', run: toRunRow(row) };
    });
  }

  /**
   * Puts a finished run back to RUNNING for a retry, under the same per-date lock, so a
   * retry never overlaps another run for that date. `finishedAt` is cleared and `startedAt`
   * becomes the start of this attempt, so stuck-run recovery measures the retry, not the original run.
   */
  async reopenRun(id: number, now: Date): Promise<ReopenRunResult> {
    return prisma.transaction(async (tx): Promise<ReopenRunResult> => {
      const existing = await tx.orm.public.BillingRun.where((run) => run.id.eq(id)).first();
      if (existing === null) return { kind: 'NOT_FOUND' };
      await lockRunDate(tx, new Date(existing.runDate));
      const running = await tx.orm.public.BillingRun
        .where((run) => and(run.runDate.eq(existing.runDate), run.status.eq(BillingRunStatus.RUNNING)))
        .first();
      if (running !== null) return { kind: 'IN_PROGRESS' };
      const rows = await tx.orm.public.BillingRun
        .where((run) => and(run.id.eq(id), run.status.neq(BillingRunStatus.RUNNING)))
        .updateAll({ status: BillingRunStatus.RUNNING, startedAt: now.toISOString(), finishedAt: null });
      const row = rows[0];
      return row === undefined ? { kind: 'IN_PROGRESS' } : { kind: 'REOPENED', run: toRunRow(row) };
    });
  }

  /** Subscription ids of the run's FAILED items, ascending. */
  async listFailedSubscriptionIds(billingRunId: number): Promise<number[]> {
    const rows = await prisma.orm.public.BillingRunItem
      .where((item) => and(item.billingRunId.eq(billingRunId), item.status.eq(BillingRunItemStatus.FAILED)))
      .orderBy([(item) => item.subscriptionId.asc()])
      .all();
    return rows.map((row) => row.subscriptionId);
  }

  /**
   * One item per (run, subscription), enforced by the unique constraint. A retry updates the
   * existing row in place; a first attempt inserts it.
   */
  async saveItem(write: BillingRunItemWrite): Promise<void> {
    const updated = await prisma.orm.public.BillingRunItem
      .where((item) => and(item.billingRunId.eq(write.billingRunId), item.subscriptionId.eq(write.subscriptionId)))
      .updateAll({ invoiceId: write.invoiceId, status: write.status, message: write.message });
    if (updated.length > 0) return;
    await prisma.orm.public.BillingRunItem.create({
      billingRunId: write.billingRunId,
      subscriptionId: write.subscriptionId,
      invoiceId: write.invoiceId,
      status: write.status,
      message: write.message,
    });
  }

  /** Counters derived from the stored items, so a retry and a fresh run are counted the same way. */
  async tallyItems(billingRunId: number): Promise<BillingRunCounters> {
    const countOf = async (status: BillingRunItemStatus): Promise<number> => {
      const result = await prisma.orm.public.BillingRunItem
        .where((item) => and(item.billingRunId.eq(billingRunId), item.status.eq(status)))
        .aggregate((agg) => ({ total: agg.count() }));
      return result.total;
    };
    const [createdCount, skippedCount, failedCount] = await Promise.all([
      countOf(BillingRunItemStatus.CREATED),
      countOf(BillingRunItemStatus.SKIPPED),
      countOf(BillingRunItemStatus.FAILED),
    ]);
    return { totalDue: createdCount + skippedCount + failedCount, createdCount, skippedCount, failedCount };
  }

  /** Progress update while the run is RUNNING. */
  async updateCounters(id: number, counters: BillingRunCounters): Promise<void> {
    await prisma.orm.public.BillingRun
      .where((run) => and(run.id.eq(id), run.status.eq(BillingRunStatus.RUNNING)))
      .updateAll({ ...counters });
  }

  /**
   * Conditional on RUNNING: a run that recovery already marked FAILED stays FAILED.
   * Returns null in that case.
   */
  async finish(
    id: number,
    status: BillingRunStatus,
    counters: BillingRunCounters,
    finishedAt: Date,
  ): Promise<BillingRunRow | null> {
    const rows = await prisma.orm.public.BillingRun
      .where((run) => and(run.id.eq(id), run.status.eq(BillingRunStatus.RUNNING)))
      .updateAll({ ...counters, status, finishedAt: finishedAt.toISOString() });
    const row = rows[0];
    return row === undefined ? null : toRunRow(row);
  }

  /** Marks every run RUNNING since before `startedBefore` as FAILED. Returns their ids. */
  async failStuckRuns(startedBefore: Date, now: Date): Promise<number[]> {
    const rows = await prisma.orm.public.BillingRun
      .where((run) => and(run.status.eq(BillingRunStatus.RUNNING), run.startedAt.lt(startedBefore.toISOString())))
      .updateAll({ status: BillingRunStatus.FAILED, finishedAt: now.toISOString() });
    return rows.map((row) => row.id);
  }

  /** Display names for the users who triggered runs, batched. */
  async lookupUserNames(userIds: readonly number[]): Promise<Map<number, string>> {
    const ids = unique(userIds);
    if (ids.length === 0) return new Map();
    const rows = await prisma.orm.public.User.where((user) => user.id.in(ids)).all();
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Subscription and invoice numbers for item rows, batched. Deleted rows still resolve. */
  async lookupItemNames(subscriptionIds: readonly number[], invoiceIds: readonly number[]): Promise<ItemNames> {
    const subIds = unique(subscriptionIds);
    const invIds = unique(invoiceIds);
    const [subscriptions, invoices] = await Promise.all([
      subIds.length === 0 ? [] : prisma.orm.public.Subscription.where((row) => row.id.in(subIds)).all(),
      invIds.length === 0 ? [] : prisma.orm.public.Invoice.where((row) => row.id.in(invIds)).all(),
    ]);
    return {
      subscriptions: new Map(subscriptions.map((row) => [row.id, row.number])),
      invoices: new Map(invoices.map((row) => [row.id, row.number])),
    };
  }
}

function toRunRow(row: BillingRunRow): BillingRunRow {
  return {
    id: row.id, runDate: row.runDate, status: row.status, triggeredById: row.triggeredById, totalDue: row.totalDue,
    createdCount: row.createdCount, skippedCount: row.skippedCount, failedCount: row.failedCount,
    startedAt: row.startedAt, finishedAt: row.finishedAt,
  };
}

function toItemRow(row: BillingRunItemRow): BillingRunItemRow {
  return {
    id: row.id, billingRunId: row.billingRunId, subscriptionId: row.subscriptionId, invoiceId: row.invoiceId,
    status: row.status, message: row.message, createdAt: row.createdAt,
  };
}
