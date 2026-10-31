/**
 * Payment data access. Section-4 exception (backend plan): inside one
 * transaction this repository also writes `Invoice.amountPaid`, `amountDue`,
 * `status` and `paidAt`, so a payment and its invoice balance change together.
 * Everything else on `Invoice`, `Customer` and `User` is read-only here.
 */

import { InvoiceStatus, type PaymentMethod } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { CreatePaymentInput, ListPaymentsParams, UpdatePaymentInput } from './payments.schema.js';

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

/** A payment plus the names shown next to it. Looked up in batches, never per row. */
export interface PaymentRecord extends PaymentRow {
  invoiceNumber: string;
  customerName: string;
  recordedByName: string | null;
}

/** Customer scope for reads: `customerId` is part of the query itself. */
export interface PaymentScope {
  customerId?: number;
  /** Customers only see payments of CONFIRMED and PAID invoices. */
  visibleInvoicesOnly?: boolean;
}

export interface InvoiceBalance {
  status: InvoiceStatus;
  amountDue: number;
}

export type CreatePaymentOutcome =
  | { kind: 'created'; payment: PaymentRecord; invoice: InvoiceBalance }
  | { kind: 'invoice-missing' }
  | { kind: 'not-payable'; status: InvoiceStatus }
  | { kind: 'overpayment'; amountDue: number };

export interface DeletePaymentResult {
  payment: PaymentRow;
  invoice: InvoiceBalance;
}

type PaymentAccessor = ModelAccessor<Contract, 'Payment', 'public'>;

const CUSTOMER_VISIBLE: InvoiceStatus[] = [InvoiceStatus.CONFIRMED, InvoiceStatus.PAID];

