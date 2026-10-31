/**
 * Customer data access. Writes only touch `Customer`. `User`, `Subscription` and
 * `Invoice` are read-only here: users to link a portal account, the other two for
 * the summary, the outstanding filter and the delete guard.
 */

import { InvoiceStatus, Role, SubscriptionStatus, type RoleDto } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { CreateCustomerInput, ListCustomersParams, UpdateCustomerInput } from './customers.schema.js';

export interface CustomerRow {
  id: number;
  userId: number | null;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortalUserRow {
  id: number;
  name: string;
  email: string;
  role: RoleDto;
}

export interface CustomerSummaryRow {
  activeSubscriptions: number;
  outstandingAmount: number;
  overdueCount: number;
}

export interface DeleteBlockers {
  subscriptions: number;
  invoices: number;
}

type CustomerAccessor = ModelAccessor<Contract, 'Customer', 'public'>;

/** Makes `%`, `_` and `\` literal so user input cannot act as an ILIKE wildcard. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildWhere(query: ListCustomersParams) {
  return (customer: CustomerAccessor) => {
    const conditions = [customer.deletedAt.isNull()];
    if (query.search !== undefined) {
      const pattern = `%${likeLiteral(query.search)}%`;
      conditions.push(or(
        customer.name.ilike(pattern),
        customer.companyName.ilike(pattern),
        customer.email.ilike(pattern),
        customer.phone.ilike(pattern),
        customer.taxId.ilike(pattern),
      ));
    }
    if (query.hasPortalAccount !== undefined) {
      conditions.push(query.hasPortalAccount ? customer.userId.isNotNull() : customer.userId.isNull());
    }
    if (query.hasOutstanding !== undefined) {
      const outstanding = (invoice: ModelAccessor<Contract, 'Invoice', 'public'>) =>
        and(invoice.status.eq(InvoiceStatus.CONFIRMED), invoice.amountDue.gt(0));
      conditions.push(query.hasOutstanding ? customer.invoices.some(outstanding) : customer.invoices.none(outstanding));
    }
    if (query.city !== undefined) conditions.push(customer.city.ilike(likeLiteral(query.city)));
    if (query.state !== undefined) conditions.push(customer.state.ilike(likeLiteral(query.state)));
    if (query.createdFrom !== undefined) conditions.push(customer.createdAt.gte(query.createdFrom.toISOString()));
    if (query.createdTo !== undefined) conditions.push(customer.createdAt.lte(query.createdTo.toISOString()));
    return and(...conditions);
  };
}

function writableFields(patch: UpdateCustomerInput) {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.taxId !== undefined ? { taxId: patch.taxId } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.addressLine1 !== undefined ? { addressLine1: patch.addressLine1 } : {}),
    ...(patch.addressLine2 !== undefined ? { addressLine2: patch.addressLine2 } : {}),
    ...(patch.city !== undefined ? { city: patch.city } : {}),
    ...(patch.state !== undefined ? { state: patch.state } : {}),
    ...(patch.postalCode !== undefined ? { postalCode: patch.postalCode } : {}),
    ...(patch.country !== undefined ? { country: patch.country } : {}),
  };
}

export class CustomersRepository {
  async list(query: ListCustomersParams): Promise<CustomerRow[]> {
    const asc = query.sortOrder === 'asc';
    return prisma.orm.public.Customer
      .where(buildWhere(query))
      .orderBy([
        (customer) => {
          const column = query.sortBy === 'name' ? customer.name
            : query.sortBy === 'companyName' ? customer.companyName : customer.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (customer) => (asc ? customer.id.asc() : customer.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async count(query: ListCustomersParams): Promise<number> {
    const result = await prisma.orm.public.Customer.where(buildWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Soft-deleted customers are not found. */
  async findById(id: number): Promise<CustomerRow | null> {
    const rows = await prisma.orm.public.Customer
      .where((customer) => and(customer.id.eq(id), customer.deletedAt.isNull()))
      .limit(1)
      .all();
    return rows[0] ?? null;
  }

  /** Includes soft-deleted rows, because the unique userId constraint still applies to them. */
  async findByUserId(userId: number): Promise<CustomerRow | null> {
    const rows = await prisma.orm.public.Customer.where((customer) => customer.userId.eq(userId)).limit(1).all();
    return rows[0] ?? null;
  }

  async findUserById(userId: number): Promise<PortalUserRow | null> {
    const rows = await prisma.orm.public.User
      .where((user) => and(user.id.eq(userId), user.deletedAt.isNull()))
      .limit(1)
      .all();
    const row = rows[0];
    return row === undefined ? null : { id: row.id, name: row.name, email: row.email, role: row.role };
  }

