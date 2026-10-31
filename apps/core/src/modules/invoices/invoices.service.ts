import {
  InvoiceStatus, SubscriptionStatus,
  type InvoiceCompanyDto, type InvoiceDto, type InvoiceListItemDto, type InvoicePreviewDto, type InvoicePrintDto, type ListMeta,
} from '@brightloop/shared';
import { env } from '../../config/env.js';
import { AppError, badRequest, forbidden, notFound, validationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import type { InvoiceMailer } from '../../core/mail/emailjs.js';
import { isCustomer, isStaffOrAdmin, requireCustomerId, type Actor } from '../../core/utils/actor.js';
import {
  addDays, businessToday, periodEnd as periodEndOf, periodIndexAt, startOfUtcDay, toIsoDate,
} from '../../core/utils/dates.js';
import {
  alreadyBilled, classifyDbError, deliveryFailed, discountNotApplicable, invalidStateTransition, nothingToBill,
} from '../../core/utils/domain-errors.js';
import { formatRupees, lineAmount, sumPaise, taxOnLine } from '../../core/utils/money.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import type { CustomersGateway } from '../customers/customers.gateway.js';
import type { DiscountApplication, DiscountsGateway } from '../discounts/discounts.gateway.js';
import type { PaymentTermRecord, PaymentTermsGateway } from '../payment-terms/payment-terms.gateway.js';
import type { BillingSubscription, BillingSubscriptionLine, SubscriptionsGateway } from '../subscriptions/subscriptions.gateway.js';
import {
  toDetailDto, toListItemDto, toPreviewDto, toPrintDto, type ComputedInvoice, type DetailParts,
} from './invoices.dto.js';
import type {
  GenerateInvoiceOptions, GenerateInvoiceOutcome, InvoicesGateway,
} from './invoices.gateway.js';
import type {
  GenerateWrite, InvoiceLineWrite, InvoiceRow, InvoiceScope, InvoicesRepository, Names,
} from './invoices.repository.js';
import type {
  CancelInvoiceInput, GenerateInvoiceInput, ListInvoicesParams, UpdateInvoiceInput,
} from './invoices.schema.js';

const MAX_INT4 = 2147483647;
const VISIBLE_TO_CUSTOMER = [InvoiceStatus.CONFIRMED, InvoiceStatus.PAID] as const;
const MAX_DISCOUNT_RETRIES = 1;

type Skipped = Extract<GenerateInvoiceOutcome, { status: 'SKIPPED' }>;

interface Period {
  sub: BillingSubscription;
  periodStart: Date;
  periodEnd: Date;
}

const skipNothing = (message: string): Skipped => ({ status: 'SKIPPED', reason: 'NOTHING_TO_BILL', message });

function assertFits(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value > MAX_INT4) {
    throw badRequest(`Invoice ${label} exceeds the supported maximum`);
  }
}

/**
 * Pure money math for one invoice (backend plan 3.4). Per line: `amount = quantity * unitPrice
 * - discounts`, tax on the discounted amount, rounded per line. Totals are the exact sums of
 * the stored lines. One usage row per distinct discount carries that discount's total.
 */
