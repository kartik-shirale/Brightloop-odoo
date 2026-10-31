import {
  SequenceKey, SubscriptionStatus,
  type ListMeta, type SubscriptionDto, type SubscriptionLineDto, type SubscriptionListItemDto,
} from '@brightloop/shared';
import { AppError, forbidden, notFound, validationError } from '../../core/errors.js';
import { isAdmin, isCustomer, isStaffOrAdmin, requireCustomerId, type Actor } from '../../core/utils/actor.js';
import { addDays, businessToday, firstBoundaryOnOrAfter, startOfUtcDay, toIsoDate } from '../../core/utils/dates.js';
import {
  actionNotAllowedByPlan, invalidStateTransition, planNotAvailable, quotationExpired, rethrowDbError,
} from '../../core/utils/domain-errors.js';
import { lineAmount, sumPaise, taxOnLine } from '../../core/utils/money.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import type { CustomersGateway } from '../customers/customers.gateway.js';
import type { DiscountsGateway } from '../discounts/discounts.gateway.js';
import type { PaymentTermsGateway } from '../payment-terms/payment-terms.gateway.js';
import type { PlanRecord, PlansGateway } from '../plans/plans.gateway.js';
import type { CatalogGateway, PricedItem } from '../products/products.gateway.js';
import type { TemplatesGateway } from '../quotation-templates/quotation-templates.gateway.js';
import type { SequenceGateway } from '../sequences/sequences.gateway.js';
import type { TaxesGateway, TaxRecord } from '../taxes/taxes.gateway.js';
import {
  ACTION_SOURCES, toListItemDto, toLineDto, toSubscriptionDto, type TransitionAction,
} from './subscriptions.dto.js';
import type { BillingSubscription, SubscriptionsGateway } from './subscriptions.gateway.js';
import type {
  HeaderFields, LineWrite, SubscriptionLineRow, SubscriptionRow, SubscriptionTotals, SubscriptionsRepository,
  TransitionFields, VisibilityScope, ListScope, Labels, LabelRequest,
} from './subscriptions.repository.js';
import {
  expiryProblem,
  type CreateFromTemplateInput, type CreateSubscriptionInput,
  type ListSubscriptionsParams, type SubscriptionLineInput, type UpdateSubscriptionInput,
} from './subscriptions.schema.js';

const NOT_FOUND = 'Subscription not found';
const FORBIDDEN = 'Insufficient permissions';
const MAX_INT4 = 2147483647;
const DAY_MS = 86_400_000;
const FK_MESSAGE = 'The customer, plan, product, tax or payment term used by this subscription no longer exists';
const NUMBER_CLASH = 'A subscription with this number already exists. Please retry';
const EDITABLE_STATUSES: readonly SubscriptionStatus[] = [SubscriptionStatus.DRAFT, SubscriptionStatus.QUOTATION];

interface ValidationDetail { field: string; message: string }

/** A line as the client describes it. Prices and tax snapshots are looked up by the server. */
interface LineSpec {
  productId: number;
  variantId: number | null;
  taxId: number | null;
  description: string | null;
  quantity: number;
}

interface BuiltLines { writes: LineWrite[]; totals: SubscriptionTotals }

interface NewSubscriptionSpec {
  customerId: number;
  planId: number;
  templateId: number | null;
  startDate: Date;
  expiryDate: Date | null;
  paymentTermId: number | null | undefined;
  /** False when copying a term that already exists on another subscription (renewals). */
  validateTerm: boolean;
  notes: string | null;
  lines: LineSpec[];
}

interface Prepared { plan: PlanRecord; paymentTermId: number | null; built: BuiltLines }

export interface SubscriptionListResult { subscriptions: SubscriptionListItemDto[]; meta: ListMeta }
export interface CloseInput { reason?: string | undefined }
export interface RenewOptions {
  /** Portal renewals are approved by the customer's own request: the new subscription starts ACTIVE. Forced on for CUSTOMER actors. */
  autoActivate?: boolean;
  ip?: string | undefined;
}

const ACTION_LABELS: Record<TransitionAction, string> = {
  SEND_QUOTATION: 'send a quotation for', CONFIRM: 'confirm', ACTIVATE: 'activate', PAUSE: 'pause',
  RESUME: 'resume', CLOSE: 'close', RENEW: 'renew',
};

