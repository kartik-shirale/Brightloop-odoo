import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role, type BillingRunDto, type BillingRunItemDto } from '@brightloop/shared';
import { AppError, notFound } from '../../core/errors.js';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { InMemoryTable, RecordingAudit, fakeRepository, fixedClock } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import { addDays } from '../../core/utils/dates.js';
import type { GenerateInvoiceOptions, GenerateInvoiceOutcome, InvoicesGateway } from '../invoices/invoices.gateway.js';
import type {
  BillingRunItemRow, BillingRunRow, BillingRunsRepository, CreateRunResult,
} from './billing-runs.repository.js';
import { createBillingRunsRouter } from './billing-runs.routes.js';
import type { ListBillingRunItemsParams, ListBillingRunsParams } from './billing-runs.schema.js';
import { BillingRunsService, finalStatusFor, type BillingRunsOptions, type DueSubscriptionsGateway } from './billing-runs.service.js';

const NOW = '2026-10-31T10:00:00.000Z';
const TODAY = '2026-10-31';
const STAFF = actorFor(Role.STAFF);
const D = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

interface FakeSub {
  id: number;
  number: string;
  nextBillingDate: Date;
  /** Days per billing period, so catch-up is easy to reason about. */
  periodDays: number;
  /** Throw on every generate call: a raw Error, or a domain error with a client-safe message. */
  failWith: Error | null;
  /** Throw after this many invoices were created (then keep failing). */
  failAfter: number | null;
}

interface FakeInvoice {
  id: number;
  number: string;
  subscriptionId: number;
  periodStart: Date;
  billingRunId: number | null;
  autoConfirm: boolean;
  actor: GenerateInvoiceOptions['actor'];
}

