import { InvoiceStatus, SequenceKey, type PaymentMethod, type TaxType } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import { allocateSequenceValue, formatSequenceNumber, type SequenceExecutor } from '../../core/utils/sequence-sql.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { ListInvoicesParams } from './invoices.schema.js';

export interface InvoiceRow {
  id: number;
  number: string;
  subscriptionId: number;
  customerId: number;
  paymentTermId: number | null;
  status: InvoiceStatus;
  currency: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  customerName: string;
  customerEmail: string;
  customerTaxId: string | null;
  billingAddress: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  confirmedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  billingRunId: number | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineRow {
  id: number;
  invoiceId: number;
  productId: number | null;
  variantId: number | null;
  taxId: number | null;
  discountId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  sortOrder: number;
}

export interface PaymentRow {
  id: number;
  invoiceId: number;
  customerId: number;
  method: PaymentMethod;
  amount: number;
  paymentDate: string;
  reference: string | null;
  note: string | null;
  recordedById: number | null;
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

/** A line ready to store. `sortOrder` is the array index. */
export interface InvoiceLineWrite {
  productId: number | null;
  variantId: number | null;
  taxId: number | null;
  discountId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  sortOrder: number;
}

export interface DiscountUsageWrite {
  discountId: number;
  amount: number;
}

/** Everything one generated invoice needs. The number is allocated inside the transaction. */
export interface GenerateWrite {
  subscriptionId: number;
  customerId: number;
  paymentTermId: number | null;
  /** Business year for the invoice number. */
  year: number;
  status: InvoiceStatus;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issueDate: Date;
  dueDate: Date;
  customerName: string;
  customerEmail: string;
  customerTaxId: string | null;
  billingAddress: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountDue: number;
  confirmedAt: Date | null;
  paidAt: Date | null;
  billingRunId: number | null;
  createdById: number | null;
  /** The `nextBillingDate` the caller read. The advance is conditional on it still being current. */
  expectedNextBillingDate: Date;
  lines: readonly InvoiceLineWrite[];
  usages: readonly DiscountUsageWrite[];
}

export type GenerateResult =
  | { kind: 'CREATED'; invoice: InvoiceRow }
  /** Another request advanced `nextBillingDate` first; nothing was written. */
  | { kind: 'STALE' }
  /** A discount's usage limit was reached by someone else; everything was rolled back. */
  | { kind: 'DISCOUNT_LIMIT'; discountId: number };

export interface ConfirmWrite {
  total: number;
  now: Date;
  /** A zero-total invoice has nothing to collect and goes straight to PAID. */
  settled: boolean;
}

export interface InvoiceHeaderFields {
  notes?: string | null;
  dueDate?: Date;
}

/** Customer scoping applied inside the query itself (backend plan section 2, layer 3). */
export interface InvoiceScope {
  customerId?: number;
  statuses?: readonly InvoiceStatus[];
}

export interface ListScope extends InvoiceScope {
  /** Business "today" (UTC midnight), for the `overdue` filter. */
  today: Date;
}

export interface NameRequest {
  subscriptionIds?: readonly number[];
  productIds?: readonly number[];
  variantIds?: readonly number[];
  taxIds?: readonly number[];
  discountIds?: readonly number[];
  paymentTermIds?: readonly number[];
  userIds?: readonly number[];
}

export interface Names {
  subscriptions: Map<number, string>;
  products: Map<number, string>;
  /** `Attribute: value` */
  variants: Map<number, string>;
  taxes: Map<number, { name: string; type: TaxType }>;
  discounts: Map<number, string>;
  paymentTerms: Map<number, string>;
  users: Map<number, string>;
}

type InvoiceAccessor = ModelAccessor<Contract, 'Invoice', 'public'>;

const iso = (date: Date | null | undefined): string | null => (date === undefined || date === null ? null : date.toISOString());
const unique = (values: readonly number[] | undefined): number[] => [...new Set(values ?? [])];

/** Thrown inside a transaction to roll it back and report why. */
class RollbackSignal extends Error {
  constructor(readonly result: Exclude<GenerateResult, { kind: 'CREATED' }>) {
    super('rollback');
  }
}

/**
 * Atomic usage bump: succeeds only while the limit has room. Zero rows means the limit was
 * just reached (or the discount vanished).
 */
async function incrementUsedCount(tx: SequenceExecutor, discountId: number): Promise<boolean> {
  const plan = tx.raw.sql`UPDATE "public"."Discount" SET "usedCount" = "usedCount" + 1 WHERE "id" = ${discountId} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit") RETURNING "id"`
    .returnsRow({ id: tx.sql.public.Discount.columns.id })
    .build();
  const rows = await tx.query(plan);
  return rows.length === 1;
}

async function decrementUsedCount(tx: SequenceExecutor, discountId: number): Promise<void> {
  const plan = tx.raw.sql`UPDATE "public"."Discount" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE "id" = ${discountId} RETURNING "id"`
    .returnsRow({ id: tx.sql.public.Discount.columns.id })
    .build();
  await tx.query(plan);
}

function buildWhere(query: ListInvoicesParams, scope: ListScope) {
  return (invoice: InvoiceAccessor) => {
    const today = scope.today.toISOString();
    const conditions = [];
    const customerId = scope.customerId ?? query.customerId;
    if (customerId !== undefined) conditions.push(invoice.customerId.eq(customerId));
    if (scope.statuses !== undefined) conditions.push(invoice.status.in([...scope.statuses]));
    if (query.search !== undefined) {
      const pattern = `%${query.search}%`;
      conditions.push(or(
        invoice.number.ilike(pattern), invoice.customerName.ilike(pattern), invoice.customerEmail.ilike(pattern),
      ));
    }
    if (query.status !== undefined) conditions.push(invoice.status.in(query.status));
    if (query.subscriptionId !== undefined) conditions.push(invoice.subscriptionId.eq(query.subscriptionId));
    if (query.billingRunId !== undefined) conditions.push(invoice.billingRunId.eq(query.billingRunId));
    if (query.issueFrom !== undefined) conditions.push(invoice.issueDate.gte(query.issueFrom.toISOString()));
    if (query.issueTo !== undefined) conditions.push(invoice.issueDate.lte(query.issueTo.toISOString()));
    if (query.dueFrom !== undefined) conditions.push(invoice.dueDate.gte(query.dueFrom.toISOString()));
    if (query.dueTo !== undefined) conditions.push(invoice.dueDate.lte(query.dueTo.toISOString()));
    if (query.minTotal !== undefined) conditions.push(invoice.total.gte(query.minTotal));
    if (query.maxTotal !== undefined) conditions.push(invoice.total.lte(query.maxTotal));
    if (query.outstanding !== undefined) {
      conditions.push(query.outstanding
        ? and(invoice.status.eq(InvoiceStatus.CONFIRMED), invoice.amountDue.gt(0))
        : or(invoice.status.neq(InvoiceStatus.CONFIRMED), invoice.amountDue.lte(0)));
    }
    if (query.overdue !== undefined) {
      conditions.push(query.overdue
        ? and(invoice.status.eq(InvoiceStatus.CONFIRMED), invoice.amountDue.gt(0), invoice.dueDate.lt(today))
        : or(invoice.status.neq(InvoiceStatus.CONFIRMED), invoice.amountDue.lte(0), invoice.dueDate.gte(today)));
    }
    return and(...conditions);
  };
}

export class InvoicesRepository {
  async list(query: ListInvoicesParams, scope: ListScope): Promise<InvoiceRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.Invoice
      .where(buildWhere(query, scope))
      .orderBy([
        (invoice) => {
          const column = query.sortBy === 'number' ? invoice.number
            : query.sortBy === 'issueDate' ? invoice.issueDate
              : query.sortBy === 'dueDate' ? invoice.dueDate
                : query.sortBy === 'total' ? invoice.total
                  : query.sortBy === 'amountDue' ? invoice.amountDue
                    : query.sortBy === 'status' ? invoice.status
                      : invoice.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (invoice) => (asc ? invoice.id.asc() : invoice.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toInvoiceRow);
  }

  async count(query: ListInvoicesParams, scope: ListScope): Promise<number> {
    const result = await prisma.orm.public.Invoice.where(buildWhere(query, scope)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** A customer scope (id and visible statuses) is part of the query itself. */
  async findById(id: number, scope: InvoiceScope = {}): Promise<InvoiceRow | null> {
    const row = await prisma.orm.public.Invoice
      .where((invoice) => {
        const conditions = [invoice.id.eq(id)];
        if (scope.customerId !== undefined) conditions.push(invoice.customerId.eq(scope.customerId));
        if (scope.statuses !== undefined) conditions.push(invoice.status.in([...scope.statuses]));
        return and(...conditions);
      })
      .first();
    return row === null ? null : toInvoiceRow(row);
  }

  async listLines(invoiceId: number): Promise<InvoiceLineRow[]> {
    const rows = await prisma.orm.public.InvoiceLine
      .where((line) => line.invoiceId.eq(invoiceId))
      .orderBy([(line) => line.sortOrder.asc(), (line) => line.id.asc()])
      .all();
    return rows.map(toLineRow);
  }

  /** Read-only: payments recorded against the invoice, oldest first. */
  async listPayments(invoiceId: number): Promise<PaymentRow[]> {
    const rows = await prisma.orm.public.Payment
      .where((payment) => payment.invoiceId.eq(invoiceId))
      .orderBy([(payment) => payment.paymentDate.asc(), (payment) => payment.id.asc()])
      .all();
    return rows.map((row) => ({
      id: row.id, invoiceId: row.invoiceId, customerId: row.customerId, method: row.method, amount: row.amount,
      paymentDate: row.paymentDate, reference: row.reference, note: row.note, recordedById: row.recordedById,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    }));
  }

  async listDiscountUsages(invoiceId: number): Promise<DiscountUsageRow[]> {
    const rows = await prisma.orm.public.DiscountUsage
      .where((usage) => usage.invoiceId.eq(invoiceId))
      .orderBy([(usage) => usage.id.asc()])
      .all();
    return rows.map((row) => ({
      id: row.id, discountId: row.discountId, invoiceId: row.invoiceId, subscriptionId: row.subscriptionId,
      amount: row.amount, createdAt: row.createdAt,
    }));
  }

  /** Read-only display names, batched. Deleted or inactive rows still resolve. */
  async lookupNames(request: NameRequest): Promise<Names> {
    const subscriptionIds = unique(request.subscriptionIds);
    const productIds = unique(request.productIds);
    const variantIds = unique(request.variantIds);
    const taxIds = unique(request.taxIds);
    const discountIds = unique(request.discountIds);
    const paymentTermIds = unique(request.paymentTermIds);
    const userIds = unique(request.userIds);
    const [subscriptions, products, variants, taxes, discounts, terms, users] = await Promise.all([
      subscriptionIds.length === 0 ? [] : prisma.orm.public.Subscription.where((row) => row.id.in(subscriptionIds)).all(),
      productIds.length === 0 ? [] : prisma.orm.public.Product.where((row) => row.id.in(productIds)).all(),
      variantIds.length === 0 ? [] : prisma.orm.public.ProductVariant.where((row) => row.id.in(variantIds)).all(),
      taxIds.length === 0 ? [] : prisma.orm.public.Tax.where((row) => row.id.in(taxIds)).all(),
      discountIds.length === 0 ? [] : prisma.orm.public.Discount.where((row) => row.id.in(discountIds)).all(),
      paymentTermIds.length === 0 ? [] : prisma.orm.public.PaymentTerm.where((row) => row.id.in(paymentTermIds)).all(),
      userIds.length === 0 ? [] : prisma.orm.public.User.where((row) => row.id.in(userIds)).all(),
    ]);
    return {
      subscriptions: new Map(subscriptions.map((row) => [row.id, row.number])),
      products: new Map(products.map((row) => [row.id, row.name])),
      variants: new Map(variants.map((row) => [row.id, `${row.attribute}: ${row.value}`])),
      taxes: new Map(taxes.map((row) => [row.id, { name: row.name, type: row.type }])),
      discounts: new Map(discounts.map((row) => [row.id, row.name])),
      paymentTerms: new Map(terms.map((row) => [row.id, row.name])),
      users: new Map(users.map((row) => [row.id, row.name])),
    };
  }

  /**
   * One transaction per generated invoice (backend plan section 4):
   * 1. advance the subscription (conditional on the `nextBillingDate` the caller read),
   * 2. bump each discount's `usedCount` while it has room (ascending id, so parallel
   *    generations lock in the same order),
   * 3. allocate the invoice number (a rollback releases it),
   * 4. insert the invoice, its lines and its discount usages.
   * A unique violation on (subscription, period) aborts the transaction and is thrown to
   * the caller, which turns it into ALREADY_BILLED; nothing is committed.
   */
  async generate(write: GenerateWrite): Promise<GenerateResult> {
    try {
      return await prisma.transaction(async (tx): Promise<GenerateResult> => {
        const now = new Date().toISOString();
        const advanced = await tx.orm.public.Subscription
          .where((sub) => and(
            sub.id.eq(write.subscriptionId),
            sub.status.eq('ACTIVE'),
            sub.deletedAt.isNull(),
            sub.nextBillingDate.eq(write.expectedNextBillingDate.toISOString()),
          ))
          .updateAll({
            nextBillingDate: write.periodEnd.toISOString(),
            lastBilledUntil: write.periodEnd.toISOString(),
            updatedAt: now,
          });
        if (advanced.length === 0) return { kind: 'STALE' };

        const discountIds = [...new Set(write.usages.map((usage) => usage.discountId))].sort((a, b) => a - b);
        for (const discountId of discountIds) {
          if (!(await incrementUsedCount(tx, discountId))) {
            throw new RollbackSignal({ kind: 'DISCOUNT_LIMIT', discountId });
          }
        }

        const allocated = await allocateSequenceValue(tx, SequenceKey.INVOICE, write.year);
        const invoice = await tx.orm.public.Invoice.create({
          number: formatSequenceNumber(SequenceKey.INVOICE, allocated.year, allocated.value),
          subscriptionId: write.subscriptionId,
          customerId: write.customerId,
          paymentTermId: write.paymentTermId,
          status: write.status,
          currency: write.currency,
          periodStart: write.periodStart.toISOString(),
          periodEnd: write.periodEnd.toISOString(),
          issueDate: write.issueDate.toISOString(),
          dueDate: write.dueDate.toISOString(),
          customerName: write.customerName,
          customerEmail: write.customerEmail,
          customerTaxId: write.customerTaxId,
          billingAddress: write.billingAddress,
          subtotal: write.subtotal,
          discountTotal: write.discountTotal,
          taxTotal: write.taxTotal,
          total: write.total,
          amountPaid: 0,
          amountDue: write.amountDue,
          confirmedAt: iso(write.confirmedAt),
          paidAt: iso(write.paidAt),
          billingRunId: write.billingRunId,
          createdById: write.createdById,
        });
        if (write.lines.length > 0) {
          await tx.orm.public.InvoiceLine.createAll(write.lines.map((line) => ({ invoiceId: invoice.id, ...line })));
        }
        if (write.usages.length > 0) {
          await tx.orm.public.DiscountUsage.createAll(write.usages.map((usage) => ({
            discountId: usage.discountId, invoiceId: invoice.id, subscriptionId: write.subscriptionId, amount: usage.amount,
          })));
        }
        return { kind: 'CREATED', invoice: toInvoiceRow(invoice) };
      });
    } catch (error) {
      if (error instanceof RollbackSignal) return error.result;
      throw error;
    }
  }

  /** Conditional DRAFT -> CONFIRMED (or PAID for a zero total). Null when it is no longer a DRAFT of that total. */
  async confirm(id: number, write: ConfirmWrite): Promise<InvoiceRow | null> {
    const now = write.now.toISOString();
    const rows = await prisma.orm.public.Invoice
      .where((invoice) => and(invoice.id.eq(id), invoice.status.eq(InvoiceStatus.DRAFT), invoice.total.eq(write.total)))
      .updateAll({
        status: write.settled ? InvoiceStatus.PAID : InvoiceStatus.CONFIRMED,
        confirmedAt: now,
        paidAt: write.settled ? now : null,
        amountDue: write.settled ? 0 : write.total,
        updatedAt: now,
      });
    const row = rows[0];
    return row === undefined ? null : toInvoiceRow(row);
  }

  /**
   * Status change plus the discount reversal in one transaction. Conditional on a DRAFT or
   * CONFIRMED invoice with no payment: a payment that lands first makes this return null
   * and nothing is written. `nextBillingDate` is never touched (plan decision 10).
   */
  async cancel(id: number, reason: string, now: Date): Promise<InvoiceRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.Invoice
        .where((invoice) => and(
          invoice.id.eq(id),
          invoice.status.in([InvoiceStatus.DRAFT, InvoiceStatus.CONFIRMED]),
          invoice.amountPaid.eq(0),
        ))
        .updateAll({
          status: InvoiceStatus.CANCELLED,
          cancelledAt: now.toISOString(),
          cancelReason: reason,
          amountDue: 0,
          updatedAt: now.toISOString(),
        });
      const row = rows[0];
      if (row === undefined) return null;
      const usages = await tx.orm.public.DiscountUsage.where((usage) => usage.invoiceId.eq(id)).all();
      if (usages.length > 0) {
        await tx.orm.public.DiscountUsage.where((usage) => usage.invoiceId.eq(id)).deleteAll();
        const discountIds = [...new Set(usages.map((usage) => usage.discountId))].sort((a, b) => a - b);
        for (const discountId of discountIds) await decrementUsedCount(tx, discountId);
      }
      return toInvoiceRow(row);
    });
  }

  /** DRAFT only. Null when the invoice is missing or no longer a DRAFT. */
  async updateDraft(id: number, fields: InvoiceHeaderFields): Promise<InvoiceRow | null> {
    const rows = await prisma.orm.public.Invoice
      .where((invoice) => and(invoice.id.eq(id), invoice.status.eq(InvoiceStatus.DRAFT)))
      .updateAll({
        ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
        ...(fields.dueDate !== undefined ? { dueDate: fields.dueDate.toISOString() } : {}),
        updatedAt: new Date().toISOString(),
      });
    const row = rows[0];
    return row === undefined ? null : toInvoiceRow(row);
  }

  /** Conditional on CONFIRMED or PAID. Null when the invoice is in any other state. */
  async markSent(id: number, now: Date): Promise<InvoiceRow | null> {
    const rows = await prisma.orm.public.Invoice
      .where((invoice) => and(invoice.id.eq(id), invoice.status.in([InvoiceStatus.CONFIRMED, InvoiceStatus.PAID])))
      .updateAll({ sentAt: now.toISOString(), updatedAt: now.toISOString() });
    const row = rows[0];
    return row === undefined ? null : toInvoiceRow(row);
  }
}

function toInvoiceRow(row: InvoiceRow): InvoiceRow {
  return {
    id: row.id, number: row.number, subscriptionId: row.subscriptionId, customerId: row.customerId,
    paymentTermId: row.paymentTermId, status: row.status, currency: row.currency, periodStart: row.periodStart,
    periodEnd: row.periodEnd, issueDate: row.issueDate, dueDate: row.dueDate, customerName: row.customerName,
    customerEmail: row.customerEmail, customerTaxId: row.customerTaxId, billingAddress: row.billingAddress,
    subtotal: row.subtotal, discountTotal: row.discountTotal, taxTotal: row.taxTotal, total: row.total,
    amountPaid: row.amountPaid, amountDue: row.amountDue, confirmedAt: row.confirmedAt, sentAt: row.sentAt,
    paidAt: row.paidAt, cancelledAt: row.cancelledAt, cancelReason: row.cancelReason, notes: row.notes,
    billingRunId: row.billingRunId, createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toLineRow(row: InvoiceLineRow): InvoiceLineRow {
  return {
    id: row.id, invoiceId: row.invoiceId, productId: row.productId, variantId: row.variantId, taxId: row.taxId,
    discountId: row.discountId, description: row.description, quantity: row.quantity, unitPrice: row.unitPrice,
    discountAmount: row.discountAmount, taxRate: row.taxRate, taxAmount: row.taxAmount, amount: row.amount,
    sortOrder: row.sortOrder,
  };
}