export class SubscriptionsService implements SubscriptionsGateway {
  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly audit: AuditGateway,
    private readonly sequences: SequenceGateway,
    private readonly customers: CustomersGateway,
    private readonly catalog: CatalogGateway,
    private readonly taxes: TaxesGateway,
    private readonly paymentTerms: PaymentTermsGateway,
    private readonly plans: PlansGateway,
    private readonly templates: TemplatesGateway,
    private readonly discounts: DiscountsGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------- reads

  async list(actor: Actor, query: ListSubscriptionsParams): Promise<SubscriptionListResult> {
    const scope = this.listScope(actor);
    const [rows, total] = await Promise.all([this.repository.list(query, scope), this.repository.count(query, scope)]);
    const wantLines = query.include?.includes('lines') === true;
    const lineRows = wantLines ? await this.repository.listLinesFor(rows.map((row) => row.id)) : [];
    const labels = await this.repository.lookupLabels({
      customerIds: rows.map((row) => row.customerId),
      planIds: rows.map((row) => row.planId),
      ...lineLabelIds(lineRows),
    });
    const linesBySubscription = new Map<number, SubscriptionLineDto[]>();
    for (const line of lineRows) {
      const bucket = linesBySubscription.get(line.subscriptionId) ?? [];
      bucket.push(toLineDto(line, labels));
      linesBySubscription.set(line.subscriptionId, bucket);
    }
    return {
      subscriptions: rows.map((row) => toListItemDto(
        row, labels, actor, wantLines ? linesBySubscription.get(row.id) ?? [] : undefined,
      )),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }

  async get(actor: Actor, id: number): Promise<SubscriptionDto> {
    return this.toDetail(actor, await this.requireVisible(actor, id));
  }

  // --------------------------------------------------------------- create

  async create(actor: Actor, input: CreateSubscriptionInput, ip?: string): Promise<SubscriptionDto> {
    this.assertStaff(actor);
    const row = await this.persistNew(actor, {
      customerId: input.customerId,
      planId: input.planId,
      templateId: null,
      startDate: input.startDate,
      expiryDate: input.expiryDate ?? null,
      paymentTermId: input.paymentTermId,
      validateTerm: true,
      notes: input.notes ?? null,
      lines: input.lines.map(toLineSpec),
    }, { status: SubscriptionStatus.DRAFT, renewedFromId: null, reason: null, action: 'subscription.create', ip });
    return this.toDetail(actor, row);
  }

  /** Plan and lines come from the template; no tax is applied (templates carry none). */
  async createFromTemplate(actor: Actor, input: CreateFromTemplateInput, ip?: string): Promise<SubscriptionDto> {
    this.assertStaff(actor);
    const template = await this.templates.getWithLines(input.templateId);
    if (template === null) throw notFound('Quotation template not found');
    if (!template.isActive) {
      throw validationError('Validation failed', [{ field: 'templateId', message: 'Template is not active' }]);
    }
    const row = await this.persistNew(actor, {
      customerId: input.customerId,
      planId: template.planId,
      templateId: template.id,
      startDate: input.startDate,
      expiryDate: input.expiryDate ?? null,
      paymentTermId: input.paymentTermId,
      validateTerm: true,
      notes: input.notes ?? template.notes,
      lines: template.lines.map((line) => ({
        productId: line.productId, variantId: line.variantId, taxId: null, description: null, quantity: line.quantity,
      })),
    }, {
      status: SubscriptionStatus.DRAFT, renewedFromId: null, reason: `Created from template ${template.name}`,
      action: 'subscription.create', ip, metadata: { templateId: template.id },
    });
    return this.toDetail(actor, row);
  }

  // --------------------------------------------------------------- update

  /**
   * DRAFT and QUOTATION: header and lines (replaced as a whole, totals recomputed in the same
   * transaction). From CONFIRMED on, only `notes` and `paymentTermId` may change.
   */
  async update(actor: Actor, id: number, patch: UpdateSubscriptionInput, ip?: string): Promise<SubscriptionDto> {
    this.assertStaff(actor);
    const existing = await this.requireVisible(actor, id);
    const structural = patch.planId !== undefined || patch.startDate !== undefined
      || patch.expiryDate !== undefined || patch.lines !== undefined;
    if (structural && !EDITABLE_STATUSES.includes(existing.status)) {
      throw invalidStateTransition('Only notes and paymentTermId can change once the subscription is confirmed');
    }

    let replacement: { lines: LineWrite[]; totals: SubscriptionTotals } | undefined;
    if (structural) {
      const planId = patch.planId ?? existing.planId;
      const startDate = patch.startDate ?? new Date(existing.startDate);
      const expiryDate = patch.expiryDate !== undefined
        ? patch.expiryDate
        : existing.expiryDate === null ? null : new Date(existing.expiryDate);
      const plan = await this.requirePlanForInput(planId);
      this.assertDates(plan, startDate, expiryDate);
      if (planId !== existing.planId || patch.startDate !== undefined) await this.plans.assertAvailable(planId, startDate);
      if (patch.lines !== undefined) {
        const built = await this.buildLines(patch.lines.map(toLineSpec), plan);
        replacement = { lines: built.writes, totals: built.totals };
      } else if (planId !== existing.planId) {
        assertMinQuantity(await this.repository.listLines(id), plan);
      }
    }
    if (patch.paymentTermId !== undefined && patch.paymentTermId !== null && patch.paymentTermId !== existing.paymentTermId) {
      await this.assertTermUsable(patch.paymentTermId);
    }

    const fields: HeaderFields = {
      ...(patch.planId !== undefined ? { planId: patch.planId } : {}),
      ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
      ...(patch.expiryDate !== undefined ? { expiryDate: patch.expiryDate } : {}),
      ...(patch.paymentTermId !== undefined ? { paymentTermId: patch.paymentTermId } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    let row: SubscriptionRow | null;
    try {
      row = await this.repository.update(id, existing.status, fields, replacement);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: FK_MESSAGE });
    }
    if (row === null) throw await this.changedUnderneath(id);

    await this.audit.record({
      actor, action: 'subscription.update', entityType: 'Subscription', entityId: id, ip,
      metadata: {
        changes: describeFields(fields),
        previous: describePrevious(existing, fields),
        ...(replacement === undefined ? {} : { linesReplaced: replacement.lines.length, total: replacement.totals.total }),
      },
    });
    return this.toDetail(actor, row);
  }

  /** Soft delete. ADMIN only, DRAFT only. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    if (!isAdmin(actor)) throw forbidden(FORBIDDEN);
    const existing = await this.requireVisible(actor, id);
    if (existing.status !== SubscriptionStatus.DRAFT) {
      throw invalidStateTransition('Only DRAFT subscriptions can be deleted');
    }
    const row = await this.repository.softDeleteDraft(id);
    if (row === null) throw await this.changedUnderneath(id);
    await this.audit.record({
      actor, action: 'subscription.delete', entityType: 'Subscription', entityId: id, ip,
      metadata: { number: existing.number, customerId: existing.customerId },
    });
  }

  // ---------------------------------------------------------- transitions

  async sendQuotation(actor: Actor, id: number, ip?: string): Promise<SubscriptionDto> {
    this.assertStaff(actor);
    const row = await this.requireVisible(actor, id);
    assertSource(row, 'SEND_QUOTATION');
    if ((await this.repository.countLines(id)) < 1) {
      throw validationError('Validation failed', [{ field: 'lines', message: 'Add at least one line before sending the quotation' }]);
    }
    let validUntil: Date | null = null;
    if (row.templateId !== null) {
      const template = await this.templates.getWithLines(row.templateId);
      if (template !== null) validUntil = addDays(businessToday(this.now()), template.validityDays);
    }
    const updated = await this.applyTransition(actor, row, SubscriptionStatus.QUOTATION, { quotationValidUntil: validUntil }, {
      reason: null, action: 'subscription.sendQuotation', ip,
      metadata: { quotationValidUntil: validUntil === null ? null : toIsoDate(validUntil) },
    });
    return this.toDetail(actor, updated);
  }

  async confirm(actor: Actor, id: number, ip?: string): Promise<SubscriptionDto> {
    this.assertStaff(actor);
    const row = await this.requireVisible(actor, id);
    assertSource(row, 'CONFIRM');
    const today = businessToday(this.now());
    if (row.quotationValidUntil !== null && toIsoDate(today) > toIsoDate(new Date(row.quotationValidUntil))) {
      throw quotationExpired();
    }
    const plan = await this.plans.assertAvailable(row.planId, new Date(row.startDate));
    assertMinQuantity(await this.repository.listLines(id), plan);
    const updated = await this.applyTransition(actor, row, SubscriptionStatus.CONFIRMED, { confirmedAt: this.now() }, {
      reason: null, action: 'subscription.confirm', ip,
    });
    return this.toDetail(actor, updated);
  }

  async activate(actor: Actor, id: number, ip?: string): Promise<SubscriptionDto> {
    this.assertStaff(actor);
    const row = await this.requireVisible(actor, id);
    assertSource(row, 'ACTIVATE');
    const now = this.now();
    const updated = await this.applyTransition(actor, row, SubscriptionStatus.ACTIVE, {
      activatedAt: now, nextBillingDate: startOfUtcDay(new Date(row.startDate)),
    }, { reason: null, action: 'subscription.activate', ip });
    return this.toDetail(actor, updated);
  }

  async pause(actor: Actor, id: number, ip?: string): Promise<SubscriptionDto> {
    const row = await this.requireVisible(actor, id);
    assertSource(row, 'PAUSE');
    const plan = await this.requirePlan(row.planId);
    if (!plan.pausable) throw actionNotAllowedByPlan('This plan does not allow pausing');
    const updated = await this.applyTransition(actor, row, SubscriptionStatus.PAUSED, { pausedAt: this.now() }, {
      reason: null, action: 'subscription.pause', ip,
    });
    return this.toDetail(actor, updated);
  }

  /** `nextBillingDate` becomes the first period boundary on or after today, so paused time is never back-billed. */
  async resume(actor: Actor, id: number, ip?: string): Promise<SubscriptionDto> {
    const row = await this.requireVisible(actor, id);
    assertSource(row, 'RESUME');
    const plan = await this.requirePlan(row.planId);
    let next = firstBoundaryOnOrAfter(new Date(row.startDate), plan.billingPeriod, businessToday(this.now()));
    if (row.lastBilledUntil !== null) {
      const billedUntil = new Date(row.lastBilledUntil);
      if (billedUntil.getTime() > next.getTime()) next = billedUntil;
    }
    const updated = await this.applyTransition(actor, row, SubscriptionStatus.ACTIVE, {
      nextBillingDate: next, pausedAt: null,
    }, { reason: null, action: 'subscription.resume', ip, metadata: { nextBillingDate: toIsoDate(next) } });
    return this.toDetail(actor, updated);
  }

  /** Before activation closing is always allowed; from ACTIVE or PAUSED the plan must be `closable`. */
  async close(actor: Actor, id: number, input: CloseInput, ip?: string): Promise<SubscriptionDto> {
    const row = await this.requireVisible(actor, id);
    assertSource(row, 'CLOSE');
    if (row.status === SubscriptionStatus.ACTIVE || row.status === SubscriptionStatus.PAUSED) {
      const plan = await this.requirePlan(row.planId);
      if (!plan.closable) throw actionNotAllowedByPlan('This plan does not allow closing early');
    }
    const reason = input.reason ?? null;
    const updated = await this.applyTransition(actor, row, SubscriptionStatus.CLOSED, {
      closedAt: this.now(), closeReason: reason, nextBillingDate: null,
    }, { reason, action: 'subscription.close', ip });
    return this.toDetail(actor, updated);
  }

  /**
   * New subscription from an ACTIVE or CLOSED one: same plan, customer, payment term and lines,
   * repriced at current prices and tax rates. Start is the old expiry (today when past or unset),
   * same duration. Staff get a DRAFT; with `autoActivate` (portal, forced for CUSTOMER actors) the
   * new subscription is created ACTIVE with one history row (null -> ACTIVE, reason 'Renewed').
   */
  async renew(actor: Actor, id: number, input: Record<string, never>, options: RenewOptions = {}): Promise<SubscriptionDto> {
    void input;
    const source = await this.requireVisible(actor, id);
    assertSource(source, 'RENEW');
    const plan = await this.requirePlan(source.planId);
    if (!plan.renewable) throw actionNotAllowedByPlan('This plan does not allow renewal');
    if (await this.repository.hasOpenRenewal(id)) {
      throw invalidStateTransition('This subscription has already been renewed');
    }

    const today = businessToday(this.now());
    const oldStart = new Date(source.startDate);
    const oldExpiry = source.expiryDate === null ? null : new Date(source.expiryDate);
    const startDate = oldExpiry !== null && oldExpiry.getTime() >= today.getTime() ? oldExpiry : today;
    const expiryDate = oldExpiry === null ? null : addDays(startDate, daysBetween(oldStart, oldExpiry));
    const lines = await this.repository.listLines(id);
    const autoActivate = isCustomer(actor) || options.autoActivate === true;

    const row = await this.persistNew(actor, {
      customerId: source.customerId,
      planId: source.planId,
      templateId: source.templateId,
      startDate,
      expiryDate,
      paymentTermId: source.paymentTermId,
      validateTerm: false,
      notes: null,
      lines: lines.map((line) => ({
        productId: line.productId, variantId: line.variantId, taxId: line.taxId,
        description: line.description, quantity: line.quantity,
      })),
    }, {
      status: autoActivate ? SubscriptionStatus.ACTIVE : SubscriptionStatus.DRAFT,
      renewedFromId: id,
      reason: autoActivate ? 'Renewed' : `Renewed from ${source.number}`,
      action: 'subscription.renew',
      ip: options.ip,
      metadata: { renewedFromId: id, renewedFromNumber: source.number, autoActivated: autoActivate },
    });
    return this.toDetail(actor, row);
  }

  // -------------------------------------------------------------- gateway

  async getForBilling(id: number): Promise<BillingSubscription | null> {
    const row = await this.repository.findById(id);
    if (row === null) return null;
    const [lines, labels] = await Promise.all([
      this.repository.listLines(id),
      this.repository.lookupLabels({ planIds: [row.planId] }),
    ]);
    const plan = labels.plans.get(row.planId);
    if (plan === undefined) return null;
    const taxIds = [...new Set(lines.flatMap((line) => (line.taxId === null ? [] : [line.taxId])))];
    const taxes = taxIds.length === 0 ? [] : await this.taxes.getByIds(taxIds);
    const taxById = new Map<number, TaxRecord>(taxes.map((tax) => [tax.id, tax]));
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      customerId: row.customerId,
      planId: row.planId,
      billingPeriod: plan.billingPeriod,
      paymentTermId: row.paymentTermId,
      startDate: new Date(row.startDate),
      expiryDate: row.expiryDate === null ? null : new Date(row.expiryDate),
      nextBillingDate: row.nextBillingDate === null ? null : new Date(row.nextBillingDate),
      lastBilledUntil: row.lastBilledUntil === null ? null : new Date(row.lastBilledUntil),
      lines: lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        variantId: line.variantId,
        taxId: line.taxId,
        taxType: line.taxId === null ? null : taxById.get(line.taxId)?.type ?? null,
        taxRate: line.taxRate,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        sortOrder: line.sortOrder,
      })),
    };
  }

  async listDueIds(asOf: Date, afterId: number, limit: number): Promise<number[]> {
    const ids: number[] = [];
    let cursor = afterId;
    while (ids.length < limit) {
      const batch = await this.repository.listDueRows(asOf, cursor, limit);
      for (const row of batch) {
        cursor = row.id;
        const withinExpiry = row.expiryDate === null || row.nextBillingDate === null
          || new Date(row.nextBillingDate).getTime() <= new Date(row.expiryDate).getTime();
        if (withinExpiry) ids.push(row.id);
        if (ids.length >= limit) break;
      }
      if (batch.length < limit) break;
    }
    return ids;
  }

  async closeBySystem(id: number, reason: string): Promise<boolean> {
    const row = await this.repository.findById(id);
    if (row === null || (row.status !== SubscriptionStatus.ACTIVE && row.status !== SubscriptionStatus.PAUSED)) return false;
    const updated = await this.repository.transition(
      id, row.status, SubscriptionStatus.CLOSED,
      { closedAt: this.now(), closeReason: reason, nextBillingDate: null },
      { fromStatus: row.status, toStatus: SubscriptionStatus.CLOSED, changedById: null, reason },
    );
    if (updated === null) return false;
    await this.audit.record({
      actor: null, action: 'subscription.close', entityType: 'Subscription', entityId: id,
      metadata: { system: true, from: row.status, to: SubscriptionStatus.CLOSED, reason },
    });
    return true;
  }

  async listAutoCloseIds(asOf: Date): Promise<number[]> {
    return this.repository.listAutoCloseIds(startOfUtcDay(asOf));
  }

  // -------------------------------------------------------------- helpers

  private assertStaff(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden(FORBIDDEN);
  }

  private listScope(actor: Actor): ListScope {
    const today = businessToday(this.now());
    return isCustomer(actor)
      ? { customerId: requireCustomerId(actor), hideDrafts: true, today }
      : { today };
  }

  private visibilityFor(actor: Actor): VisibilityScope {
    return isCustomer(actor) ? { customerId: requireCustomerId(actor), hideDrafts: true } : {};
  }

  /** A CUSTOMER sees only their own non-DRAFT subscriptions; anything else is a 404, never a 403. */
  private async requireVisible(actor: Actor, id: number): Promise<SubscriptionRow> {
    const row = await this.repository.findById(id, this.visibilityFor(actor));
    if (row === null) throw notFound(NOT_FOUND);
    return row;
  }

  private async requirePlan(planId: number): Promise<PlanRecord> {
    const plan = await this.plans.getById(planId);
    if (plan === null) throw planNotAvailable('The plan of this subscription no longer exists');
    return plan;
  }

  private async requirePlanForInput(planId: number): Promise<PlanRecord> {
    const plan = await this.plans.getById(planId);
    if (plan === null) throw validationError('Validation failed', [{ field: 'planId', message: 'Plan not found' }]);
    return plan;
  }

  /** The row existed a moment ago; tells a concurrent delete (404) from a concurrent state change (409). */
  private async changedUnderneath(id: number): Promise<AppError> {
    const current = await this.repository.findById(id);
    return current === null
      ? notFound(NOT_FOUND)
      : invalidStateTransition(`The subscription is now ${current.status}; it was changed by another request`);
  }

  private assertDates(plan: PlanRecord, startDate: Date, expiryDate: Date | null): void {
    const problem = expiryProblem(startDate, expiryDate);
    if (problem !== null) throw validationError('Validation failed', [{ field: 'expiryDate', message: problem }]);
    if (plan.autoClose && expiryDate === null) {
      throw validationError('Validation failed', [{ field: 'expiryDate', message: 'This plan closes automatically, so an expiry date is required' }]);
    }
  }

  private async assertTermUsable(termId: number): Promise<void> {
    const term = await this.paymentTerms.getById(termId);
    if (term === null) {
      throw validationError('Validation failed', [{ field: 'paymentTermId', message: 'Payment term not found' }]);
    }
    if (!term.isActive) {
      throw validationError('Validation failed', [{ field: 'paymentTermId', message: 'Payment term is not active' }]);
    }
  }

  private async resolveTerm(termId: number | null | undefined, validate: boolean): Promise<number | null> {
    if (termId === undefined) return (await this.paymentTerms.getDefault())?.id ?? null;
    if (termId !== null && validate) await this.assertTermUsable(termId);
    return termId;
  }

  /** Every check shared by create, create-from-template and renew, ending in the priced lines. */
  private async prepare(spec: NewSubscriptionSpec): Promise<Prepared> {
    if ((await this.customers.getById(spec.customerId)) === null) {
      throw validationError('Validation failed', [{ field: 'customerId', message: 'Customer not found' }]);
    }
    const plan = await this.requirePlanForInput(spec.planId);
    this.assertDates(plan, spec.startDate, spec.expiryDate);
    await this.plans.assertAvailable(spec.planId, spec.startDate);
    const paymentTermId = await this.resolveTerm(spec.paymentTermId, spec.validateTerm);
    const built = await this.buildLines(spec.lines, plan);
    return { plan, paymentTermId, built };
  }

  private async persistNew(
    actor: Actor,
    spec: NewSubscriptionSpec,
    options: {
      status: typeof SubscriptionStatus.DRAFT | typeof SubscriptionStatus.ACTIVE;
      renewedFromId: number | null;
      reason: string | null;
      action: string;
      ip: string | undefined;
      metadata?: Record<string, unknown>;
    },
  ): Promise<SubscriptionRow> {
    const prepared = await this.prepare(spec);
    const number = await this.sequences.next(SequenceKey.SUBSCRIPTION);
    const now = this.now();
    const active = options.status === SubscriptionStatus.ACTIVE;
    let row: SubscriptionRow;
    try {
      row = await this.repository.create({
        number,
        customerId: spec.customerId,
        planId: spec.planId,
        templateId: spec.templateId,
        paymentTermId: prepared.paymentTermId,
        status: options.status,
        startDate: spec.startDate,
        expiryDate: spec.expiryDate,
        quotationValidUntil: null,
        nextBillingDate: active ? spec.startDate : null,
        confirmedAt: active ? now : null,
        activatedAt: active ? now : null,
        renewedFromId: options.renewedFromId,
        notes: spec.notes,
        createdById: actor.userId,
        ...prepared.built.totals,
      }, prepared.built.writes, {
        fromStatus: null, toStatus: options.status, changedById: actor.userId, reason: options.reason,
      });
    } catch (error) {
      return rethrowDbError(error, { unique: NUMBER_CLASH, foreignKey: FK_MESSAGE });
    }
    await this.audit.record({
      actor, action: options.action, entityType: 'Subscription', entityId: row.id, ip: options.ip,
      metadata: {
        number, customerId: row.customerId, planId: row.planId, status: row.status,
        total: row.total, lineCount: prepared.built.writes.length, ...options.metadata,
      },
    });
    return row;
  }

  private async applyTransition(
    actor: Actor,
    row: SubscriptionRow,
    to: SubscriptionStatus,
    fields: TransitionFields,
    options: { reason: string | null; action: string; ip: string | undefined; metadata?: Record<string, unknown> },
  ): Promise<SubscriptionRow> {
    let updated: SubscriptionRow | null;
    try {
      updated = await this.repository.transition(row.id, row.status, to, fields, {
        fromStatus: row.status, toStatus: to, changedById: actor.userId, reason: options.reason,
      });
    } catch (error) {
      return rethrowDbError(error, {});
    }
    if (updated === null) throw await this.changedUnderneath(row.id);
    await this.audit.record({
      actor, action: options.action, entityType: 'Subscription', entityId: row.id, ip: options.ip,
      metadata: {
        from: row.status, to,
        ...(options.reason === null ? {} : { reason: options.reason }),
        ...options.metadata,
      },
    });
    return updated;
  }

  /**
   * Prices every line from the catalog and taxes from the tax list, checks the plan's minimum
   * quantity, and computes the totals. All problems are reported together.
   */
  private async buildLines(specs: readonly LineSpec[], plan: PlanRecord): Promise<BuiltLines> {
    const taxIds = [...new Set(specs.flatMap((spec) => (spec.taxId === null ? [] : [spec.taxId])))];
    const taxList = taxIds.length === 0 ? [] : await this.taxes.getByIds(taxIds);
    const taxById = new Map<number, TaxRecord>(taxList.map((tax) => [tax.id, tax]));

    const cache = new Map<string, Promise<PricedItem | ValidationDetail>>();
    const priced = await Promise.all(specs.map((spec) => {
      const key = `${spec.productId}:${spec.variantId ?? ''}`;
      const cached = cache.get(key);
      const pending = cached ?? this.priceItem(spec);
      cache.set(key, pending);
      return pending;
    }));

    const problems: ValidationDetail[] = [];
    const writes: LineWrite[] = [];
    specs.forEach((spec, index) => {
      const item = priced[index];
      if (item === undefined) return;
      if ('field' in item) {
        problems.push({ ...item, field: item.field.replace('lines.#', `lines.${index}`) });
        return;
      }
      if (spec.quantity < plan.minQuantity) {
        problems.push({ field: `lines.${index}.quantity`, message: `Quantity must be at least ${plan.minQuantity} for this plan` });
      }
      const tax = spec.taxId === null ? null : taxById.get(spec.taxId) ?? null;
      if (spec.taxId !== null && tax === null) {
        problems.push({ field: `lines.${index}.taxId`, message: 'Tax not found' });
        return;
      }
      if (tax !== null && !tax.isActive) {
        problems.push({ field: `lines.${index}.taxId`, message: 'Tax is not active' });
        return;
      }
      const amount = lineAmount(spec.quantity, item.unitPrice);
      const taxAmount = tax === null ? 0 : taxOnLine(tax.type, tax.rate, amount, spec.quantity);
      if (amount > MAX_INT4 || taxAmount > MAX_INT4) {
        problems.push({ field: `lines.${index}.quantity`, message: 'Line amount is too large' });
        return;
      }
      writes.push({
        productId: spec.productId,
        variantId: spec.variantId,
        taxId: spec.taxId,
        description: spec.description ?? item.name,
        quantity: spec.quantity,
        unitPrice: item.unitPrice,
        taxRate: tax === null ? 0 : tax.rate,
        taxAmount,
        amount,
        sortOrder: index,
      });
    });
    if (problems.length > 0) throw validationError('Validation failed', problems);

    const subtotal = sumPaise(writes.map((line) => line.amount));
    const taxTotal = sumPaise(writes.map((line) => line.taxAmount));
    const total = sumPaise([subtotal, taxTotal]);
    if (total > MAX_INT4) {
      throw validationError('Validation failed', [{ field: 'lines', message: 'The subscription total is too large' }]);
    }
    return { writes, totals: { subtotal, taxTotal, total, recurringAmount: total } };
  }

  /** A product and variant must exist, match, and be active. Catalog 404s become field errors. */
  private async priceItem(spec: LineSpec): Promise<PricedItem | ValidationDetail> {
    const field = `lines.#.${spec.variantId === null ? 'productId' : 'variantId'}`;
    try {
      const item = await this.catalog.getPricedItem(spec.productId, spec.variantId ?? undefined);
      return item.isActive ? item : { field, message: 'Product or variant is not active' };
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        return { field, message: 'Product not found, or the variant does not belong to the product' };
      }
      throw error;
    }
  }

  private async toDetail(actor: Actor, row: SubscriptionRow): Promise<SubscriptionDto> {
    const [lines, history, attached, invoices, paymentTerm] = await Promise.all([
      this.repository.listLines(row.id),
      this.repository.listHistory(row.id),
      this.discounts.listAttachedForSubscription(row.id),
      this.repository.listRecentInvoices(row.id, 5),
      row.paymentTermId === null ? Promise.resolve(null) : this.repository.findPaymentTerm(row.paymentTermId),
    ]);
    const labels: Labels = await this.repository.lookupLabels({
      customerIds: [row.customerId],
      planIds: [row.planId],
      userIds: history.flatMap((entry) => (entry.changedById === null ? [] : [entry.changedById])),
      ...lineLabelIds(lines),
    });
    return toSubscriptionDto(row, labels, actor, {
      lines, history, invoices, paymentTerm,
      discounts: attached.map((discount) => ({
        id: discount.id, name: discount.name, code: discount.code, type: discount.type,
        value: discount.value, scope: discount.scope,
      })),
    });
  }
}