function setup(options: Partial<BillingRunsOptions> = {}) {
  const clock = fixedClock(NOW);
  const subs = new Map<number, FakeSub>();
  const invoices: FakeInvoice[] = [];
  const runs = new InMemoryTable<BillingRunRow>();
  const items = new InMemoryTable<BillingRunItemRow>();
  const dueCalls: { asOf: Date; afterId: number; limit: number }[] = [];
  const listCalls: { runs: ListBillingRunsParams[]; items: ListBillingRunItemsParams[] } = { runs: [], items: [] };
  const created = new Map<number, number>();
  const failures = { listDue: null as Error | null };
  const audit = new RecordingAudit();

  const addSub = (id: number, over: Partial<FakeSub> = {}): FakeSub => {
    const sub: FakeSub = {
      id, number: `SUB-2026-${String(id).padStart(6, '0')}`, nextBillingDate: D(TODAY), periodDays: 30,
      failWith: null, failAfter: null, ...over,
    };
    subs.set(id, sub);
    return sub;
  };

  const invoicesGateway: InvoicesGateway = {
    async generateForSubscription(subscriptionId, asOf, opts): Promise<GenerateInvoiceOutcome> {
      const sub = subs.get(subscriptionId);
      if (sub === undefined) throw notFound('Subscription not found');
      if (sub.failWith !== null) throw sub.failWith;
      if (sub.failAfter !== null && (created.get(subscriptionId) ?? 0) >= sub.failAfter) {
        throw new Error('connection reset by peer at 10.0.0.5:5432');
      }
      if (sub.nextBillingDate.getTime() > asOf.getTime()) {
        return { status: 'SKIPPED', reason: 'NOTHING_TO_BILL', message: 'Next billing date is after the run date' };
      }
      const invoice: FakeInvoice = {
        id: invoices.length + 1, number: `INV-2026-${String(invoices.length + 1).padStart(6, '0')}`, subscriptionId,
        periodStart: sub.nextBillingDate, billingRunId: opts.billingRunId ?? null, autoConfirm: opts.autoConfirm ?? false,
        actor: opts.actor,
      };
      invoices.push(invoice);
      created.set(subscriptionId, (created.get(subscriptionId) ?? 0) + 1);
      sub.nextBillingDate = addDays(sub.nextBillingDate, sub.periodDays);
      return { status: 'CREATED', invoiceId: invoice.id, number: invoice.number };
    },
  };

  const subscriptions: DueSubscriptionsGateway = {
    async listDueIds(asOf, afterId, limit) {
      dueCalls.push({ asOf, afterId, limit });
      if (failures.listDue !== null) throw failures.listDue;
      return [...subs.values()]
        .filter((sub) => sub.id > afterId && sub.nextBillingDate.getTime() <= asOf.getTime())
        .map((sub) => sub.id)
        .sort((a, b) => a - b)
        .slice(0, limit);
    },
  };

  const tally = (runId: number) => {
    const of = (status: string) => items.rows.filter((item) => item.billingRunId === runId && item.status === status).length;
    const counters = { createdCount: of('CREATED'), skippedCount: of('SKIPPED'), failedCount: of('FAILED') };
    return { totalDue: counters.createdCount + counters.skippedCount + counters.failedCount, ...counters };
  };

  // No await inside the transactional methods: each runs atomically, like the locked transaction.
  const repository = fakeRepository<BillingRunsRepository>({
    async list(query) {
      listCalls.runs.push(query);
      return runs.rows.slice(0, query.limit).map((row) => ({ ...row }));
    },
    async count() { return runs.rows.length; },
    async findById(id) {
      const row = runs.find(id);
      return row === null ? null : { ...row };
    },
    async listItems(billingRunId, query) {
      listCalls.items.push(query);
      return items.rows.filter((item) => item.billingRunId === billingRunId).slice(0, query.limit).map((row) => ({ ...row }));
    },
    async countItems(billingRunId) { return items.rows.filter((item) => item.billingRunId === billingRunId).length; },
    async createRun(write): Promise<CreateRunResult> {
      const runDate = write.runDate.toISOString();
      if (runs.rows.some((run) => run.runDate === runDate && run.status === 'RUNNING')) return { kind: 'IN_PROGRESS' };
      if (write.onlyIfNoSchedulerRun && runs.rows.some((run) => run.runDate === runDate && run.triggeredById === null)) {
        return { kind: 'SCHEDULER_RUN_EXISTS' };
      }
      const run = runs.insert({
        runDate, status: 'RUNNING', triggeredById: write.triggeredById, totalDue: 0, createdCount: 0, skippedCount: 0,
        failedCount: 0, startedAt: write.startedAt.toISOString(), finishedAt: null,
      });
      return { kind: 'CREATED', run: { ...run } };
    },
    async reopenRun(id, now) {
      const run = runs.find(id);
      if (run === null) return { kind: 'NOT_FOUND' };
      if (runs.rows.some((other) => other.runDate === run.runDate && other.status === 'RUNNING')) return { kind: 'IN_PROGRESS' };
      Object.assign(run, { status: 'RUNNING', startedAt: now.toISOString(), finishedAt: null });
      return { kind: 'REOPENED', run: { ...run } };
    },
    async listFailedSubscriptionIds(billingRunId) {
      return items.rows
        .filter((item) => item.billingRunId === billingRunId && item.status === 'FAILED')
        .map((item) => item.subscriptionId)
        .sort((a, b) => a - b);
    },
    async saveItem(write) {
      if (!subs.has(write.subscriptionId)) throw new Error('foreign key violation');
      const existing = items.rows.find((item) => item.billingRunId === write.billingRunId && item.subscriptionId === write.subscriptionId);
      if (existing !== undefined) {
        Object.assign(existing, { invoiceId: write.invoiceId, status: write.status, message: write.message });
        return;
      }
      items.insert({ ...write, createdAt: clock.now().toISOString() });
    },
    async tallyItems(billingRunId) { return tally(billingRunId); },
    async updateCounters(id, counters) {
      const run = runs.find(id);
      if (run !== null && run.status === 'RUNNING') Object.assign(run, counters);
    },
    async finish(id, status, counters, finishedAt) {
      const run = runs.find(id);
      if (run === null || run.status !== 'RUNNING') return null;
      Object.assign(run, counters, { status, finishedAt: finishedAt.toISOString() });
      return { ...run };
    },
    async failStuckRuns(startedBefore, now) {
      const stuck = runs.rows.filter((run) => run.status === 'RUNNING' && new Date(run.startedAt) < startedBefore);
      for (const run of stuck) Object.assign(run, { status: 'FAILED', finishedAt: now.toISOString() });
      return stuck.map((run) => run.id);
    },
    async lookupUserNames(ids) {
      return new Map(ids.filter((id) => id === 1 || id === 2).map((id) => [id, id === 1 ? 'Test Admin' : 'Test Staff']));
    },
    async lookupItemNames(subscriptionIds, invoiceIds) {
      return {
        subscriptions: new Map(subscriptionIds.map((id) => [id, subs.get(id)?.number ?? ''])),
        invoices: new Map(invoiceIds.map((id) => [id, invoices.find((invoice) => invoice.id === id)?.number ?? ''])),
      };
    },
  });

  const service = new BillingRunsService(
    repository, invoicesGateway, subscriptions, audit,
    { batchSize: 100, maxCatchUpPeriods: 12, stuckRunMinutes: 30, ...options },
    clock.now,
  );
  return { clock, subs, invoices, runs, items, dueCalls, listCalls, failures, audit, addSub, service };
}