export function computeInvoice(
  lines: readonly BillingSubscriptionLine[],
  applications: readonly DiscountApplication[],
  productNames: ReadonlyMap<number, string> = new Map(),
): ComputedInvoice {
  const byLine = new Map<number, DiscountApplication[]>();
  for (const application of applications) {
    if (application.lineId === null || !lines.some((line) => line.id === application.lineId)) {
      throw new Error('Discount application does not match a subscription line');
    }
    byLine.set(application.lineId, [...(byLine.get(application.lineId) ?? []), application]);
  }

  const written: InvoiceLineWrite[] = lines.map((line, index) => {
    const gross = lineAmount(line.quantity, line.unitPrice);
    const applied = byLine.get(line.id) ?? [];
    const discountAmount = sumPaise(applied.map((application) => application.amount));
    if (discountAmount > gross) throw new Error('Discount exceeds the line amount');
    const amount = gross - discountAmount;
    if (line.taxId !== null && line.taxType === null) throw new Error('Subscription line tax cannot be resolved');
    const taxAmount = line.taxId === null || line.taxType === null
      ? 0
      : taxOnLine(line.taxType, line.taxRate, amount, line.quantity);
    const discountIds = [...new Set(applied.map((application) => application.discountId))];
    return {
      productId: line.productId,
      variantId: line.variantId,
      taxId: line.taxId,
      discountId: discountIds.length === 1 ? discountIds[0]! : null,
      description: line.description ?? productNames.get(line.productId) ?? `Product #${line.productId}`,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount,
      taxRate: line.taxId === null ? 0 : line.taxRate,
      taxAmount,
      amount,
      sortOrder: index,
    };
  });

  const perDiscount = new Map<number, number[]>();
  for (const application of applications) {
    perDiscount.set(application.discountId, [...(perDiscount.get(application.discountId) ?? []), application.amount]);
  }
  const usages = [...perDiscount.entries()]
    .sort(([a], [b]) => a - b)
    .map(([discountId, amounts]) => ({ discountId, amount: sumPaise(amounts) }));

  const subtotal = sumPaise(written.map((line) => line.amount));
  const discountTotal = sumPaise(written.map((line) => line.discountAmount));
  const taxTotal = sumPaise(written.map((line) => line.taxAmount));
  const total = sumPaise([subtotal, taxTotal]);
  for (const [label, value] of [['subtotal', subtotal], ['discount total', discountTotal], ['tax total', taxTotal], ['total', total]] as const) {
    assertFits(label, value);
  }
  return { lines: written, usages, subtotal, discountTotal, taxTotal, total };
}

