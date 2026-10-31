/**
 * Performance seed for reports and list endpoints (backend plan F5).
 *
 *   bun run seed:perf                      dry run: prints what would happen
 *   bun run seed:perf -- --yes             seed 5k customers, 10k subscriptions, 30k invoices and payments
 *   bun run seed:perf -- --yes --scale 0.01   a 1% trial run
 *   bun run seed:perf -- --clean --yes     delete only the rows this script created
 *   bun run seed:perf -- --reset --yes     clean, then seed again
 *
 * Development databases only: refuses to run when NODE_ENV is production.
 * Everything it creates is tagged (PERF-SUB-/PERF-INV-/PERF-PAY- numbers,
 * perf-customer-*@perf.brightloop.test emails, "PERF " plan names) and cleanup
 * deletes by those tags alone, never touching other data.
 */

import { pathToFileURL } from 'node:url';
import { BillingPeriod, InvoiceStatus, PaymentMethod, SubscriptionStatus } from '@brightloop/shared';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../core/logger.js';
import { addDays, businessToday, firstBoundaryOnOrAfter, periodEnd, periodStart } from '../core/utils/dates.js';
import { bpsOf } from '../core/utils/money.js';

const BATCH = 500;
const GST_BPS = 1800;
const CUSTOMER_EMAIL_PATTERN = 'perf-customer-%@perf.brightloop.test';

interface Options {
  yes: boolean;
  clean: boolean;
  reset: boolean;
  scale: number;
}

type InvoiceCreate = Parameters<typeof prisma.orm.public.Invoice.createAll>[0][number];

interface SeededSubscription {
  id: number;
  customerId: number;
  customerName: string;
  customerEmail: string;
  period: BillingPeriod;
  start: Date;
  billable: boolean;
}

export function parseOptions(argv: readonly string[]): Options {
  const scaleIndex = argv.indexOf('--scale');
  const scale = scaleIndex >= 0 ? Number(argv[scaleIndex + 1]) : 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new Error('--scale must be a number greater than 0 and at most 1');
  }
  return {
    yes: argv.includes('--yes'),
    clean: argv.includes('--clean'),
    reset: argv.includes('--reset'),
    scale,
  };
}