type Setup = ReturnType<typeof setup>;

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/billing-runs', createBillingRunsRouter({
    authService: auth.asAuthService(), billingRunsService: s.service,
  })));
}

/** Starts a manual run through the service and waits for the background work. */
async function runOnce(s: Setup, input: Parameters<BillingRunsService['create']>[1] = {}): Promise<BillingRunRow> {
  const started = await s.service.create(STAFF, input);
  await s.service.waitForIdle();
  return s.runs.find(started.id)!;
}

function seedRun(s: Setup, over: Partial<BillingRunRow> = {}): BillingRunRow {
  return s.runs.insert({
    runDate: D(TODAY).toISOString(), status: 'RUNNING', triggeredById: 2, totalDue: 0, createdCount: 0, skippedCount: 0,
    failedCount: 0, startedAt: NOW, finishedAt: null, ...over,
  });
}

test('RBAC matrix: ADMIN and STAFF on every route, CUSTOMER refused, anonymous 401', async (t) => {
  const s = setup();
  s.addSub(1);
  seedRun(s, { status: 'COMPLETED', runDate: D('2026-10-01').toISOString(), finishedAt: NOW });
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/billing-runs', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    // The second allowed POST may see the first run still RUNNING (409); both are "allowed".
    { method: 'POST', path: '/billing-runs', allowed: [Role.ADMIN, Role.STAFF], body: {} },
    { method: 'GET', path: '/billing-runs/1', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/billing-runs/1/items', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/billing-runs/1/retry-failed', allowed: [Role.ADMIN, Role.STAFF], expectedAllowedStatus: 409 },
  ]);
  await s.service.waitForIdle();
});

test('POST returns 201 RUNNING with Location; the background run completes with counters, items and invoices', async (t) => {
  const s = setup();
  s.addSub(1);
  s.addSub(2);
  s.addSub(3, { nextBillingDate: D('2026-11-15') });
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: BillingRunDto }>('/billing-runs', {
    method: 'POST', role: Role.STAFF, body: { autoConfirm: true },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'RUNNING');
  assert.equal(response.body.data.runDate, '2026-10-31T00:00:00.000Z');
  assert.equal(response.body.data.triggeredById, 2);
  assert.equal(response.body.data.triggeredByName, 'Test Staff');
  assert.equal(response.body.data.finishedAt, null);
  assert.match(response.headers.get('location') ?? '', /\/billing-runs\/1$/);

  await s.service.waitForIdle();
  const run = await srv.request<ApiBody & { data: BillingRunDto }>('/billing-runs/1', { role: Role.ADMIN });
  assert.equal(run.status, 200);
  assert.deepEqual(
    [run.body.data.status, run.body.data.totalDue, run.body.data.createdCount, run.body.data.skippedCount, run.body.data.failedCount],
    ['COMPLETED', 2, 2, 0, 0],
  );
  assert.equal(run.body.data.finishedAt, NOW);
  assert.equal(s.invoices.length, 2);
  assert.ok(s.invoices.every((invoice) => invoice.billingRunId === 1 && invoice.autoConfirm && invoice.actor === null));

  const items = await srv.request<ApiBody & { data: BillingRunItemDto[] }>('/billing-runs/1/items?sortBy=id&sortOrder=asc', { role: Role.STAFF });
  assert.equal(items.status, 200);
  assert.deepEqual(items.body.data.map((item) => [item.subscriptionNumber, item.status, item.invoiceNumber, item.message]), [
    ['SUB-2026-000001', 'CREATED', 'INV-2026-000001', '1 invoice created'],
    ['SUB-2026-000002', 'CREATED', 'INV-2026-000002', '1 invoice created'],
  ]);
  assert.deepEqual(s.audit.actions(), ['billing-run.create']);
  assert.equal(s.audit.entries[0]?.actor?.userId, 2);
  assert.deepEqual(s.audit.entries[0]?.metadata, { runDate: TODAY, autoConfirm: true, subscriptionIds: null });
});