export class InvoicesService implements InvoicesGateway {
  constructor(
    private readonly repository: InvoicesRepository,
    private readonly subscriptions: SubscriptionsGateway,
    private readonly discounts: DiscountsGateway,
    private readonly paymentTerms: PaymentTermsGateway,
    private readonly customers: CustomersGateway,
    private readonly audit: AuditGateway,
    private readonly mailer: InvoiceMailer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(actor: Actor, query: ListInvoicesParams): Promise<{ invoices: InvoiceListItemDto[]; meta: ListMeta }> {
    const scope = this.scopeFor(actor);
    const listScope = { ...scope, today: this.today() };
    const [rows, total] = await Promise.all([
      this.repository.list(query, listScope),
      this.repository.count(query, listScope),
    ]);
    const names = await this.repository.lookupNames({ subscriptionIds: rows.map((row) => row.subscriptionId) });
    const today = this.today();
    return {
      invoices: rows.map((row) => toListItemDto(row, names.subscriptions.get(row.subscriptionId) ?? '', today, actor)),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }

  async get(actor: Actor, id: number): Promise<InvoiceDto> {
    const row = await this.requireVisible(actor, id);
    return this.detail(actor, row);
  }

  /** The next invoice for the subscription, computed without writing anything. */
  async preview(actor: Actor, subscriptionId: number): Promise<InvoicePreviewDto> {
    this.assertStaff(actor);
    const period = await this.loadPeriod(subscriptionId, this.today(), false);
    if ('status' in period) throw nothingToBill(period.message);
    const issueDate = this.today();
    const computed = await this.compute(period.sub, issueDate, new Set());
    const [snapshot, term] = await Promise.all([
      this.customers.snapshot(period.sub.customerId),
      this.resolveTerm(period.sub.paymentTermId),
    ]);
    const names = await this.repository.lookupNames({
      productIds: period.sub.lines.map((line) => line.productId),
      variantIds: period.sub.lines.flatMap((line) => (line.variantId === null ? [] : [line.variantId])),
      taxIds: period.sub.lines.flatMap((line) => (line.taxId === null ? [] : [line.taxId])),
      discountIds: computed.usages.map((usage) => usage.discountId),
    });
    return toPreviewDto({
      subscriptionId: period.sub.id,
      subscriptionNumber: period.sub.number,
      customerId: period.sub.customerId,
      customerName: snapshot.name,
      customerEmail: snapshot.email,
      customerTaxId: snapshot.taxId,
      billingAddress: snapshot.billingAddress,
      paymentTermId: term?.id ?? null,
      paymentTermName: term?.name ?? null,
      currency: env.DEFAULT_CURRENCY,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      issueDate,
      dueDate: addDays(issueDate, term?.dueDays ?? 0),
      computed,
    }, names);
  }

  /** Manual endpoint: one period. 409 NOTHING_TO_BILL or ALREADY_BILLED when nothing was created. */
  async generate(actor: Actor, input: GenerateInvoiceInput, ip?: string): Promise<InvoiceDto> {
    this.assertStaff(actor);
    const today = this.today();
    const asOf = input.asOf ?? today;
    if (asOf.getTime() > today.getTime()) {
      throw validationError('Validation failed', [{ field: 'asOf', message: 'asOf cannot be in the future' }]);
    }
    const outcome = await this.generateOne(input.subscriptionId, asOf, {
      ...(input.autoConfirm === undefined ? {} : { autoConfirm: input.autoConfirm }),
      actor,
    }, ip);
    if (outcome.status === 'SKIPPED') {
      throw outcome.reason === 'ALREADY_BILLED' ? alreadyBilled(outcome.message) : nothingToBill(outcome.message);
    }
    const row = await this.repository.findById(outcome.invoiceId);
    if (row === null) throw notFound('Invoice not found');
    return this.detail(actor, row);
  }

  async generateForSubscription(
    subscriptionId: number,
    asOf: Date,
    opts: GenerateInvoiceOptions,
  ): Promise<GenerateInvoiceOutcome> {
    if (opts.actor !== null) this.assertStaff(opts.actor);
    return this.generateOne(subscriptionId, asOf, opts);
  }

  /** DRAFT only: `notes` and `dueDate` (not before the issue date). */
  async update(actor: Actor, id: number, patch: UpdateInvoiceInput, ip?: string): Promise<InvoiceDto> {
    this.assertStaff(actor);
    const existing = await this.requireInvoice(id);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw invalidStateTransition(`Only a DRAFT invoice can be edited (this invoice is ${existing.status})`);
    }
    if (patch.dueDate !== undefined && patch.dueDate.getTime() < startOfUtcDay(new Date(existing.issueDate)).getTime()) {
      throw validationError('Validation failed', [{ field: 'dueDate', message: 'dueDate cannot be before the issue date' }]);
    }
    const row = await this.repository.updateDraft(id, {
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    });
    if (row === null) throw invalidStateTransition('The invoice is no longer a DRAFT');
    await this.audit.record({
      actor, action: 'invoice.update', entityType: 'Invoice', entityId: id, ip,
      metadata: {
        changes: {
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate.toISOString() } : {}),
        },
        previous: {
          ...(patch.notes !== undefined ? { notes: existing.notes } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: existing.dueDate } : {}),
        },
      },
    });
    return this.detail(actor, row);
  }

  /** DRAFT -> CONFIRMED with `amountDue = total` (a zero total is settled at once and becomes PAID). */
  async confirm(actor: Actor, id: number, ip?: string): Promise<InvoiceDto> {
    this.assertStaff(actor);
    const existing = await this.requireInvoice(id);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw invalidStateTransition(`Only a DRAFT invoice can be confirmed (this invoice is ${existing.status})`);
    }
    const row = await this.repository.confirm(id, {
      total: existing.total, now: this.clock(), settled: existing.total === 0,
    });
    if (row === null) throw invalidStateTransition('The invoice is no longer a DRAFT');
    await this.audit.record({
      actor, action: 'invoice.confirm', entityType: 'Invoice', entityId: id, ip,
      metadata: { number: row.number, total: row.total, status: row.status },
    });
    return this.detail(actor, row);
  }

  /** Reason required. Blocked once a payment exists. Releases discount usage; never moves `nextBillingDate`. */
  async cancel(actor: Actor, id: number, input: CancelInvoiceInput, ip?: string): Promise<InvoiceDto> {
    this.assertStaff(actor);
    const existing = await this.requireInvoice(id);
    this.assertCancellable(existing);
    const row = await this.repository.cancel(id, input.reason, this.clock());
    if (row === null) {
      const fresh = await this.requireInvoice(id);
      this.assertCancellable(fresh);
      throw invalidStateTransition('The invoice could not be cancelled because it changed. Please retry');
    }
    await this.audit.record({
      actor, action: 'invoice.cancel', entityType: 'Invoice', entityId: id, ip,
      metadata: { number: row.number, reason: input.reason, previousStatus: existing.status },
    });
    return this.detail(actor, row);
  }

  /**
   * Emails the invoice summary (CONFIRMED or PAID only). A failed delivery changes nothing, so
   * it can be retried; `sentAt` is set only after the mailer succeeded.
   */
  async send(actor: Actor, id: number, ip?: string): Promise<InvoiceDto> {
    this.assertStaff(actor);
    const existing = await this.requireInvoice(id);
    if (existing.status !== InvoiceStatus.CONFIRMED && existing.status !== InvoiceStatus.PAID) {
      throw invalidStateTransition(`Only a CONFIRMED or PAID invoice can be sent (this invoice is ${existing.status})`);
    }
    try {
      await this.mailer.sendInvoice({
        toEmail: existing.customerEmail,
        name: existing.customerName,
        invoiceNumber: existing.number,
        total: `${existing.currency} ${formatRupees(existing.total)}`,
        dueDate: toIsoDate(new Date(existing.dueDate)),
        portalUrl: `${env.APP_PUBLIC_URL.replace(/\/+$/, '')}/portal/invoices/${existing.id}`,
      });
    } catch (error) {
      if (error instanceof AppError) throw deliveryFailed(error.message);
      logger.error({ err: error, invoiceId: id }, 'invoice email failed');
      throw deliveryFailed();
    }
    const row = await this.repository.markSent(id, this.clock());
    if (row === null) throw invalidStateTransition('The invoice changed state while it was being sent');
    await this.audit.record({
      actor, action: 'invoice.send', entityType: 'Invoice', entityId: id, ip,
      metadata: { number: row.number },
    });
    return this.detail(actor, row);
  }

  async print(actor: Actor, id: number): Promise<InvoicePrintDto> {
    const row = await this.requireVisible(actor, id);
    const parts = await this.loadParts(row);
    return toPrintDto(row, parts, parts.names.subscriptions.get(row.subscriptionId) ?? '', this.company());
  }

  private async generateOne(
    subscriptionId: number,
    asOf: Date,
    opts: GenerateInvoiceOptions,
    ip?: string,
  ): Promise<GenerateInvoiceOutcome> {
    const asOfDay = startOfUtcDay(asOf);
    const excluded = new Set<number>();
    for (let attempt = 0; attempt <= MAX_DISCOUNT_RETRIES; attempt += 1) {
      const period = await this.loadPeriod(subscriptionId, asOfDay, true);
      if ('status' in period) return period;
      const write = await this.buildWrite(period, asOfDay, opts, excluded);
      let result;
      try {
        result = await this.repository.generate(write);
      } catch (error) {
        if (classifyDbError(error) === 'unique') {
          return { status: 'SKIPPED', reason: 'ALREADY_BILLED', message: 'This billing period has already been invoiced' };
        }
        throw error;
      }
      if (result.kind === 'STALE') {
        return { status: 'SKIPPED', reason: 'ALREADY_BILLED', message: 'This billing period has already been invoiced' };
      }
      if (result.kind === 'DISCOUNT_LIMIT') {
        excluded.add(result.discountId);
        continue;
      }
      await this.audit.record({
        actor: opts.actor, action: 'invoice.generate', entityType: 'Invoice', entityId: result.invoice.id, ip,
        metadata: {
          number: result.invoice.number, subscriptionId, status: result.invoice.status, total: result.invoice.total,
          periodStart: write.periodStart.toISOString(), periodEnd: write.periodEnd.toISOString(),
          autoConfirm: opts.autoConfirm ?? false, billingRunId: opts.billingRunId ?? null,
          discountIds: write.usages.map((usage) => usage.discountId),
        },
      });
      return { status: 'CREATED', invoiceId: result.invoice.id, number: result.invoice.number };
    }
    throw discountNotApplicable('A discount reached its usage limit while the invoice was generated. Please retry');
  }

  /**
   * ACTIVE, with a billing date that is due (`requireDue`) and not after the expiry. Returns
   * the SKIPPED outcome with the reason otherwise. The period is `[nextBillingDate, next boundary)`
   * computed from the `startDate` anchor, so month ends do not drift.
   */
  private async loadPeriod(subscriptionId: number, asOfDay: Date, requireDue: boolean): Promise<Period | Skipped> {
    const sub = await this.subscriptions.getForBilling(subscriptionId);
    if (sub === null) throw notFound('Subscription not found');
    if (sub.status !== SubscriptionStatus.ACTIVE) {
      return skipNothing(`Subscription is ${sub.status}; only ACTIVE subscriptions are billed`);
    }
    if (sub.nextBillingDate === null) return skipNothing('Subscription has no next billing date');
    const periodStart = startOfUtcDay(sub.nextBillingDate);
    if (requireDue && periodStart.getTime() > asOfDay.getTime()) {
      return skipNothing(`Next billing date is ${toIsoDate(periodStart)}, after ${toIsoDate(asOfDay)}`);
    }
    if (sub.expiryDate !== null && periodStart.getTime() > startOfUtcDay(sub.expiryDate).getTime()) {
      return skipNothing('Subscription expired before the next billing period');
    }
    if (sub.lines.length === 0) return skipNothing('Subscription has no lines to bill');
    const index = periodIndexAt(sub.startDate, sub.billingPeriod, periodStart);
    if (index === null) throw new Error(`Subscription ${sub.id} next billing date is not on a period boundary`);
    return { sub, periodStart, periodEnd: periodEndOf(sub.startDate, sub.billingPeriod, index) };
  }

  /** Evaluates discounts (pure read) and computes the lines. Excluded discounts are dropped. */
  private async compute(sub: BillingSubscription, issueDate: Date, excluded: ReadonlySet<number>): Promise<ComputedInvoice> {
    const evaluated = await this.discounts.evaluate({
      subscriptionId: sub.id,
      lines: sub.lines.map((line) => ({
        lineId: line.id,
        productId: line.productId,
        quantity: line.quantity,
        amount: lineAmount(line.quantity, line.unitPrice),
      })),
      asOf: issueDate,
    });
    const applications = evaluated.filter((application) => !excluded.has(application.discountId));
    const unnamed = sub.lines.filter((line) => line.description === null).map((line) => line.productId);
    const productNames = unnamed.length === 0
      ? new Map<number, string>()
      : (await this.repository.lookupNames({ productIds: unnamed })).products;
    return computeInvoice(sub.lines, applications, productNames);
  }

  private async buildWrite(
    period: Period,
    asOfDay: Date,
    opts: GenerateInvoiceOptions,
    excluded: ReadonlySet<number>,
  ): Promise<GenerateWrite> {
    const { sub } = period;
    const issueDate = asOfDay;
    const computed = await this.compute(sub, issueDate, excluded);
    const [snapshot, term] = await Promise.all([
      this.customers.snapshot(sub.customerId),
      this.resolveTerm(sub.paymentTermId),
    ]);
    const now = this.clock();
    const autoConfirm = opts.autoConfirm === true;
    const settled = autoConfirm && computed.total === 0;
    return {
      subscriptionId: sub.id,
      customerId: sub.customerId,
      paymentTermId: term?.id ?? null,
      year: businessToday(now).getUTCFullYear(),
      status: settled ? InvoiceStatus.PAID : autoConfirm ? InvoiceStatus.CONFIRMED : InvoiceStatus.DRAFT,
      currency: env.DEFAULT_CURRENCY,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      issueDate,
      dueDate: addDays(issueDate, term?.dueDays ?? 0),
      customerName: snapshot.name,
      customerEmail: snapshot.email,
      customerTaxId: snapshot.taxId,
      billingAddress: snapshot.billingAddress,
      subtotal: computed.subtotal,
      discountTotal: computed.discountTotal,
      taxTotal: computed.taxTotal,
      total: computed.total,
      amountDue: autoConfirm && !settled ? computed.total : 0,
      confirmedAt: autoConfirm ? now : null,
      paidAt: settled ? now : null,
      billingRunId: opts.billingRunId ?? null,
      createdById: opts.actor?.userId ?? null,
      expectedNextBillingDate: sub.nextBillingDate ?? period.periodStart,
      lines: computed.lines,
      usages: computed.usages,
    };
  }

  /** The subscription's term, else the default term, else none (due the same day). */
  private async resolveTerm(paymentTermId: number | null): Promise<PaymentTermRecord | null> {
    if (paymentTermId !== null) {
      const term = await this.paymentTerms.getById(paymentTermId);
      if (term !== null) return term;
    }
    return this.paymentTerms.getDefault();
  }

  private async detail(actor: Actor, row: InvoiceRow): Promise<InvoiceDto> {
    return toDetailDto(row, await this.loadParts(row), this.today(), actor);
  }

  private async loadParts(row: InvoiceRow): Promise<DetailParts> {
    const [lines, payments, usages] = await Promise.all([
      this.repository.listLines(row.id),
      this.repository.listPayments(row.id),
      this.repository.listDiscountUsages(row.id),
    ]);
    const names: Names = await this.repository.lookupNames({
      subscriptionIds: [row.subscriptionId, ...usages.map((usage) => usage.subscriptionId)],
      productIds: lines.flatMap((line) => (line.productId === null ? [] : [line.productId])),
      variantIds: lines.flatMap((line) => (line.variantId === null ? [] : [line.variantId])),
      taxIds: lines.flatMap((line) => (line.taxId === null ? [] : [line.taxId])),
      discountIds: [
        ...lines.flatMap((line) => (line.discountId === null ? [] : [line.discountId])),
        ...usages.map((usage) => usage.discountId),
      ],
      paymentTermIds: row.paymentTermId === null ? [] : [row.paymentTermId],
      userIds: payments.flatMap((payment) => (payment.recordedById === null ? [] : [payment.recordedById])),
    });
    return { lines, payments, usages, names };
  }

  private assertCancellable(row: InvoiceRow): void {
    if (row.status !== InvoiceStatus.DRAFT && row.status !== InvoiceStatus.CONFIRMED) {
      throw invalidStateTransition(`A ${row.status} invoice cannot be cancelled`);
    }
    if (row.amountPaid > 0) {
      throw invalidStateTransition('An invoice with payments cannot be cancelled. Delete the payments first');
    }
  }

  private company(): InvoiceCompanyDto {
    return {
      name: env.COMPANY_NAME,
      email: null,
      phone: null,
      taxId: env.COMPANY_TAX_ID === '' ? null : env.COMPANY_TAX_ID,
      address: env.COMPANY_ADDRESS === '' ? null : env.COMPANY_ADDRESS,
      logoUrl: null,
    };
  }

  private today(): Date {
    return businessToday(this.clock());
  }

  /** Staff see everything; a CUSTOMER sees only their own CONFIRMED and PAID invoices. */
  private scopeFor(actor: Actor): InvoiceScope {
    if (isCustomer(actor)) {
      return { customerId: requireCustomerId(actor), statuses: VISIBLE_TO_CUSTOMER };
    }
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
    return {};
  }

  private async requireVisible(actor: Actor, id: number): Promise<InvoiceRow> {
    const row = await this.repository.findById(id, this.scopeFor(actor));
    if (row === null) throw notFound('Invoice not found');
    return row;
  }

  private async requireInvoice(id: number): Promise<InvoiceRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound('Invoice not found');
    return row;
  }

  private assertStaff(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}
