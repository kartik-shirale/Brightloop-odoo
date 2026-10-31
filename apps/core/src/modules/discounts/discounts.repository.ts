import type { DiscountScope, DiscountState, DiscountType } from '@brightloop/shared';
import { and } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { addDays } from '../../core/utils/dates.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type {
  CreateDiscountInput, ListDiscountUsagesParams, ListDiscountsParams, UpdateDiscountInput,
} from './discounts.schema.js';

export interface DiscountRow {
  id: number;
  name: string;
  code: string | null;
  type: DiscountType;
  value: number;
  scope: DiscountScope;
  minPurchase: number | null;
  minQuantity: number | null;
  startDate: string;
  endDate: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountUsageRow {
  id: number;
  discountId: number;
  invoiceId: number;
  subscriptionId: number;
  amount: number;
  createdAt: string;
}

/** A discount plus the subset of the given product ids it covers. */
export interface ProductDiscountRow extends DiscountRow {
  matchedProductIds: number[];
}

/** Which link table to empty when a discount changes scope. */
export type ScopeLinks = 'products' | 'subscriptions';

/** Drops `deletedAt` so it never travels past the repository. */
function toDiscountRow(row: DiscountRow): DiscountRow {
  return {
    id: row.id, name: row.name, code: row.code, type: row.type, value: row.value, scope: row.scope,
    minPurchase: row.minPurchase, minQuantity: row.minQuantity, startDate: row.startDate, endDate: row.endDate,
    usageLimit: row.usageLimit, usedCount: row.usedCount, isActive: row.isActive, createdById: row.createdById,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toUsageRow(row: DiscountUsageRow): DiscountUsageRow {
  return {
    id: row.id, discountId: row.discountId, invoiceId: row.invoiceId, subscriptionId: row.subscriptionId,
    amount: row.amount, createdAt: row.createdAt,
  };
}

export class DiscountsRepository {
  /** Read-only list scope. `state` is derived at query time from `today`, the dates and `usedCount`. */
  private listScope(query: ListDiscountsParams, today: Date, productDiscountIds: number[] | null) {
    const todayIso = today.toISOString();
    const tomorrowIso = addDays(today, 1).toISOString();
    return prisma.orm.public.Discount.where((discount, { fns }) => {
      const conditions: Parameters<typeof fns.and>[number][] = [discount.deletedAt.isNull()];
      if (query.search !== undefined) {
        conditions.push(fns.or(discount.name.ilike(`%${query.search}%`), discount.code.ilike(`%${query.search}%`)));
      }
      if (query.type !== undefined) conditions.push(fns.or(...query.type.map((type) => discount.type.eq(type))));
      if (query.scope !== undefined) conditions.push(fns.or(...query.scope.map((scope) => discount.scope.eq(scope))));
      if (query.isActive !== undefined) conditions.push(discount.isActive.eq(query.isActive));
      if (productDiscountIds !== null) conditions.push(discount.id.in(productDiscountIds));
      if (query.state !== undefined) {
        const started = discount.startDate.lt(tomorrowIso);
        const ended = fns.and(discount.endDate.isNotNull(), discount.endDate.lt(todayIso));
        const notEnded = fns.or(discount.endDate.isNull(), discount.endDate.gte(todayIso));
        const limitReached = fns.and(discount.usageLimit.isNotNull(), fns.gte(discount.usedCount, discount.usageLimit));
        const limitLeft = fns.or(discount.usageLimit.isNull(), fns.lt(discount.usedCount, discount.usageLimit));
        const byState: Record<DiscountState, Parameters<typeof fns.and>[number]> = {
          upcoming: discount.startDate.gte(tomorrowIso),
          expired: fns.and(started, ended),
          exhausted: fns.and(started, notEnded, limitReached),
          active: fns.and(started, notEnded, limitLeft),
        };
        conditions.push(fns.or(...query.state.map((state) => byState[state])));
      }
      return fns.and(...conditions);
    });
  }

  /** Ids of discounts that cover the product, for the `productId` filter. */
  private async discountIdsForProduct(productId: number): Promise<number[]> {
    const links = await prisma.orm.public.DiscountProduct.where((link) => link.productId.eq(productId)).all();
    return links.map((link) => link.discountId);
  }

  async list(query: ListDiscountsParams, today: Date): Promise<DiscountRow[]> {
    const productDiscountIds = query.productId === undefined ? null : await this.discountIdsForProduct(query.productId);
    const asc = query.sortOrder === 'asc';
    const rows = await this.listScope(query, today, productDiscountIds)
      .orderBy([
        (discount) => {
          const column = query.sortBy === 'name' ? discount.name
            : query.sortBy === 'startDate' ? discount.startDate
              : query.sortBy === 'endDate' ? discount.endDate
                : query.sortBy === 'usedCount' ? discount.usedCount
                  : discount.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (discount) => (asc ? discount.id.asc() : discount.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toDiscountRow);
  }

  async count(query: ListDiscountsParams, today: Date): Promise<number> {
    const productDiscountIds = query.productId === undefined ? null : await this.discountIdsForProduct(query.productId);
    const result = await this.listScope(query, today, productDiscountIds).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Excludes soft-deleted discounts. */
  async findById(id: number): Promise<DiscountRow | null> {
    const row = await prisma.orm.public.Discount
      .where((discount) => and(discount.id.eq(id), discount.deletedAt.isNull()))
      .first();
    return row === null ? null : toDiscountRow(row);
  }

  /** The discount and its product set commit together, or neither does. */
  async create(input: CreateDiscountInput, createdById: number): Promise<DiscountRow> {
    return prisma.transaction(async (tx) => {
      const row = await tx.orm.public.Discount.create({
        name: input.name,
        code: input.code ?? null,
        type: input.type,
        value: input.value,
        scope: input.scope,
        minPurchase: input.minPurchase ?? null,
        minQuantity: input.minQuantity ?? null,
        startDate: input.startDate.toISOString(),
        endDate: input.endDate?.toISOString() ?? null,
        usageLimit: input.usageLimit ?? null,
        isActive: input.isActive,
        createdById,
      });
      if (input.productIds !== undefined && input.productIds.length > 0) {
        await tx.orm.public.DiscountProduct.createAll(
          input.productIds.map((productId) => ({ discountId: row.id, productId })),
        );
      }
      return toDiscountRow(row);
    });
  }

  /**
   * Conditional on the discount not being soft-deleted. `clearLinks` empties the link table of the
   * scope being left, in the same transaction. `usedCount` is never written here.
   */
  async update(id: number, patch: UpdateDiscountInput, clearLinks: ScopeLinks | null): Promise<DiscountRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.Discount
        .where((discount) => and(discount.id.eq(id), discount.deletedAt.isNull()))
        .updateAll({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.code !== undefined ? { code: patch.code } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.value !== undefined ? { value: patch.value } : {}),
          ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
          ...(patch.minPurchase !== undefined ? { minPurchase: patch.minPurchase } : {}),
          ...(patch.minQuantity !== undefined ? { minQuantity: patch.minQuantity } : {}),
          ...(patch.startDate !== undefined ? { startDate: patch.startDate.toISOString() } : {}),
          ...(patch.endDate !== undefined ? { endDate: patch.endDate === null ? null : patch.endDate.toISOString() } : {}),
          ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        });
      const row = rows[0];
      if (row === undefined) return null;
      if (clearLinks === 'products') {
        await tx.orm.public.DiscountProduct.where((link) => link.discountId.eq(id)).deleteAll();
      } else if (clearLinks === 'subscriptions') {
        await tx.orm.public.SubscriptionDiscount.where((link) => link.discountId.eq(id)).deleteAll();
      }
      return toDiscountRow(row);
    });
  }

  /** Marks the discount deleted. Returns null when it does not exist or is already deleted. */
  async softDelete(id: number): Promise<DiscountRow | null> {
    const rows = await prisma.orm.public.Discount
      .where((discount) => and(discount.id.eq(id), discount.deletedAt.isNull()))
      .updateAll({ deletedAt: new Date().toISOString() });
    const row = rows[0];
    return row === undefined ? null : toDiscountRow(row);
  }

  async listProductIds(discountId: number): Promise<number[]> {
    const links = await prisma.orm.public.DiscountProduct
      .where((link) => link.discountId.eq(discountId))
      .orderBy([(link) => link.productId.asc()])
      .all();
    return links.map((link) => link.productId);
  }

  /** Replaces the product set in one transaction. */
  async replaceProducts(discountId: number, productIds: readonly number[]): Promise<void> {
    await prisma.transaction(async (tx) => {
      await tx.orm.public.DiscountProduct.where((link) => link.discountId.eq(discountId)).deleteAll();
      if (productIds.length > 0) {
        await tx.orm.public.DiscountProduct.createAll(productIds.map((productId) => ({ discountId, productId })));
      }
    });
  }

  /** Ids (from the input) of products that exist and are not deleted. Read-only. */
  async findExistingProductIds(ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.orm.public.Product
      .where((product) => and(product.id.in([...ids]), product.deletedAt.isNull()))
      .all();
    return rows.map((row) => row.id);
  }

  /** Ids (from the input) of subscriptions that exist and are not deleted. Read-only. */
  async findExistingSubscriptionIds(ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.orm.public.Subscription
      .where((subscription) => and(subscription.id.in([...ids]), subscription.deletedAt.isNull()))
      .all();
    return rows.map((row) => row.id);
  }

  async listAttachedSubscriptionIds(discountId: number): Promise<number[]> {
    const links = await prisma.orm.public.SubscriptionDiscount.where((link) => link.discountId.eq(discountId)).all();
    return links.map((link) => link.subscriptionId);
  }

  async countAttachedSubscriptions(discountId: number): Promise<number> {
    const result = await prisma.orm.public.SubscriptionDiscount
      .where((link) => link.discountId.eq(discountId))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Attaches the subscriptions that are not attached yet, atomically. Returns the newly attached ids. */
  async attachSubscriptions(discountId: number, subscriptionIds: readonly number[]): Promise<number[]> {
    return prisma.transaction(async (tx) => {
      const existing = await tx.orm.public.SubscriptionDiscount
        .where((link) => and(link.discountId.eq(discountId), link.subscriptionId.in([...subscriptionIds])))
        .all();
      const attached = new Set(existing.map((link) => link.subscriptionId));
      const missing = subscriptionIds.filter((id) => !attached.has(id));
      if (missing.length > 0) {
        await tx.orm.public.SubscriptionDiscount.createAll(
          missing.map((subscriptionId) => ({ discountId, subscriptionId })),
        );
      }
      return missing;
    });
  }

  /** Returns true when a link existed and was removed. */
  async detachSubscription(discountId: number, subscriptionId: number): Promise<boolean> {
    const removed = await prisma.orm.public.SubscriptionDiscount
      .where((link) => and(link.discountId.eq(discountId), link.subscriptionId.eq(subscriptionId)))
      .deleteAll();
    return removed.length > 0;
  }

  async countUsagesOf(discountId: number): Promise<number> {
    const result = await prisma.orm.public.DiscountUsage
      .where((usage) => usage.discountId.eq(discountId))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  private usageScope(discountId: number, query: ListDiscountUsagesParams) {
    return prisma.orm.public.DiscountUsage.where((usage) => {
      const conditions = [usage.discountId.eq(discountId)];
      if (query.invoiceId !== undefined) conditions.push(usage.invoiceId.eq(query.invoiceId));
      if (query.subscriptionId !== undefined) conditions.push(usage.subscriptionId.eq(query.subscriptionId));
      if (query.createdFrom !== undefined) conditions.push(usage.createdAt.gte(query.createdFrom.toISOString()));
      if (query.createdTo !== undefined) conditions.push(usage.createdAt.lte(query.createdTo.toISOString()));
      return and(...conditions);
    });
  }

  async listUsages(discountId: number, query: ListDiscountUsagesParams): Promise<DiscountUsageRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await this.usageScope(discountId, query)
      .orderBy([
        (usage) => {
          const column = query.sortBy === 'amount' ? usage.amount : usage.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (usage) => (asc ? usage.id.asc() : usage.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toUsageRow);
  }

  async countUsages(discountId: number, query: ListDiscountUsagesParams): Promise<number> {
    const result = await this.usageScope(discountId, query).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Invoice numbers keyed by id, one query for the whole page. Read-only. */
  async findInvoiceNumbers(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.orm.public.Invoice.where((invoice) => invoice.id.in([...ids])).all();
    return new Map(rows.map((row) => [row.id, row.number]));
  }

  /** Subscription numbers keyed by id, one query for the whole page. Read-only. */
  async findSubscriptionNumbers(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.orm.public.Subscription.where((subscription) => subscription.id.in([...ids])).all();
    return new Map(rows.map((row) => [row.id, row.number]));
  }

  /** Active, non-deleted PRODUCT discounts that cover at least one of the products. Date and usage checks stay in the service. */
  async findProductDiscounts(productIds: readonly number[]): Promise<ProductDiscountRow[]> {
    if (productIds.length === 0) return [];
    const links = await prisma.orm.public.DiscountProduct.where((link) => link.productId.in([...productIds])).all();
    if (links.length === 0) return [];
    const matched = new Map<number, number[]>();
    for (const link of links) matched.set(link.discountId, [...(matched.get(link.discountId) ?? []), link.productId]);
    const rows = await prisma.orm.public.Discount
      .where((discount) => and(
        discount.id.in([...matched.keys()]),
        discount.scope.eq('PRODUCT'),
        discount.isActive.eq(true),
        discount.deletedAt.isNull(),
      ))
      .orderBy([(discount) => discount.id.asc()])
      .all();
    return rows.map((row) => ({ ...toDiscountRow(row), matchedProductIds: matched.get(row.id) ?? [] }));
  }

  /** Non-deleted SUBSCRIPTION discounts attached to the subscription, active or not, ordered by id. */
  async findSubscriptionDiscounts(subscriptionId: number): Promise<DiscountRow[]> {
    const links = await prisma.orm.public.SubscriptionDiscount
      .where((link) => link.subscriptionId.eq(subscriptionId))
      .all();
    if (links.length === 0) return [];
    const rows = await prisma.orm.public.Discount
      .where((discount) => and(
        discount.id.in(links.map((link) => link.discountId)),
        discount.scope.eq('SUBSCRIPTION'),
        discount.deletedAt.isNull(),
      ))
      .orderBy([(discount) => discount.id.asc()])
      .all();
    return rows.map(toDiscountRow);
  }
}
