import { SubscriptionStatus, type BillingPeriod, type InvoiceStatus } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { addDays } from '../../core/utils/dates.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { ListSubscriptionsParams } from './subscriptions.schema.js';

export interface SubscriptionRow {
  id: number;
  number: string;
  customerId: number;
  planId: number;
  templateId: number | null;
  paymentTermId: number | null;
  status: SubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
  quotationValidUntil: string | null;
  nextBillingDate: string | null;
  lastBilledUntil: string | null;
  confirmedAt: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  renewedFromId: number | null;
  subtotal: number;
  taxTotal: number;
  total: number;
  recurringAmount: number;
  notes: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionLineRow {
  id: number;
  subscriptionId: number;
  productId: number;
  variantId: number | null;
  taxId: number | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  sortOrder: number;
}

export interface StatusHistoryRow {
  id: number;
  subscriptionId: number;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  changedById: number | null;
  reason: string | null;
  createdAt: string;
}

/** A priced line ready to store. `sortOrder` is the array index. */
export interface LineWrite {
  productId: number;
  variantId: number | null;
  taxId: number | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  sortOrder: number;
}

export interface SubscriptionTotals {
  subtotal: number;
  taxTotal: number;
  total: number;
  recurringAmount: number;
}

export interface HistoryWrite {
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  changedById: number | null;
  reason: string | null;
}

export interface NewSubscriptionWrite extends SubscriptionTotals {
  number: string;
  customerId: number;
  planId: number;
  templateId: number | null;
  paymentTermId: number | null;
  status: SubscriptionStatus;
  startDate: Date;
  expiryDate: Date | null;
  quotationValidUntil: Date | null;
  nextBillingDate: Date | null;
  confirmedAt: Date | null;
  activatedAt: Date | null;
  renewedFromId: number | null;
  notes: string | null;
  createdById: number | null;
}

/** Columns a workflow transition may set besides `status`. Undefined leaves a column untouched. */
export interface TransitionFields {
  quotationValidUntil?: Date | null;
  confirmedAt?: Date | null;
  activatedAt?: Date | null;
  pausedAt?: Date | null;
  closedAt?: Date | null;
  closeReason?: string | null;
  nextBillingDate?: Date | null;
}

export interface HeaderFields {
  planId?: number;
  startDate?: Date;
  expiryDate?: Date | null;
  paymentTermId?: number | null;
  notes?: string | null;
}

export interface LineReplacement {
  lines: readonly LineWrite[];
  totals: SubscriptionTotals;
}

/** Customer scoping applied inside the query itself (backend plan section 2, layer 3). */
export interface VisibilityScope {
  customerId?: number;
  hideDrafts?: boolean;
}

export interface ListScope extends VisibilityScope {
  /** Business "today" (UTC midnight), for `dueForBilling` and `expiringWithinDays`. */
  today: Date;
}

export interface CustomerLabel { id: number; name: string; companyName: string | null; email: string }

export interface PlanLabel {
  id: number;
  name: string;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  autoClose: boolean;
  pausable: boolean;
  closable: boolean;
  renewable: boolean;
}

export interface PaymentTermLabel {
  id: number;
  name: string;
  dueDays: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceSummaryRow {
  id: number;
  number: string;
  status: InvoiceStatus;
  total: number;
  issueDate: string;
  dueDate: string;
}

export interface LabelRequest {
  customerIds?: readonly number[];
  planIds?: readonly number[];
  productIds?: readonly number[];
  variantIds?: readonly number[];
  taxIds?: readonly number[];
  userIds?: readonly number[];
}

export interface Labels {
  customers: Map<number, CustomerLabel>;
  plans: Map<number, PlanLabel>;
  products: Map<number, string>;
  /** `Attribute: value` */
  variants: Map<number, string>;
  taxes: Map<number, string>;
  users: Map<number, string>;
}

export interface DueRow { id: number; nextBillingDate: string | null; expiryDate: string | null }

type SubscriptionAccessor = ModelAccessor<Contract, 'Subscription', 'public'>;

const iso = (date: Date | null | undefined): string | null => (date === undefined || date === null ? null : date.toISOString());
const ids = (values: readonly number[] | undefined): number[] => [...new Set(values ?? [])];

function buildWhere(query: ListSubscriptionsParams, scope: ListScope) {
  return (sub: SubscriptionAccessor) => {
    const conditions = [sub.deletedAt.isNull()];
    const customerId = scope.customerId ?? query.customerId;
    if (customerId !== undefined) conditions.push(sub.customerId.eq(customerId));
    if (scope.hideDrafts === true) conditions.push(sub.status.neq(SubscriptionStatus.DRAFT));
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(or(
        sub.number.ilike(pattern),
        sub.customer.some((customer) => or(
          customer.name.ilike(pattern), customer.companyName.ilike(pattern), customer.email.ilike(pattern),
        )),
      ));
    }
    if (query.status !== undefined) conditions.push(sub.status.in(query.status));
    if (query.planId !== undefined) conditions.push(sub.planId.eq(query.planId));
    if (query.templateId !== undefined) conditions.push(sub.templateId.eq(query.templateId));
    if (query.startFrom !== undefined) conditions.push(sub.startDate.gte(query.startFrom.toISOString()));
    if (query.startTo !== undefined) conditions.push(sub.startDate.lte(query.startTo.toISOString()));
    if (query.expiryFrom !== undefined) conditions.push(sub.expiryDate.gte(query.expiryFrom.toISOString()));
    if (query.expiryTo !== undefined) conditions.push(sub.expiryDate.lte(query.expiryTo.toISOString()));
    if (query.nextBillingFrom !== undefined) conditions.push(sub.nextBillingDate.gte(query.nextBillingFrom.toISOString()));
    if (query.nextBillingTo !== undefined) conditions.push(sub.nextBillingDate.lte(query.nextBillingTo.toISOString()));
    if (query.createdFrom !== undefined) conditions.push(sub.createdAt.gte(query.createdFrom.toISOString()));
    if (query.createdTo !== undefined) conditions.push(sub.createdAt.lte(query.createdTo.toISOString()));
    if (query.dueForBilling !== undefined) {
      const today = scope.today.toISOString();
      conditions.push(query.dueForBilling
        ? and(sub.status.eq(SubscriptionStatus.ACTIVE), sub.nextBillingDate.lte(today))
        : or(sub.status.neq(SubscriptionStatus.ACTIVE), sub.nextBillingDate.isNull(), sub.nextBillingDate.gt(today)));
    }
    if (query.expiringWithinDays !== undefined) {
      conditions.push(
        sub.status.eq(SubscriptionStatus.ACTIVE),
        sub.expiryDate.gte(scope.today.toISOString()),
        sub.expiryDate.lte(addDays(scope.today, query.expiringWithinDays).toISOString()),
      );
    }
    return and(...conditions);
  };
}

export class SubscriptionsRepository {
  async list(query: ListSubscriptionsParams, scope: ListScope): Promise<SubscriptionRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.Subscription
      .where(buildWhere(query, scope))
      .orderBy([
        (sub) => {
          const column = query.sortBy === 'number' ? sub.number
            : query.sortBy === 'startDate' ? sub.startDate
              : query.sortBy === 'expiryDate' ? sub.expiryDate
                : query.sortBy === 'nextBillingDate' ? sub.nextBillingDate
                  : query.sortBy === 'total' ? sub.total
                    : query.sortBy === 'status' ? sub.status
                      : sub.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (sub) => (asc ? sub.id.asc() : sub.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toSubscriptionRow);
  }

  async count(query: ListSubscriptionsParams, scope: ListScope): Promise<number> {
    const result = await prisma.orm.public.Subscription.where(buildWhere(query, scope)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Excludes soft-deleted rows; a customer scope is part of the query itself. */
  async findById(id: number, scope: VisibilityScope = {}): Promise<SubscriptionRow | null> {
    const row = await prisma.orm.public.Subscription
      .where((sub) => {
        const conditions = [sub.id.eq(id), sub.deletedAt.isNull()];
        if (scope.customerId !== undefined) conditions.push(sub.customerId.eq(scope.customerId));
        if (scope.hideDrafts === true) conditions.push(sub.status.neq(SubscriptionStatus.DRAFT));
        return and(...conditions);
      })
      .first();
    return row === null ? null : toSubscriptionRow(row);
  }

  /** Ordered by sortOrder, then id. */
  async listLines(subscriptionId: number): Promise<SubscriptionLineRow[]> {
    const rows = await prisma.orm.public.SubscriptionLine
      .where((line) => line.subscriptionId.eq(subscriptionId))
      .orderBy([(line) => line.sortOrder.asc(), (line) => line.id.asc()])
      .all();
    return rows.map(toLineRow);
  }

  /** One query for a page of subscriptions. */
  async listLinesFor(subscriptionIds: readonly number[]): Promise<SubscriptionLineRow[]> {
    if (subscriptionIds.length === 0) return [];
    const rows = await prisma.orm.public.SubscriptionLine
      .where((line) => line.subscriptionId.in([...subscriptionIds]))
      .orderBy([(line) => line.subscriptionId.asc(), (line) => line.sortOrder.asc(), (line) => line.id.asc()])
      .all();
    return rows.map(toLineRow);
  }

  async listHistory(subscriptionId: number): Promise<StatusHistoryRow[]> {
    const rows = await prisma.orm.public.SubscriptionStatusHistory
      .where((entry) => entry.subscriptionId.eq(subscriptionId))
      .orderBy([(entry) => entry.createdAt.asc(), (entry) => entry.id.asc()])
      .all();
    return rows.map(toHistoryRow);
  }

  /** Read-only: the five newest invoices of the subscription. */
  async listRecentInvoices(subscriptionId: number, limit: number): Promise<InvoiceSummaryRow[]> {
    const rows = await prisma.orm.public.Invoice
      .where((invoice) => invoice.subscriptionId.eq(subscriptionId))
      .orderBy([(invoice) => invoice.issueDate.desc(), (invoice) => invoice.id.desc()])
      .limit(limit)
      .all();
    return rows.map((row) => ({
      id: row.id, number: row.number, status: row.status, total: row.total, issueDate: row.issueDate, dueDate: row.dueDate,
    }));
  }

  /** True when a live, non-closed subscription already renews this one. */
  async hasOpenRenewal(subscriptionId: number): Promise<boolean> {
    const result = await prisma.orm.public.Subscription
      .where((sub) => and(sub.renewedFromId.eq(subscriptionId), sub.deletedAt.isNull(), sub.status.neq(SubscriptionStatus.CLOSED)))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total > 0;
  }

  async countLines(subscriptionId: number): Promise<number> {
    const result = await prisma.orm.public.SubscriptionLine
      .where((line) => line.subscriptionId.eq(subscriptionId))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Read-only. Display names for a page or a detail view; deleted customers and products still resolve. */
  async lookupLabels(request: LabelRequest): Promise<Labels> {
    const customerIds = ids(request.customerIds);
    const planIds = ids(request.planIds);
    const productIds = ids(request.productIds);
    const variantIds = ids(request.variantIds);
    const taxIds = ids(request.taxIds);
    const userIds = ids(request.userIds);
    const [customers, plans, products, variants, taxes, users] = await Promise.all([
      customerIds.length === 0 ? [] : prisma.orm.public.Customer.where((customer) => customer.id.in(customerIds)).all(),
      planIds.length === 0 ? [] : prisma.orm.public.Plan.where((plan) => plan.id.in(planIds)).all(),
      productIds.length === 0 ? [] : prisma.orm.public.Product.where((product) => product.id.in(productIds)).all(),
      variantIds.length === 0 ? [] : prisma.orm.public.ProductVariant.where((variant) => variant.id.in(variantIds)).all(),
      taxIds.length === 0 ? [] : prisma.orm.public.Tax.where((tax) => tax.id.in(taxIds)).all(),
      userIds.length === 0 ? [] : prisma.orm.public.User.where((user) => user.id.in(userIds)).all(),
    ]);
    return {
      customers: new Map(customers.map((row) => [row.id, {
        id: row.id, name: row.name, companyName: row.companyName, email: row.email,
      }])),
      plans: new Map(plans.map((row) => [row.id, {
        id: row.id, name: row.name, billingPeriod: row.billingPeriod, minQuantity: row.minQuantity,
        autoClose: row.autoClose, pausable: row.pausable, closable: row.closable, renewable: row.renewable,
      }])),
      products: new Map(products.map((row) => [row.id, row.name])),
      variants: new Map(variants.map((row) => [row.id, `${row.attribute}: ${row.value}`])),
      taxes: new Map(taxes.map((row) => [row.id, row.name])),
      users: new Map(users.map((row) => [row.id, row.name])),
    };
  }

  /** Read-only: the full term row, for the detail DTO. */
  async findPaymentTerm(id: number): Promise<PaymentTermLabel | null> {
    const row = await prisma.orm.public.PaymentTerm.where((term) => term.id.eq(id)).first();
    return row === null ? null : {
      id: row.id, name: row.name, dueDays: row.dueDays, isDefault: row.isDefault, isActive: row.isActive,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  /** The subscription, its lines and its first history row commit together, or none of them do. */
  async create(
    data: NewSubscriptionWrite,
    lines: readonly LineWrite[],
    history: HistoryWrite,
  ): Promise<SubscriptionRow> {
    return prisma.transaction(async (tx) => {
      const row = await tx.orm.public.Subscription.create({
        number: data.number,
        customerId: data.customerId,
        planId: data.planId,
        templateId: data.templateId,
        paymentTermId: data.paymentTermId,
        status: data.status,
        startDate: data.startDate.toISOString(),
        expiryDate: iso(data.expiryDate),
        quotationValidUntil: iso(data.quotationValidUntil),
        nextBillingDate: iso(data.nextBillingDate),
        confirmedAt: iso(data.confirmedAt),
        activatedAt: iso(data.activatedAt),
        renewedFromId: data.renewedFromId,
        subtotal: data.subtotal,
        taxTotal: data.taxTotal,
        total: data.total,
        recurringAmount: data.recurringAmount,
        notes: data.notes,
        createdById: data.createdById,
      });
      if (lines.length > 0) {
        await tx.orm.public.SubscriptionLine.createAll(lines.map((line) => ({ subscriptionId: row.id, ...line })));
      }
      await tx.orm.public.SubscriptionStatusHistory.create({ subscriptionId: row.id, ...history });
      return toSubscriptionRow(row);
    });
  }

  /**
   * Conditional status change (`WHERE status = expected`) plus its history row, atomically.
   * Returns null when no row matched (another request moved it first, or it was deleted);
   * nothing is written in that case.
   */
  async transition(
    id: number,
    expected: SubscriptionStatus,
    toStatus: SubscriptionStatus,
    fields: TransitionFields,
    history: HistoryWrite,
  ): Promise<SubscriptionRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.Subscription
        .where((sub) => and(sub.id.eq(id), sub.status.eq(expected), sub.deletedAt.isNull()))
        .updateAll({
          status: toStatus,
          ...(fields.quotationValidUntil !== undefined ? { quotationValidUntil: iso(fields.quotationValidUntil) } : {}),
          ...(fields.confirmedAt !== undefined ? { confirmedAt: iso(fields.confirmedAt) } : {}),
          ...(fields.activatedAt !== undefined ? { activatedAt: iso(fields.activatedAt) } : {}),
          ...(fields.pausedAt !== undefined ? { pausedAt: iso(fields.pausedAt) } : {}),
          ...(fields.closedAt !== undefined ? { closedAt: iso(fields.closedAt) } : {}),
          ...(fields.closeReason !== undefined ? { closeReason: fields.closeReason } : {}),
          ...(fields.nextBillingDate !== undefined ? { nextBillingDate: iso(fields.nextBillingDate) } : {}),
          updatedAt: new Date().toISOString(),
        });
      const row = rows[0];
      if (row === undefined) return null;
      await tx.orm.public.SubscriptionStatusHistory.create({ subscriptionId: id, ...history });
      return toSubscriptionRow(row);
    });
  }

  /**
   * Header update, optionally replacing every line and the cached totals, in one transaction.
   * Conditional on the status the caller validated against; returns null when it no longer matches.
   */
  async update(
    id: number,
    expected: SubscriptionStatus,
    fields: HeaderFields,
    replacement?: LineReplacement,
  ): Promise<SubscriptionRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.Subscription
        .where((sub) => and(sub.id.eq(id), sub.status.eq(expected), sub.deletedAt.isNull()))
        .updateAll({
          ...(fields.planId !== undefined ? { planId: fields.planId } : {}),
          ...(fields.startDate !== undefined ? { startDate: fields.startDate.toISOString() } : {}),
          ...(fields.expiryDate !== undefined ? { expiryDate: iso(fields.expiryDate) } : {}),
          ...(fields.paymentTermId !== undefined ? { paymentTermId: fields.paymentTermId } : {}),
          ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
          ...(replacement === undefined ? {} : {
            subtotal: replacement.totals.subtotal,
            taxTotal: replacement.totals.taxTotal,
            total: replacement.totals.total,
            recurringAmount: replacement.totals.recurringAmount,
          }),
          updatedAt: new Date().toISOString(),
        });
      const row = rows[0];
      if (row === undefined) return null;
      if (replacement !== undefined) {
        await tx.orm.public.SubscriptionLine.where((line) => line.subscriptionId.eq(id)).deleteAll();
        if (replacement.lines.length > 0) {
          await tx.orm.public.SubscriptionLine.createAll(replacement.lines.map((line) => ({ subscriptionId: id, ...line })));
        }
      }
      return toSubscriptionRow(row);
    });
  }

  /** Soft delete of a DRAFT. Returns null when the row is missing, deleted, or no longer DRAFT. */
  async softDeleteDraft(id: number): Promise<SubscriptionRow | null> {
    const rows = await prisma.orm.public.Subscription
      .where((sub) => and(sub.id.eq(id), sub.status.eq(SubscriptionStatus.DRAFT), sub.deletedAt.isNull()))
      .updateAll({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const row = rows[0];
    return row === undefined ? null : toSubscriptionRow(row);
  }

  /** Keyset page of ACTIVE rows due on or before `asOf`, ascending id. The expiry cut-off is applied by the caller. */
  async listDueRows(asOf: Date, afterId: number, limit: number): Promise<DueRow[]> {
    const rows = await prisma.orm.public.Subscription
      .where((sub) => and(
        sub.deletedAt.isNull(),
        sub.status.eq(SubscriptionStatus.ACTIVE),
        sub.nextBillingDate.lte(asOf.toISOString()),
        sub.id.gt(afterId),
      ))
      .orderBy([(sub) => sub.id.asc()])
      .limit(limit)
      .all();
    return rows.map((row) => ({ id: row.id, nextBillingDate: row.nextBillingDate, expiryDate: row.expiryDate }));
  }

  /** ACTIVE rows whose expiry day is before `before` (UTC midnight) and whose plan has `autoClose`. */
  async listAutoCloseIds(before: Date): Promise<number[]> {
    const rows = await prisma.orm.public.Subscription
      .where((sub) => and(
        sub.deletedAt.isNull(),
        sub.status.eq(SubscriptionStatus.ACTIVE),
        sub.expiryDate.lt(before.toISOString()),
        sub.plan.some((plan) => plan.autoClose.eq(true)),
      ))
      .orderBy([(sub) => sub.id.asc()])
      .all();
    return rows.map((row) => row.id);
  }
}

/** Drops `deletedAt` so it never travels past the repository. */
function toSubscriptionRow(row: SubscriptionRow): SubscriptionRow {
  return {
    id: row.id, number: row.number, customerId: row.customerId, planId: row.planId, templateId: row.templateId,
    paymentTermId: row.paymentTermId, status: row.status, startDate: row.startDate, expiryDate: row.expiryDate,
    quotationValidUntil: row.quotationValidUntil, nextBillingDate: row.nextBillingDate,
    lastBilledUntil: row.lastBilledUntil, confirmedAt: row.confirmedAt, activatedAt: row.activatedAt,
    pausedAt: row.pausedAt, closedAt: row.closedAt, closeReason: row.closeReason, renewedFromId: row.renewedFromId,
    subtotal: row.subtotal, taxTotal: row.taxTotal, total: row.total, recurringAmount: row.recurringAmount,
    notes: row.notes, createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toLineRow(row: SubscriptionLineRow): SubscriptionLineRow {
  return {
    id: row.id, subscriptionId: row.subscriptionId, productId: row.productId, variantId: row.variantId,
    taxId: row.taxId, description: row.description, quantity: row.quantity, unitPrice: row.unitPrice,
    taxRate: row.taxRate, taxAmount: row.taxAmount, amount: row.amount, sortOrder: row.sortOrder,
  };
}

function toHistoryRow(row: StatusHistoryRow): StatusHistoryRow {
  return {
    id: row.id, subscriptionId: row.subscriptionId, fromStatus: row.fromStatus, toStatus: row.toStatus,
    changedById: row.changedById, reason: row.reason, createdAt: row.createdAt,
  };
}
