import { and, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { CreatePaymentTermInput, ListPaymentTermsParams, UpdatePaymentTermInput } from './payment-terms.schema.js';

export interface PaymentTermRow {
  id: number;
  name: string;
  dueDays: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DeleteOutcome =
  | { kind: 'deleted'; row: PaymentTermRow }
  | { kind: 'not-found' }
  | { kind: 'is-default' };

type PaymentTermAccessor = ModelAccessor<Contract, 'PaymentTerm', 'public'>;

function buildWhere(query: ListPaymentTermsParams) {
  return (term: PaymentTermAccessor) => {
    const conditions = [];
    if (query.search !== undefined) conditions.push(term.name.ilike(`%${query.search}%`));
    if (query.isActive !== undefined) conditions.push(term.isActive.eq(query.isActive));
    if (query.isDefault !== undefined) conditions.push(term.isDefault.eq(query.isDefault));
    return and(...conditions);
  };
}

export class PaymentTermsRepository {
  async list(query: ListPaymentTermsParams): Promise<PaymentTermRow[]> {
    const asc = query.sortOrder === 'asc';
    return prisma.orm.public.PaymentTerm
      .where(buildWhere(query))
      .orderBy([
        (term) => {
          const column = query.sortBy === 'name' ? term.name : query.sortBy === 'dueDays' ? term.dueDays : term.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (term) => (asc ? term.id.asc() : term.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async count(query: ListPaymentTermsParams): Promise<number> {
    const result = await prisma.orm.public.PaymentTerm.where(buildWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async findById(id: number): Promise<PaymentTermRow | null> {
    return prisma.orm.public.PaymentTerm.whereUnique({ id }).first();
  }

  async findDefault(): Promise<PaymentTermRow | null> {
    return prisma.orm.public.PaymentTerm
      .where((term) => and(term.isDefault.eq(true), term.isActive.eq(true)))
      .orderBy([(term) => term.id.asc()])
      .first();
  }

  /** Creating a default clears the previous one in the same transaction. */
  async create(input: CreatePaymentTermInput): Promise<PaymentTermRow> {
    const data = { name: input.name, dueDays: input.dueDays, isDefault: input.isDefault, isActive: input.isActive };
    if (!input.isDefault) return prisma.orm.public.PaymentTerm.create(data);
    return prisma.transaction(async (tx) => {
      const row = await tx.orm.public.PaymentTerm.create(data);
      await tx.orm.public.PaymentTerm
        .where((term) => and(term.isDefault.eq(true), term.id.neq(row.id)))
        .updateAll({ isDefault: false });
      return row;
    });
  }

  /** Setting `isDefault` to true clears every other default in the same transaction. Returns null when the row does not exist. */
  async update(id: number, patch: UpdatePaymentTermInput): Promise<PaymentTermRow | null> {
    const data = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.dueDays !== undefined ? { dueDays: patch.dueDays } : {}),
      ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    };
    if (patch.isDefault !== true) return prisma.orm.public.PaymentTerm.whereUnique({ id }).update(data);
    return prisma.transaction(async (tx) => {
      const row = await tx.orm.public.PaymentTerm.whereUnique({ id }).update(data);
      if (row === null) return null;
      await tx.orm.public.PaymentTerm
        .where((term) => and(term.isDefault.eq(true), term.id.neq(id)))
        .updateAll({ isDefault: false });
      return row;
    });
  }

  /**
   * The default term is never deleted: the delete is conditional on `isDefault = false`, so a
   * concurrent "make default" cannot be raced. A referenced term fails on the foreign key.
   */
  async delete(id: number): Promise<DeleteOutcome> {
    const deleted = await prisma.orm.public.PaymentTerm
      .where((term) => and(term.id.eq(id), term.isDefault.eq(false)))
      .deleteAll();
    const row = deleted[0];
    if (row !== undefined) return { kind: 'deleted', row };
    const existing = await this.findById(id);
    return existing === null ? { kind: 'not-found' } : { kind: 'is-default' };
  }
}