  /**
   * Summary for a page of customers in 3 grouped queries, whatever the page size:
   * active subscriptions, outstanding invoices, overdue invoices.
   */
  async summaries(ids: readonly number[], now: Date): Promise<Map<number, CustomerSummaryRow>> {
    const result = new Map<number, CustomerSummaryRow>();
    if (ids.length === 0) return result;
    const unpaid = (invoice: ModelAccessor<Contract, 'Invoice', 'public'>) =>
      and(invoice.customerId.in(ids), invoice.status.eq(InvoiceStatus.CONFIRMED), invoice.amountDue.gt(0));

    const [active, outstanding, overdue] = await Promise.all([
      prisma.orm.public.Subscription
        .where((sub) => and(sub.customerId.in(ids), sub.status.eq(SubscriptionStatus.ACTIVE), sub.deletedAt.isNull()))
        .groupBy('customerId')
        .aggregate((agg) => ({ n: agg.count() })),
      prisma.orm.public.Invoice
        .where(unpaid)
        .groupBy('customerId')
        .aggregate((agg) => ({ amount: agg.sum('amountDue') })),
      prisma.orm.public.Invoice
        .where((invoice) => and(unpaid(invoice), invoice.dueDate.lt(now.toISOString())))
        .groupBy('customerId')
        .aggregate((agg) => ({ n: agg.count() })),
    ]);

    for (const id of ids) result.set(id, { activeSubscriptions: 0, outstandingAmount: 0, overdueCount: 0 });
    for (const row of active) {
      const entry = result.get(row.customerId);
      if (entry !== undefined) entry.activeSubscriptions = row.n;
    }
    for (const row of outstanding) {
      const entry = result.get(row.customerId);
      if (entry !== undefined) entry.outstandingAmount = Number(row.amount ?? 0);
    }
    for (const row of overdue) {
      const entry = result.get(row.customerId);
      if (entry !== undefined) entry.overdueCount = row.n;
    }
    return result;
  }

  /**
   * Creates the customer. When a verified-or-not CUSTOMER user with the same email
   * exists and has no customer yet, the new row is linked to it. Two concurrent
   * links to one user collide on the unique userId constraint.
   */
  async create(input: CreateCustomerInput): Promise<CustomerRow> {
    return prisma.transaction(async (tx) => {
      const users = await tx.orm.public.User
        .where((user) => and(
          user.email.ilike(likeLiteral(input.email)), user.role.eq(Role.CUSTOMER), user.deletedAt.isNull(),
        ))
        .limit(1)
        .all();
      const user = users[0];
      let userId: number | null = null;
      if (user !== undefined) {
        const taken = await tx.orm.public.Customer.where((customer) => customer.userId.eq(user.id)).limit(1).all();
        if (taken.length === 0) userId = user.id;
      }
      return tx.orm.public.Customer.create({
        userId,
        name: input.name,
        email: input.email,
        companyName: input.companyName ?? null,
        phone: input.phone ?? null,
        taxId: input.taxId ?? null,
        notes: input.notes ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? null,
      });
    });
  }

  /** Customer created for a portal user from the user's own name and email. */
  async createForUser(user: PortalUserRow): Promise<CustomerRow> {
    return prisma.orm.public.Customer.create({ userId: user.id, name: user.name, email: user.email.toLowerCase() });
  }

  /**
   * Links the oldest unlinked, non-deleted customer with this email (case-insensitive)
   * to the user. The update is conditional on `userId IS NULL`, so it never steals a link.
   */
  async linkByEmail(userId: number, email: string): Promise<CustomerRow | null> {
    const candidates = await prisma.orm.public.Customer
      .where((customer) => and(
        customer.email.ilike(likeLiteral(email)), customer.userId.isNull(), customer.deletedAt.isNull(),
      ))
      .orderBy((customer) => customer.id.asc())
      .limit(1)
      .all();
    const candidate = candidates[0];
    if (candidate === undefined) return null;
    const rows = await prisma.orm.public.Customer
      .where((customer) => and(customer.id.eq(candidate.id), customer.userId.isNull()))
      .updateAll({ userId });
    return rows[0] ?? null;
  }

  async update(id: number, patch: UpdateCustomerInput): Promise<CustomerRow | null> {
    const rows = await prisma.orm.public.Customer
      .where((customer) => and(customer.id.eq(id), customer.deletedAt.isNull()))
      .updateAll(writableFields(patch));
    return rows[0] ?? null;
  }

  /** Subscriptions that are ACTIVE or PAUSED, and CONFIRMED invoices with money still due. */
  async deleteBlockers(id: number): Promise<DeleteBlockers> {
    const [subscriptions, invoices] = await Promise.all([
      prisma.orm.public.Subscription
        .where((sub) => and(
          sub.customerId.eq(id), sub.deletedAt.isNull(),
          sub.status.in([SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED]),
        ))
        .aggregate((agg) => ({ n: agg.count() })),
      prisma.orm.public.Invoice
        .where((invoice) => and(
          invoice.customerId.eq(id), invoice.status.eq(InvoiceStatus.CONFIRMED), invoice.amountDue.gt(0),
        ))
        .aggregate((agg) => ({ n: agg.count() })),
    ]);
    return { subscriptions: subscriptions.n, invoices: invoices.n };
  }

  /** Conditional on not already deleted. Returns the deleted row, or null when there was nothing to delete. */
  async softDelete(id: number): Promise<CustomerRow | null> {
    const rows = await prisma.orm.public.Customer
      .where((customer) => and(customer.id.eq(id), customer.deletedAt.isNull()))
      .updateAll({ deletedAt: new Date().toISOString() });
    return rows[0] ?? null;
  }
}