test('running twice on one date creates 0 invoices the second time', async () => {
  const s = setup();
  for (let id = 1; id <= 5; id += 1) s.addSub(id);
  const first = await runOnce(s);
  assert.deepEqual([first.status, first.createdCount], ['COMPLETED', 5]);
  const second = await runOnce(s);
  assert.deepEqual([second.status, second.totalDue, second.createdCount, second.failedCount], ['COMPLETED', 0, 0, 0]);
  assert.equal(s.invoices.length, 5);
});

test('one failing subscription does not stop the run: PARTIAL, sanitized message, the rest are billed', async () => {
  const s = setup();
  s.addSub(1);
  s.addSub(2, { failWith: new Error('duplicate key value violates "Invoice_pkey" at 10.0.0.5') });
  s.addSub(3, { failWith: new AppError({ status: 409, code: 'DISCOUNT_NOT_APPLICABLE', message: 'A discount reached its usage limit' }) });
  s.addSub(4);
  const run = await runOnce(s);
  assert.deepEqual([run.status, run.totalDue, run.createdCount, run.failedCount], ['PARTIAL', 4, 2, 2]);
  assert.deepEqual(s.invoices.map((invoice) => invoice.subscriptionId), [1, 4]);
  const failed = s.items.rows.filter((item) => item.status === 'FAILED');
  assert.deepEqual(failed.map((item) => item.subscriptionId), [2, 3]);
  assert.equal(failed[0]?.message, 'Unexpected error while generating the invoice. See the server log');
  assert.doesNotMatch(failed[0]?.message ?? '', /10\.0\.0\.5|Invoice_pkey/);
  assert.equal(failed[1]?.message, 'A discount reached its usage limit');
});

test('every subscription failing gives FAILED; nothing due gives COMPLETED with zero counters', async () => {
  const s = setup();
  s.addSub(1, { failWith: new Error('boom') });
  assert.equal((await runOnce(s)).status, 'FAILED');
  const empty = setup();
  const run = await runOnce(empty);
  assert.deepEqual([run.status, run.totalDue], ['COMPLETED', 0]);
  assert.equal(finalStatusFor({ totalDue: 3, createdCount: 1, skippedCount: 0, failedCount: 2 }), 'PARTIAL');
  assert.equal(finalStatusFor({ totalDue: 2, createdCount: 0, skippedCount: 1, failedCount: 1 }), 'PARTIAL');
});

test('500 due subscriptions complete in keyset batches of BILLING_BATCH_SIZE', async () => {
  const s = setup({ batchSize: 100 });
  for (let id = 1; id <= 500; id += 1) s.addSub(id);
  const run = await runOnce(s);
  assert.deepEqual([run.status, run.totalDue, run.createdCount], ['COMPLETED', 500, 500]);
  assert.equal(s.invoices.length, 500);
  assert.deepEqual(s.dueCalls.map((call) => call.afterId), [0, 100, 200, 300, 400, 500]);
  assert.ok(s.dueCalls.every((call) => call.limit === 100 && call.asOf.toISOString() === '2026-10-31T00:00:00.000Z'));
});