/** Makes `%`, `_` and `\` literal so user input cannot act as an ILIKE wildcard. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toPaymentRow(row: PaymentRow): PaymentRow {
  return {
    id: row.id, invoiceId: row.invoiceId, customerId: row.customerId, method: row.method, amount: row.amount,
    paymentDate: row.paymentDate, reference: row.reference, note: row.note, recordedById: row.recordedById,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function scopeConditions(payment: PaymentAccessor, scope: PaymentScope) {
  const conditions = [];
  if (scope.customerId !== undefined) conditions.push(payment.customerId.eq(scope.customerId));
  if (scope.visibleInvoicesOnly === true) {
    conditions.push(payment.invoice.some((invoice) => invoice.status.in(CUSTOMER_VISIBLE)));
  }
  return conditions;
}

function buildWhere(query: ListPaymentsParams, scope: PaymentScope) {
  return (payment: PaymentAccessor) => {
    const conditions = scopeConditions(payment, scope);
    const customerId = scope.customerId ?? query.customerId;
    if (scope.customerId === undefined && customerId !== undefined) conditions.push(payment.customerId.eq(customerId));
    if (query.invoiceId !== undefined) conditions.push(payment.invoiceId.eq(query.invoiceId));
    if (query.method !== undefined) conditions.push(payment.method.in(query.method));
    if (query.paidFrom !== undefined) conditions.push(payment.paymentDate.gte(query.paidFrom.toISOString()));
    if (query.paidTo !== undefined) conditions.push(payment.paymentDate.lte(query.paidTo.toISOString()));
    if (query.minAmount !== undefined) conditions.push(payment.amount.gte(query.minAmount));
    if (query.maxAmount !== undefined) conditions.push(payment.amount.lte(query.maxAmount));
    if (query.search !== undefined) {
      const pattern = `%${likeLiteral(query.search)}%`;
      conditions.push(or(
        payment.reference.ilike(pattern),
        payment.note.ilike(pattern),
        payment.invoice.some((invoice) => invoice.number.ilike(pattern)),
        payment.customer.some((customer) => customer.name.ilike(pattern)),
      ));
    }
    return and(...conditions);
  };
}

export class PaymentsRepository {
  async list(query: ListPaymentsParams, scope: PaymentScope): Promise<PaymentRecord[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.Payment
      .where(buildWhere(query, scope))
      .orderBy([
        (payment) => {
          const column = query.sortBy === 'paymentDate' ? payment.paymentDate
            : query.sortBy === 'amount' ? payment.amount
              : payment.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (payment) => (asc ? payment.id.asc() : payment.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return this.enrich(rows.map(toPaymentRow));
  }

  async count(query: ListPaymentsParams, scope: PaymentScope): Promise<number> {
    const result = await prisma.orm.public.Payment.where(buildWhere(query, scope)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async findById(id: number, scope: PaymentScope = {}): Promise<PaymentRecord | null> {
    const row = await prisma.orm.public.Payment
      .where((payment) => and(payment.id.eq(id), ...scopeConditions(payment, scope)))
      .first();
    if (row === null) return null;
    const [record] = await this.enrich([toPaymentRow(row)]);
    return record ?? null;
  }

  /**
   * One transaction. The conditional UPDATE is the only thing that moves the balance: Postgres
   * evaluates the right-hand sides against the old row and row-locks the invoice, so two parallel
   * payments that together exceed the balance cannot both match `amountDue >= amount`.
   * Zero rows updated writes nothing and is diagnosed by reading the invoice.
   */
  async create(input: CreatePaymentInput, recordedById: number): Promise<CreatePaymentOutcome> {
    const outcome = await prisma.transaction(async (tx): Promise<
      { kind: 'created'; row: PaymentRow; invoice: InvoiceBalance } | Exclude<CreatePaymentOutcome, { kind: 'created' }>
    > => {
      const invoice = tx.sql.public.Invoice;
      const amount = input.amount;
      const invoiceId = input.invoiceId;
      const plan = tx.raw.sql`
        UPDATE "public"."Invoice" SET
          "amountPaid" = "amountPaid" + ${amount},
          "amountDue" = "amountDue" - ${amount},
          "status" = CASE WHEN "amountDue" - ${amount} = 0 THEN 'PAID' ELSE "status" END,
          "paidAt" = CASE WHEN "amountDue" - ${amount} = 0 THEN now() ELSE "paidAt" END,
          "updatedAt" = now()
        WHERE "id" = ${invoiceId} AND "status" = 'CONFIRMED' AND "amountDue" >= ${amount}
        RETURNING "id", "customerId", "amountDue", "status"`
        .returnsRow({
          id: invoice.columns.id,
          customerId: invoice.columns.customerId,
          amountDue: invoice.columns.amountDue,
          status: invoice.columns.status,
        })
        .build();
      const updated = await tx.query(plan);
      const touched = updated[0];
      if (touched === undefined) {
        const current = await tx.orm.public.Invoice.where((row) => row.id.eq(invoiceId)).first();
        if (current === null) return { kind: 'invoice-missing' };
        if (current.status !== InvoiceStatus.CONFIRMED) return { kind: 'not-payable', status: current.status };
        return { kind: 'overpayment', amountDue: current.amountDue };
      }
      const row = await tx.orm.public.Payment.create({
        invoiceId,
        customerId: touched.customerId,
        method: input.method,
        amount,
        paymentDate: input.paymentDate.toISOString(),
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedById,
      });
      return { kind: 'created', row: toPaymentRow(row), invoice: { status: touched.status, amountDue: touched.amountDue } };
    });
    if (outcome.kind !== 'created') return outcome;
    const [payment] = await this.enrich([outcome.row]);
    if (payment === undefined) throw new Error('Payment was created but could not be read back');
    return { kind: 'created', payment, invoice: outcome.invoice };
  }

  /** Only `reference` and `note` are writable. Returns null when the payment does not exist. */
  async update(id: number, patch: UpdatePaymentInput): Promise<PaymentRecord | null> {
    const rows = await prisma.orm.public.Payment
      .where((payment) => payment.id.eq(id))
      .updateAll({
        ...(patch.reference !== undefined ? { reference: patch.reference } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
      });
    const row = rows[0];
    if (row === undefined) return null;
    const [record] = await this.enrich([toPaymentRow(row)]);
    return record ?? null;
  }

  /**
   * Deletes the payment, then reverses its amount on the invoice in the same transaction. PAID goes
   * back to CONFIRMED with `paidAt` cleared; any other status is kept. Returns null when the payment
   * is already gone (so a double delete reverses once).
   */
  async remove(id: number): Promise<DeletePaymentResult | null> {
    return prisma.transaction(async (tx) => {
      const deleted = await tx.orm.public.Payment.whereUnique({ id }).delete();
      if (deleted === null) return null;
      const invoice = tx.sql.public.Invoice;
      const amount = deleted.amount;
      const plan = tx.raw.sql`
        UPDATE "public"."Invoice" SET
          "amountPaid" = "amountPaid" - ${amount},
          "amountDue" = "amountDue" + ${amount},
          "status" = CASE WHEN "status" = 'PAID' THEN 'CONFIRMED' ELSE "status" END,
          "paidAt" = CASE WHEN "status" = 'PAID' THEN NULL ELSE "paidAt" END,
          "updatedAt" = now()
        WHERE "id" = ${deleted.invoiceId}
        RETURNING "id", "amountDue", "status"`
        .returnsRow({
          id: invoice.columns.id,
          amountDue: invoice.columns.amountDue,
          status: invoice.columns.status,
        })
        .build();
      const rows = await tx.query(plan);
      const reversed = rows[0];
      if (reversed === undefined) throw new Error('Invoice not found while reversing a payment');
      return { payment: toPaymentRow(deleted), invoice: { status: reversed.status, amountDue: reversed.amountDue } };
    });
  }

  /** Invoice numbers, customer names and recorder names for a page: three batched queries. */
  private async enrich(rows: readonly PaymentRow[]): Promise<PaymentRecord[]> {
    if (rows.length === 0) return [];
    const invoiceIds = [...new Set(rows.map((row) => row.invoiceId))];
    const customerIds = [...new Set(rows.map((row) => row.customerId))];
    const userIds = [...new Set(rows.flatMap((row) => (row.recordedById === null ? [] : [row.recordedById])))];
    const [invoices, customers, users] = await Promise.all([
      prisma.orm.public.Invoice.where((invoice) => invoice.id.in(invoiceIds)).all(),
      prisma.orm.public.Customer.where((customer) => customer.id.in(customerIds)).all(),
      userIds.length === 0 ? [] : prisma.orm.public.User.where((user) => user.id.in(userIds)).all(),
    ]);
    const invoiceNumbers = new Map(invoices.map((invoice) => [invoice.id, invoice.number]));
    const customerNames = new Map(customers.map((customer) => [customer.id, customer.name]));
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    return rows.map((row) => ({
      ...row,
      invoiceNumber: invoiceNumbers.get(row.invoiceId) ?? '',
      customerName: customerNames.get(row.customerId) ?? '',
      recordedByName: row.recordedById === null ? null : (userNames.get(row.recordedById) ?? null),
    }));
  }
}
