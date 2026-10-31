import { DiscountScope, DiscountState, type DiscountDto, type DiscountListItemDto, type DiscountUsageDto, type ListMeta } from '@brightloop/shared';
import { conflict, forbidden, notFound, validationError } from '../../core/errors.js';
import { isAdmin, isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { businessToday, toIsoDate } from '../../core/utils/dates.js';
import { discountNotApplicable, inUse, rethrowDbError } from '../../core/utils/domain-errors.js';
import { allocateProportionally, discountAmount, sumPaise } from '../../core/utils/money.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import { toDiscountDto, toDiscountListItemDto, toDiscountUsageDto } from './discounts.dto.js';
import type {
  DiscountApplication, DiscountEvaluationInput, DiscountSummary, DiscountsGateway,
} from './discounts.gateway.js';
import type { DiscountRow, DiscountsRepository } from './discounts.repository.js';
import {
  valueProblem, windowProblem,
  type CreateDiscountInput, type ListDiscountUsagesParams, type ListDiscountsParams, type UpdateDiscountInput,
} from './discounts.schema.js';

const DISCOUNT_NOT_FOUND = 'Discount not found';
const DUPLICATE_CODE = 'A discount with this code already exists';
const MISSING_PRODUCT = 'A referenced product no longer exists';
const SCOPE_IN_USE = 'The scope cannot change once the discount has been used on invoices';

/** Calendar day of an instant as `YYYY-MM-DD`, comparable as a string. */
const dayOf = (value: string | Date): string => toIsoDate(typeof value === 'string' ? new Date(value) : value);

/** Derived from dates and `usedCount`. Order of precedence: upcoming, expired, exhausted, active. */
export function discountState(row: DiscountRow, today: Date): DiscountState {
  const day = dayOf(today);
  if (day < dayOf(row.startDate)) return DiscountState.UPCOMING;
  if (row.endDate !== null && day > dayOf(row.endDate)) return DiscountState.EXPIRED;
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return DiscountState.EXHAUSTED;
  return DiscountState.ACTIVE;
}

/** Why the discount cannot be used on `day` (ignoring its start date), or null when it can. */
function applicabilityProblem(row: DiscountRow, day: Date): string | null {
  if (!row.isActive) return 'The discount is inactive';
  if (row.endDate !== null && dayOf(day) > dayOf(row.endDate)) return 'The discount has expired';
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return 'The discount has reached its usage limit';
  return null;
}

/** startDate <= asOf <= endDate by calendar day (both inclusive), active, and usedCount below the limit. */
function isEligibleOn(row: DiscountRow, asOf: Date): boolean {
  return dayOf(asOf) >= dayOf(row.startDate) && applicabilityProblem(row, asOf) === null;
}

function meetsMinimums(row: DiscountRow, quantity: number, base: number): boolean {
  return (row.minQuantity === null || quantity >= row.minQuantity)
    && (row.minPurchase === null || base >= row.minPurchase);
}

/**
 * Spreads `total` over the lines in proportion to what is left on each (last line absorbs the
 * remainder). A line never gets more than it has left: any overflow moves to earlier lines with room.
 */
function splitAcrossLines(total: number, remaining: readonly number[]): number[] {
  const shares = allocateProportionally(total, remaining);
  let overflow = 0;
  shares.forEach((share, index) => {
    const room = remaining[index] ?? 0;
    if (share > room) {
      overflow += share - room;
      shares[index] = room;
    }
  });
  for (let index = shares.length - 1; index >= 0 && overflow > 0; index -= 1) {
    const add = Math.min((remaining[index] ?? 0) - (shares[index] ?? 0), overflow);
    shares[index] = (shares[index] ?? 0) + add;
    overflow -= add;
  }
  return shares;
}

export class DiscountsService implements DiscountsGateway {
  constructor(
    private readonly repository: DiscountsRepository,
    private readonly audit: AuditGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(actor: Actor, query: ListDiscountsParams): Promise<{ discounts: DiscountListItemDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const today = this.today();
    const [rows, total] = await Promise.all([this.repository.list(query, today), this.repository.count(query, today)]);
    return {
      discounts: rows.map((row) => toDiscountListItemDto(row, discountState(row, today))),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }

  async get(actor: Actor, id: number): Promise<DiscountDto> {
    this.assertCanRead(actor);
    return this.buildDto(await this.requireDiscount(id));
  }

  async create(actor: Actor, input: CreateDiscountInput, ip?: string): Promise<DiscountDto> {
    this.assertAdmin(actor);
    const productIds = input.productIds ?? [];
    await this.assertProductsExist(productIds);
    let row: DiscountRow;
    try {
      row = await this.repository.create(input, actor.userId);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_CODE, foreignKey: MISSING_PRODUCT });
    }
    await this.audit.record({
      actor, action: 'discount.create', entityType: 'Discount', entityId: row.id, ip,
      metadata: {
        name: row.name, code: row.code, type: row.type, value: row.value, scope: row.scope,
        usageLimit: row.usageLimit, isActive: row.isActive, productIds,
      },
    });
    return toDiscountDto(row, discountState(row, this.today()), [...productIds].sort((a, b) => a - b), 0);
  }

  /** `usedCount` is not part of the patch type and is never written here. */
  async update(actor: Actor, id: number, patch: UpdateDiscountInput, ip?: string): Promise<DiscountDto> {
    this.assertAdmin(actor);
    const existing = await this.requireDiscount(id);

    const valueIssue = valueProblem(patch.type ?? existing.type, patch.value ?? existing.value);
    if (valueIssue !== null) throw validationError('Validation failed', [{ field: 'value', message: valueIssue }]);
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      const start = patch.startDate ?? new Date(existing.startDate);
      const end = patch.endDate !== undefined ? patch.endDate : existing.endDate === null ? null : new Date(existing.endDate);
      const windowIssue = windowProblem(start, end);
      if (windowIssue !== null) throw validationError('Validation failed', [{ field: 'endDate', message: windowIssue }]);
    }

    const scopeChanged = patch.scope !== undefined && patch.scope !== existing.scope;
    if (scopeChanged && (await this.repository.countUsagesOf(id)) > 0) throw inUse(SCOPE_IN_USE);

    let row: DiscountRow | null;
    try {
      row = await this.repository.update(id, patch, scopeChanged
        ? (existing.scope === DiscountScope.PRODUCT ? 'products' : 'subscriptions')
        : null);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_CODE });
    }
    if (row === null) throw notFound(DISCOUNT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'discount.update', entityType: 'Discount', entityId: id, ip,
      metadata: { changes: patch, previous: pickPrevious(existing, patch) },
    });
    return this.buildDto(row);
  }

  /** Soft delete: usage history and attached invoices keep pointing at the row. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    const row = await this.repository.softDelete(id);
    if (row === null) throw notFound(DISCOUNT_NOT_FOUND);
    await this.audit.record({
      actor, action: 'discount.delete', entityType: 'Discount', entityId: id, ip,
      metadata: { name: row.name, code: row.code, scope: row.scope },
    });
  }

  /** Replaces the whole product set. Only PRODUCT-scope discounts have one. */
  async setProducts(actor: Actor, id: number, productIds: number[], ip?: string): Promise<DiscountDto> {
    this.assertAdmin(actor);
    const existing = await this.requireDiscount(id);
    if (existing.scope !== DiscountScope.PRODUCT) {
      throw conflict('CONFLICT', 'Only PRODUCT-scope discounts have a product set');
    }
    await this.assertProductsExist(productIds);
    const previous = await this.repository.listProductIds(id);
    try {
      await this.repository.replaceProducts(id, productIds);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: MISSING_PRODUCT });
    }
    await this.audit.record({
      actor, action: 'discount.products.set', entityType: 'Discount', entityId: id, ip,
      metadata: { productIds, previous },
    });
    return this.buildDto(existing);
  }

  /** ADMIN and STAFF. Already attached subscriptions are kept as they are. */
  async attachSubscriptions(actor: Actor, id: number, subscriptionIds: number[], ip?: string): Promise<DiscountDto> {
    this.assertCanRead(actor);
    const existing = await this.requireDiscount(id);
    if (existing.scope !== DiscountScope.SUBSCRIPTION) {
      throw discountNotApplicable('Only SUBSCRIPTION-scope discounts can be attached to subscriptions');
    }
    const problem = applicabilityProblem(existing, this.today());
    if (problem !== null) throw discountNotApplicable(problem);

    const found = new Set(await this.repository.findExistingSubscriptionIds(subscriptionIds));
    const missing = subscriptionIds.filter((subscriptionId) => !found.has(subscriptionId));
    if (missing.length > 0) throw notFound(`Subscription not found: ${missing.join(', ')}`);

    let attached: number[];
    try {
      attached = await this.repository.attachSubscriptions(id, subscriptionIds);
    } catch (error) {
      return rethrowDbError(error, { unique: 'The discount is already attached to one of these subscriptions' });
    }
    await this.audit.record({
      actor, action: 'discount.attach', entityType: 'Discount', entityId: id, ip,
      metadata: { subscriptionIds, attached },
    });
    return this.buildDto(existing);
  }

  async detachSubscription(actor: Actor, id: number, subscriptionId: number, ip?: string): Promise<void> {
    this.assertCanRead(actor);
    await this.requireDiscount(id);
    if (!(await this.repository.detachSubscription(id, subscriptionId))) {
      throw notFound('The discount is not attached to this subscription');
    }
    await this.audit.record({
      actor, action: 'discount.detach', entityType: 'Discount', entityId: id, ip,
      metadata: { subscriptionId },
    });
  }

  async listUsages(
    actor: Actor,
    id: number,
    query: ListDiscountUsagesParams,
  ): Promise<{ usages: DiscountUsageDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const discount = await this.requireDiscount(id);
    const [rows, total] = await Promise.all([this.repository.listUsages(id, query), this.repository.countUsages(id, query)]);
    const [invoices, subscriptions] = await Promise.all([
      this.repository.findInvoiceNumbers([...new Set(rows.map((row) => row.invoiceId))]),
      this.repository.findSubscriptionNumbers([...new Set(rows.map((row) => row.subscriptionId))]),
    ]);
    return {
      usages: rows.map((row) => toDiscountUsageDto(
        row, discount.name, invoices.get(row.invoiceId) ?? '', subscriptions.get(row.subscriptionId) ?? '',
      )),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }

  /**
   * Pure read. Product discounts apply first, per matched line, in ascending discount id.
   * Subscription discounts then apply to the subtotal left after product discounts, in
   * ascending id, and are split across lines. Nothing is written, including `usedCount`.
   */
  async evaluate(input: DiscountEvaluationInput): Promise<DiscountApplication[]> {
    const { lines, asOf } = input;
    if (lines.length === 0) return [];
    const productIds = [...new Set(lines.flatMap((line) => (line.productId === null ? [] : [line.productId])))];
    const [productDiscounts, subscriptionDiscounts] = await Promise.all([
      this.repository.findProductDiscounts(productIds),
      input.subscriptionId === null ? Promise.resolve([]) : this.repository.findSubscriptionDiscounts(input.subscriptionId),
    ]);

    const remaining = lines.map((line) => Math.max(0, line.amount));
    const applications: DiscountApplication[] = [];

    for (const discount of [...productDiscounts].filter((row) => isEligibleOn(row, asOf)).sort(byId)) {
      const covered = new Set(discount.matchedProductIds);
      lines.forEach((line, index) => {
        if (line.productId === null || !covered.has(line.productId)) return;
        const base = remaining[index] ?? 0;
        if (!meetsMinimums(discount, line.quantity, base)) return;
        const amount = discountAmount(discount.type, discount.value, base);
        if (amount <= 0) return;
        remaining[index] = base - amount;
        applications.push({ discountId: discount.id, lineId: line.lineId, amount });
      });
    }

    const totalQuantity = sumPaise(lines.map((line) => line.quantity));
    for (const discount of [...subscriptionDiscounts].filter((row) => isEligibleOn(row, asOf)).sort(byId)) {
      const base = sumPaise(remaining);
      if (!meetsMinimums(discount, totalQuantity, base)) continue;
      const amount = discountAmount(discount.type, discount.value, base);
      if (amount <= 0) continue;
      const shares = splitAcrossLines(amount, remaining);
      lines.forEach((line, index) => {
        const share = shares[index] ?? 0;
        if (share <= 0) return;
        remaining[index] = (remaining[index] ?? 0) - share;
        applications.push({ discountId: discount.id, lineId: line.lineId, amount: share });
      });
    }
    return applications;
  }

  async listAttachedForSubscription(subscriptionId: number): Promise<DiscountSummary[]> {
    const rows = await this.repository.findSubscriptionDiscounts(subscriptionId);
    return rows.map(({ id, name, code, type, value, scope }) => ({ id, name, code, type, value, scope }));
  }

  private today(): Date {
    return businessToday(this.now());
  }

  private async buildDto(row: DiscountRow): Promise<DiscountDto> {
    const [productIds, attachedCount] = await Promise.all([
      row.scope === DiscountScope.PRODUCT ? this.repository.listProductIds(row.id) : Promise.resolve([]),
      row.scope === DiscountScope.SUBSCRIPTION ? this.repository.countAttachedSubscriptions(row.id) : Promise.resolve(0),
    ]);
    return toDiscountDto(row, discountState(row, this.today()), productIds, attachedCount);
  }

  private async assertProductsExist(productIds: readonly number[]): Promise<void> {
    if (productIds.length === 0) return;
    const found = new Set(await this.repository.findExistingProductIds(productIds));
    const missing = productIds.filter((productId) => !found.has(productId));
    if (missing.length > 0) {
      throw validationError('Validation failed', [{ field: 'productIds', message: `Unknown or deleted products: ${missing.join(', ')}` }]);
    }
  }

  private async requireDiscount(id: number): Promise<DiscountRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound(DISCOUNT_NOT_FOUND);
    return row;
  }

  private assertCanRead(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

const byId = (a: { id: number }, b: { id: number }): number => a.id - b.id;

function pickPrevious(existing: DiscountRow, patch: UpdateDiscountInput): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof UpdateDiscountInput)[]) previous[key] = existing[key];
  return previous;
}