test('a failed subscription stays due but the keyset cursor never revisits it', async () => {
  const s = setup({ batchSize: 2 });
  s.addSub(1, { failWith: new Error('boom') });
  s.addSub(2);
  s.addSub(3);
  const run = await runOnce(s);
  assert.deepEqual([run.status, run.totalDue], ['PARTIAL', 3]);
  assert.deepEqual(s.dueCalls.map((call) => call.afterId), [0, 2]);
});

test('catch-up bills overdue periods in a loop, one item per subscription, capped at the max periods', async () => {
  const s = setup({ maxCatchUpPeriods: 12 });
  s.addSub(1, { nextBillingDate: D('2026-10-29'), periodDays: 1 });
  s.addSub(2, { nextBillingDate: D('2026-10-01'), periodDays: 1 });
  const run = await runOnce(s);
  assert.deepEqual([run.status, run.totalDue, run.createdCount], ['COMPLETED', 2, 2]);
  const [first, second] = s.items.rows;
  assert.equal(first?.message, '3 invoices created');
  assert.equal(first?.invoiceId, 3);
  assert.equal(second?.message, '12 invoices created; catch-up limit of 12 periods reached, run again to bill the rest');
  assert.equal(s.invoices.filter((invoice) => invoice.subscriptionId === 2).length, 12);
  assert.equal(s.subs.get(2)?.nextBillingDate.toISOString(), '2026-10-13T00:00:00.000Z');

  const next = await runOnce(s);
  assert.equal(next.createdCount, 1);
  assert.equal(s.invoices.filter((invoice) => invoice.subscriptionId === 2).length, 24);
});

test('an error part-way through catch-up keeps the invoices already created and records FAILED', async () => {
  const s = setup();
  s.addSub(1, { nextBillingDate: D('2026-10-25'), periodDays: 1, failAfter: 2 });
  const run = await runOnce(s);
  assert.equal(run.status, 'FAILED');
  const item = s.items.rows[0];
  assert.equal(item?.status, 'FAILED');
  assert.equal(item?.invoiceId, 2);
  assert.equal(item?.message, '2 invoices created, then failed: Unexpected error while generating the invoice. See the server log');
  assert.equal(s.invoices.length, 2);
});

test('a stuck RUNNING run is recovered as FAILED; a recent one is left alone', async () => {
  const s = setup({ stuckRunMinutes: 30 });
  const stuck = seedRun(s, { startedAt: '2026-10-31T09:00:00.000Z' });
  const recent = seedRun(s, { runDate: D('2026-10-30').toISOString(), startedAt: '2026-10-31T09:45:00.000Z' });
  assert.equal(await s.service.recoverStuckRuns(), 1);
  assert.equal(s.runs.find(stuck.id)?.status, 'FAILED');
  assert.equal(s.runs.find(stuck.id)?.finishedAt, NOW);
  assert.equal(s.runs.find(recent.id)?.status, 'RUNNING');
  assert.deepEqual(s.audit.actions(), ['billing-run.recover']);
  assert.equal(s.audit.entries[0]?.actor, null);
  // Re-running the date is safe once the stuck run is out of the way.
  s.addSub(1);
  assert.equal((await runOnce(s)).createdCount, 1);
});