function toLineSpec(line: SubscriptionLineInput): LineSpec {
  return {
    productId: line.productId,
    variantId: line.variantId ?? null,
    taxId: line.taxId ?? null,
    description: line.description ?? null,
    quantity: line.quantity,
  };
}

function lineLabelIds(lines: readonly SubscriptionLineRow[]): Pick<LabelRequest, 'productIds' | 'variantIds' | 'taxIds'> {
  return {
    productIds: lines.map((line) => line.productId),
    variantIds: lines.flatMap((line) => (line.variantId === null ? [] : [line.variantId])),
    taxIds: lines.flatMap((line) => (line.taxId === null ? [] : [line.taxId])),
  };
}

function assertSource(row: SubscriptionRow, action: TransitionAction): void {
  if (!ACTION_SOURCES[action].includes(row.status)) {
    throw invalidStateTransition(`Cannot ${ACTION_LABELS[action]} a ${row.status} subscription`);
  }
}

function assertMinQuantity(lines: readonly { quantity: number }[], plan: PlanRecord): void {
  const problems: ValidationDetail[] = [];
  lines.forEach((line, index) => {
    if (line.quantity < plan.minQuantity) {
      problems.push({ field: `lines.${index}.quantity`, message: `Quantity must be at least ${plan.minQuantity} for this plan` });
    }
  });
  if (problems.length > 0) throw validationError('Validation failed', problems);
}

/** Whole days between two UTC-midnight dates. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

function describeFields(fields: HeaderFields): Record<string, unknown> {
  return {
    ...fields,
    ...(fields.startDate === undefined ? {} : { startDate: toIsoDate(fields.startDate) }),
    ...(fields.expiryDate === undefined ? {} : { expiryDate: fields.expiryDate === null ? null : toIsoDate(fields.expiryDate) }),
  };
}

function describePrevious(existing: SubscriptionRow, fields: HeaderFields): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(fields) as (keyof HeaderFields)[]) previous[key] = existing[key];
  return previous;
}