/** Deterministic pseudo-random numbers so every run produces the same data shape. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

const iso = (date: Date): string => date.toISOString();

async function countPerfData(): Promise<{ customers: number; subscriptions: number; invoices: number; payments: number; plans: number }> {
  const [customers, subscriptions, invoices, payments, plans] = await Promise.all([
    prisma.orm.public.Customer.where((row) => row.email.ilike(CUSTOMER_EMAIL_PATTERN)).aggregate((agg) => ({ n: agg.count() })),
    prisma.orm.public.Subscription.where((row) => row.number.ilike('PERF-SUB-%')).aggregate((agg) => ({ n: agg.count() })),
    prisma.orm.public.Invoice.where((row) => row.number.ilike('PERF-INV-%')).aggregate((agg) => ({ n: agg.count() })),
    prisma.orm.public.Payment.where((row) => row.reference.ilike('PERF-PAY-%')).aggregate((agg) => ({ n: agg.count() })),
    prisma.orm.public.Plan.where((row) => row.name.ilike('PERF %')).aggregate((agg) => ({ n: agg.count() })),
  ]);
  return {
    customers: customers.n, subscriptions: subscriptions.n, invoices: invoices.n,
    payments: payments.n, plans: plans.n,
  };
}

export async function cleanPerfData(): Promise<void> {
  await prisma.orm.public.Payment.where((row) => row.reference.ilike('PERF-PAY-%')).deleteAll();
  await prisma.orm.public.Invoice.where((row) => row.number.ilike('PERF-INV-%')).deleteAll();
  await prisma.orm.public.Subscription.where((row) => row.number.ilike('PERF-SUB-%')).deleteAll();
  await prisma.orm.public.Customer.where((row) => row.email.ilike(CUSTOMER_EMAIL_PATTERN)).deleteAll();
  await prisma.orm.public.Plan.where((row) => row.name.ilike('PERF %')).deleteAll();
}

export async function seedPerfData(scale: number): Promise<void> {
  const customerTotal = Math.max(1, Math.round(5000 * scale));
  const subscriptionTotal = Math.max(1, Math.round(10000 * scale));
  const invoiceTarget = Math.max(1, Math.round(30000 * scale));
  const rng = createRng(20261031);
  const today = businessToday();
  const cities = ['Mumbai', 'Pune', 'Bengaluru', 'Delhi', 'Chennai', 'Hyderabad', 'Kolkata', 'Ahmedabad'];

  const planDefs = [
    { name: 'PERF Monthly', period: BillingPeriod.MONTHLY, price: 99900 },
    { name: 'PERF Yearly', period: BillingPeriod.YEARLY, price: 999900 },
    { name: 'PERF Weekly', period: BillingPeriod.WEEKLY, price: 29900 },
  ];
  const plans = await prisma.orm.public.Plan.createAll(planDefs.map((plan) => ({
    name: plan.name, price: plan.price, billingPeriod: plan.period, minQuantity: 1,
    availableFrom: iso(addDays(today, -1500)), autoClose: false, closable: true, pausable: true, renewable: true,
  })));
  const planByIndex = planDefs.map((def, index) => ({ id: plans[index]!.id, period: def.period }));

  const customerRows = Array.from({ length: customerTotal }, (_, index) => ({
    name: `Perf Customer ${index + 1}`,
    email: `perf-customer-${index + 1}@perf.brightloop.test`,
    phone: `90000${String(index).padStart(5, '0')}`,
    city: cities[index % cities.length]!,
    state: 'MH',
    country: 'IN',
    notes: 'seed:perf',
  }));
  const customers: { id: number; name: string; email: string }[] = [];
  for (const batch of chunk(customerRows, BATCH)) {
    const created = await prisma.orm.public.Customer.createAll(batch);
    customers.push(...created.map((row) => ({ id: row.id, name: row.name, email: row.email })));
  }
  logger.info({ customers: customers.length }, 'seed:perf customers created');

  const periodDays: Record<BillingPeriod, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 };
  const statuses = [
    ...Array<SubscriptionStatus>(70).fill(SubscriptionStatus.ACTIVE),
    ...Array<SubscriptionStatus>(8).fill(SubscriptionStatus.PAUSED),
    ...Array<SubscriptionStatus>(7).fill(SubscriptionStatus.CLOSED),
    ...Array<SubscriptionStatus>(5).fill(SubscriptionStatus.CONFIRMED),
    ...Array<SubscriptionStatus>(5).fill(SubscriptionStatus.QUOTATION),
    ...Array<SubscriptionStatus>(5).fill(SubscriptionStatus.DRAFT),
  ];

  const assigned = Array.from({ length: subscriptionTotal }, () => statuses[Math.floor(rng() * statuses.length)]!);
  const billableCount = assigned.filter((status) => status === SubscriptionStatus.ACTIVE
    || status === SubscriptionStatus.PAUSED || status === SubscriptionStatus.CLOSED).length;
  // The newest invoice period of every subscription starts within the last billing period, so
  // some invoices are not yet due and the rest are overdue by varying amounts.
  const lastPeriodIndex = Math.max(0, Math.ceil(invoiceTarget / Math.max(1, billableCount)) - 1);

  const subscriptionDrafts = Array.from({ length: subscriptionTotal }, (_, index) => {
    const customer = customers[index % customers.length]!;
    const planIndex = index % 10 < 6 ? 0 : index % 10 < 8 ? 1 : 2;
    const plan = planByIndex[planIndex]!;
    const status = assigned[index]!;
    const start = addDays(today, -(lastPeriodIndex * periodDays[plan.period] + Math.floor(rng() * periodDays[plan.period])));
    const subtotal = 50000 + Math.floor(rng() * 1950000);
    const taxTotal = bpsOf(subtotal, GST_BPS);
    const live = status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.PAUSED;
    const started = live || status === SubscriptionStatus.CLOSED;
    const nextBilling = status === SubscriptionStatus.ACTIVE ? firstBoundaryOnOrAfter(start, plan.period, today) : null;
    return {
      customer, plan, status, start, started,
      row: {
        number: `PERF-SUB-${index + 1}`,
        customerId: customer.id,
        planId: plan.id,
        status,
        startDate: iso(start),
        expiryDate: index % 4 === 0 ? iso(addDays(today, 5 + Math.floor(rng() * 120))) : null,
        nextBillingDate: nextBilling === null ? null : iso(nextBilling),
        confirmedAt: started || status === SubscriptionStatus.CONFIRMED ? iso(start) : null,
        activatedAt: started ? iso(start) : null,
        pausedAt: status === SubscriptionStatus.PAUSED ? iso(addDays(today, -10)) : null,
        closedAt: status === SubscriptionStatus.CLOSED ? iso(addDays(today, -20)) : null,
        closeReason: status === SubscriptionStatus.CLOSED ? 'seed:perf' : null,
        subtotal, taxTotal, total: subtotal + taxTotal, recurringAmount: subtotal,
        notes: 'seed:perf',
      },
    };
  });

  const subscriptions: SeededSubscription[] = [];
  for (const batch of chunk(subscriptionDrafts, BATCH)) {
    const created = await prisma.orm.public.Subscription.createAll(batch.map((draft) => draft.row));
    created.forEach((row, offset) => {
      const draft = batch[offset]!;
      subscriptions.push({
        id: row.id, customerId: draft.customer.id, customerName: draft.customer.name, customerEmail: draft.customer.email,
        period: draft.plan.period, start: draft.start, billable: draft.started,
      });
    });
  }
  logger.info({ subscriptions: subscriptions.length }, 'seed:perf subscriptions created');

  const billable = subscriptions.filter((subscription) => subscription.billable);
  if (billable.length === 0) throw new Error('No billable subscriptions were generated; raise --scale');

  const methods = Object.values(PaymentMethod);
  let invoiceSequence = 0;
  let paymentSequence = 0;
  let paymentsCreated = 0;
  const invoiceDrafts: { row: InvoiceCreate; paid: number; issue: Date }[] = [];
  for (let k = 0; invoiceDrafts.length < invoiceTarget; k += 1) {
    for (const subscription of billable) {
      if (invoiceDrafts.length >= invoiceTarget) break;
      invoiceSequence += 1;
      const start = periodStart(subscription.start, subscription.period, k);
      const end = periodEnd(subscription.start, subscription.period, k);
      const subtotal = 50000 + Math.floor(rng() * 450000);
      const taxTotal = bpsOf(subtotal, GST_BPS);
      const total = subtotal + taxTotal;
      const roll = rng();
      const status = roll < 0.55 ? InvoiceStatus.PAID : roll < 0.88 ? InvoiceStatus.CONFIRMED
        : roll < 0.93 ? InvoiceStatus.CANCELLED : InvoiceStatus.DRAFT;
      const partial = status === InvoiceStatus.CONFIRMED && rng() < 0.25;
      const paid = status === InvoiceStatus.PAID ? total : partial ? Math.floor(total * 0.4) : 0;
      const confirmed = status === InvoiceStatus.CONFIRMED || status === InvoiceStatus.PAID;
      invoiceDrafts.push({
        issue: start,
        paid,
        row: {
          number: `PERF-INV-${invoiceSequence}`,
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          status,
          periodStart: iso(start),
          periodEnd: iso(end),
          issueDate: iso(start),
          dueDate: iso(addDays(start, 15)),
          customerName: subscription.customerName,
          customerEmail: subscription.customerEmail,
          subtotal, taxTotal, total,
          amountPaid: paid,
          amountDue: status === InvoiceStatus.CONFIRMED || status === InvoiceStatus.PAID ? total - paid : 0,
          confirmedAt: confirmed ? iso(start) : null,
          paidAt: status === InvoiceStatus.PAID ? iso(addDays(start, 3)) : null,
          cancelledAt: status === InvoiceStatus.CANCELLED ? iso(addDays(start, 1)) : null,
          cancelReason: status === InvoiceStatus.CANCELLED ? 'seed:perf' : null,
          notes: 'seed:perf',
        },
      });
    }
  }

  for (const batch of chunk(invoiceDrafts, BATCH)) {
    const created = await prisma.orm.public.Invoice.createAll(batch.map((draft) => draft.row));
    const payments = created.flatMap((row, offset) => {
      const draft = batch[offset]!;
      if (draft.paid <= 0) return [];
      paymentSequence += 1;
      const paymentDate = new Date(Math.min(addDays(draft.issue, 3).getTime(), today.getTime()));
      return [{
        invoiceId: row.id,
        customerId: row.customerId,
        method: methods[paymentSequence % methods.length]!,
        amount: draft.paid,
        paymentDate: iso(paymentDate),
        reference: `PERF-PAY-${paymentSequence}`,
      }];
    });
    if (payments.length > 0) {
      await prisma.orm.public.Payment.createAll(payments);
      paymentsCreated += payments.length;
    }
  }
  logger.info({ invoices: invoiceDrafts.length, payments: paymentsCreated }, 'seed:perf invoices and payments created');
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:perf refuses to run when NODE_ENV is production');
  }
  const options = parseOptions(process.argv.slice(2));
  const existing = await countPerfData();
  const hasData = Object.values(existing).some((count) => count > 0);

  if (!options.yes) {
    process.stdout.write(
      `Dry run. Existing perf rows: ${JSON.stringify(existing)}.\n` +
      `Add --yes to ${options.clean ? 'delete the perf rows' : `seed at scale ${options.scale}`}.\n`,
    );
    return;
  }
  if (options.clean || options.reset) {
    await cleanPerfData();
    logger.info('seed:perf data removed');
    if (options.clean && !options.reset) return;
  } else if (hasData) {
    throw new Error('Perf data already exists. Run with --reset --yes to replace it, or --clean --yes to remove it.');
  }
  await seedPerfData(options.scale);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } finally {
    await prisma.close();
  }
}