test('409 BILLING_RUN_IN_PROGRESS when a run for the same date is RUNNING; another date is fine', async (t) => {
  const s = setup();
  seedRun(s);
  const srv = await server(t, s);
  const conflict = await srv.request<ApiBody>('/billing-runs', { method: 'POST', role: Role.STAFF, body: { runDate: TODAY } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error?.code, 'BILLING_RUN_IN_PROGRESS');
  const other = await srv.request<ApiBody>('/billing-runs', { method: 'POST', role: Role.STAFF, body: { runDate: '2026-10-30' } });
  assert.equal(other.status, 201);
  await s.service.waitForIdle();
  assert.equal(s.runs.rows.length, 2);
});

test('POST validates the body: date-only runDate not in the future, strict keys, bounded subscriptionIds', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/billing-runs', { method: 'POST', role: Role.ADMIN, body });
  for (const body of [
    { runDate: '2026-10-31T10:00:00Z' }, { runDate: 'today' }, { runDate: '2026-02-30' }, { autoConfirm: 'yes' },
    { subscriptionIds: [] }, { subscriptionIds: [0] }, { subscriptionIds: [1.5] }, { subscriptionIds: '1,2' },
    { subscriptionIds: Array.from({ length: 1001 }, (_, index) => index + 1) }, { triggeredById: 1 },
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  const future = await post({ runDate: '2026-11-01' });
  assert.equal(future.status, 400);
  assert.equal(future.body.error?.details?.[0]?.field, 'runDate');
  assert.equal(s.runs.rows.length, 0);
});

test('subscriptionIds restricts the run to those subscriptions; duplicates and unknown ids are ignored', async () => {
  const s = setup();
  s.addSub(1);
  s.addSub(2);
  s.addSub(3, { nextBillingDate: D('2026-12-01') });
  const run = await runOnce(s, { subscriptionIds: [3, 2, 2, 99] });
  assert.equal(s.dueCalls.length, 0);
  assert.deepEqual(s.invoices.map((invoice) => invoice.subscriptionId), [2]);
  assert.deepEqual(s.items.rows.map((item) => [item.subscriptionId, item.status]), [[3, 'SKIPPED'], [2, 'CREATED']]);
  assert.equal(s.items.rows[0]?.message, 'Next billing date is after the run date');
  assert.deepEqual([run.status, run.totalDue, run.createdCount, run.skippedCount], ['COMPLETED', 2, 1, 1]);
  assert.deepEqual(s.audit.entries[0]?.metadata?.subscriptionIds, [3, 2, 99]);
});

test('retry-failed reprocesses only FAILED items in place on the original date and recomputes the counters', async (t) => {
  const s = setup();
  s.clock.set('2026-10-30T10:00:00.000Z');
  s.addSub(1, { nextBillingDate: D('2026-10-30') });
  const broken = s.addSub(2, { nextBillingDate: D('2026-10-30'), failWith: new Error('boom') });
  const run = await runOnce(s, { autoConfirm: true });
  assert.equal(run.status, 'PARTIAL');

  s.clock.set(NOW);
  broken.failWith = null;
  const srv = await server(t, s);
  const response = await srv.request<ApiBody & { data: BillingRunDto }>(`/billing-runs/${run.id}/retry-failed`, { method: 'POST', role: Role.ADMIN });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'RUNNING');
  assert.equal(response.body.data.startedAt, NOW);
  await s.service.waitForIdle();

  const after = s.runs.find(run.id)!;
  assert.deepEqual([after.status, after.totalDue, after.createdCount, after.failedCount], ['COMPLETED', 2, 2, 0]);
  assert.equal(s.items.rows.length, 2);
  assert.equal(s.items.rows.find((item) => item.subscriptionId === 2)?.status, 'CREATED');
  const retried = s.invoices.find((invoice) => invoice.subscriptionId === 2)!;
  assert.deepEqual([retried.periodStart.toISOString(), retried.autoConfirm, retried.billingRunId], ['2026-10-30T00:00:00.000Z', false, run.id]);
  assert.equal(s.invoices.filter((invoice) => invoice.subscriptionId === 1).length, 1);
  assert.deepEqual(s.audit.actions(), ['billing-run.create', 'billing-run.retry-failed']);

  const again = await srv.request<ApiBody>(`/billing-runs/${run.id}/retry-failed`, { method: 'POST', role: Role.ADMIN });
  assert.equal(again.status, 409);
  assert.equal(again.body.error?.code, 'INVALID_STATE_TRANSITION');
  const running = seedRun(s, { runDate: D('2026-10-01').toISOString() });
  const busy = await srv.request<ApiBody>(`/billing-runs/${running.id}/retry-failed`, { method: 'POST', role: Role.ADMIN });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error?.code, 'BILLING_RUN_IN_PROGRESS');
  assert.equal((await srv.request<ApiBody>('/billing-runs/999/retry-failed', { method: 'POST', role: Role.ADMIN })).status, 404);
});

