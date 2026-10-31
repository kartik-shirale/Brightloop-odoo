import type { TaxType } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { CreateTaxInput, ListTaxesParams, UpdateTaxInput } from './taxes.schema.js';

export interface TaxRow {
  id: number;
  name: string;
  type: TaxType;
  rate: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type TaxAccessor = ModelAccessor<Contract, 'Tax', 'public'>;

function buildWhere(query: ListTaxesParams) {
  return (tax: TaxAccessor) => {
    const conditions = [];
    if (query.search !== undefined) conditions.push(tax.name.ilike(`%${query.search}%`));
    if (query.type !== undefined) conditions.push(or(...query.type.map((type) => tax.type.eq(type))));
    if (query.isActive !== undefined) conditions.push(tax.isActive.eq(query.isActive));
    return and(...conditions);
  };
}

export class TaxesRepository {
  async list(query: ListTaxesParams): Promise<TaxRow[]> {
    const asc = query.sortOrder === 'asc';
    return prisma.orm.public.Tax
      .where(buildWhere(query))
      .orderBy([
        (tax) => {
          const column = query.sortBy === 'name' ? tax.name : query.sortBy === 'rate' ? tax.rate : tax.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (tax) => (asc ? tax.id.asc() : tax.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
  }

  async count(query: ListTaxesParams): Promise<number> {
    const result = await prisma.orm.public.Tax.where(buildWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async findById(id: number): Promise<TaxRow | null> {
    return prisma.orm.public.Tax.whereUnique({ id }).first();
  }

  async findByIds(ids: readonly number[]): Promise<TaxRow[]> {
    if (ids.length === 0) return [];
    return prisma.orm.public.Tax.where((tax) => or(...ids.map((id) => tax.id.eq(id)))).all();
  }

  async create(input: CreateTaxInput): Promise<TaxRow> {
    return prisma.orm.public.Tax.create({
      name: input.name,
      type: input.type,
      rate: input.rate,
      isActive: input.isActive,
    });
  }

  async update(id: number, patch: UpdateTaxInput): Promise<TaxRow | null> {
    return prisma.orm.public.Tax.whereUnique({ id }).update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.rate !== undefined ? { rate: patch.rate } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    });
  }

  /** Returns the deleted row, or null when it did not exist. A referenced tax fails on the foreign key. */
  async delete(id: number): Promise<TaxRow | null> {
    return prisma.orm.public.Tax.whereUnique({ id }).delete();
  }
}