test('a crash while listing due subscriptions marks the run FAILED without an unhandled rejection', async () => {
  const s = setup();
  s.failures.listDue = new Error('database unavailable');
  const run = await runOnce(s);
  assert.equal(run.status, 'FAILED');
  assert.equal(run.finishedAt, NOW);
});

test('runScheduled: automatic run with triggeredById null and DRAFT invoices, once per date, deferred while a run is RUNNING', async () => {
  const s = setup();
  s.addSub(1);
  const manual = seedRun(s);
  assert.deepEqual(await s.service.runScheduled(), { outcome: 'IN_PROGRESS' });
  s.runs.update(manual.id, { status: 'COMPLETED' });

  const result = await s.service.runScheduled();
  assert.equal(result.outcome, 'FINISHED');
  assert.ok(result.outcome === 'FINISHED');
  assert.deepEqual([result.run.status, result.run.triggeredById, result.run.createdCount], ['COMPLETED', null, 1]);
  assert.deepEqual([s.invoices[0]?.autoConfirm, s.invoices[0]?.actor], [false, null]);
  assert.equal(s.audit.entries.at(-1)?.actor, null);
  assert.deepEqual(await s.service.runScheduled(), { outcome: 'ALREADY_RAN' });
});

test('list contracts: runs reject search and bad params, items accept search and filters, unknown run is 404', async (t) => {
  const s = setup();
  s.addSub(1);
  await runOnce(s);
  const srv = await server(t, s);
  const get = (path: string) => srv.request<ApiBody & { data: unknown[] }>(path, { role: Role.STAFF });
  for (const bad of [
    '?limit=101', '?page=0', '?sortBy=finishedAt', '?status=DONE', '?search=x', '?runFrom=yesterday', '?triggeredById=0', '?bogus=1',
  ]) {
    assert.equal((await get(`/billing-runs${bad}`)).status, 400, bad);
  }
  const ok = await get('/billing-runs?status=COMPLETED,PARTIAL&runFrom=2026-10-01&runTo=2026-10-31&triggeredById=2&sortBy=runDate&sortOrder=asc');
  assert.equal(ok.status, 200);
  const query = s.listCalls.runs.at(-1)!;
  assert.deepEqual(query.status, ['COMPLETED', 'PARTIAL']);
  assert.equal(query.runTo?.toISOString(), '2026-10-31T23:59:59.999Z');
  assert.deepEqual([query.triggeredById, query.sortBy, query.sortOrder], [2, 'runDate', 'asc']);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 10, total: 1, totalPages: 1, hasNext: false, hasPrev: false });
  await get('/billing-runs');
  assert.deepEqual([s.listCalls.runs.at(-1)?.sortBy, s.listCalls.runs.at(-1)?.sortOrder], ['startedAt', 'desc']);

  for (const bad of ['?sortBy=message', '?status=RUNNING', '?subscriptionId=x', '?search=']) {
    assert.equal((await get(`/billing-runs/1/items${bad}`)).status, 400, bad);
  }
  const items = await get('/billing-runs/1/items?search=SUB-2026&status=CREATED,FAILED&subscriptionId=1&sortBy=status');
  assert.equal(items.status, 200);
  const itemQuery = s.listCalls.items.at(-1)!;
  assert.deepEqual([itemQuery.search, itemQuery.status, itemQuery.subscriptionId, itemQuery.sortBy], ['SUB-2026', ['CREATED', 'FAILED'], 1, 'status']);
  assert.equal((await get('/billing-runs/77')).status, 404);
  assert.equal((await get('/billing-runs/77/items')).status, 404);
  assert.equal((await get('/billing-runs/abc')).status, 400);
});

test('the service refuses a CUSTOMER actor on every method', async () => {
  const s = setup();
  const customer = actorFor(Role.CUSTOMER);
  const query = { page: 1, limit: 10, sortBy: 'startedAt', sortOrder: 'desc' } as const;
  for (const call of [
    () => s.service.list(customer, query),
    () => s.service.get(customer, 1),
    () => s.service.create(customer, {}),
    () => s.service.retryFailed(customer, 1),
  ]) {
    await assert.rejects(call, (error: unknown) => error instanceof AppError && error.status === 403);
  }
});
