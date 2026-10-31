import type { BillingPeriod } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { endOfUtcDay, startOfUtcDay } from '../../core/utils/dates.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { CreatePlanInput, ListPlansParams, UpdatePlanInput } from './plans.schema.js';

export interface PlanRow {
  id: number;
  name: string;
  description: string | null;
  price: number;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  availableFrom: string;
  availableTo: string | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  isActive: boolean;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

type PlanAccessor = ModelAccessor<Contract, 'Plan', 'public'>;

function buildWhere(query: ListPlansParams) {
  return (plan: PlanAccessor) => {
    const conditions = [plan.deletedAt.isNull()];
    if (query.search !== undefined) {
      conditions.push(or(plan.name.ilike(`%${query.search}%`), plan.description.ilike(`%${query.search}%`)));
    }
    if (query.billingPeriod !== undefined) {
      conditions.push(or(...query.billingPeriod.map((period) => plan.billingPeriod.eq(period))));
    }
    if (query.isActive !== undefined) conditions.push(plan.isActive.eq(query.isActive));
    if (query.autoClose !== undefined) conditions.push(plan.autoClose.eq(query.autoClose));
    if (query.closable !== undefined) conditions.push(plan.closable.eq(query.closable));
    if (query.pausable !== undefined) conditions.push(plan.pausable.eq(query.pausable));
    if (query.renewable !== undefined) conditions.push(plan.renewable.eq(query.renewable));
    if (query.availableOn !== undefined) {
      conditions.push(
        plan.availableFrom.lte(endOfUtcDay(query.availableOn).toISOString()),
        or(plan.availableTo.isNull(), plan.availableTo.gte(startOfUtcDay(query.availableOn).toISOString())),
      );
    }
    return and(...conditions);
  };
}

export class PlansRepository {
  async list(query: ListPlansParams): Promise<PlanRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.Plan
      .where(buildWhere(query))
      .orderBy([
        (plan) => {
          const column = query.sortBy === 'name' ? plan.name
            : query.sortBy === 'price' ? plan.price
              : query.sortBy === 'availableFrom' ? plan.availableFrom
                : plan.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (plan) => (asc ? plan.id.asc() : plan.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toPlanRow);
  }

  async count(query: ListPlansParams): Promise<number> {
    const result = await prisma.orm.public.Plan.where(buildWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Excludes soft-deleted plans. */
  async findById(id: number): Promise<PlanRow | null> {
    const row = await prisma.orm.public.Plan
      .where((plan) => and(plan.id.eq(id), plan.deletedAt.isNull()))
      .first();
    return row === null ? null : toPlanRow(row);
  }

  /** Subscriptions of the plan with status ACTIVE (not deleted). Read-only. */
  async countActiveSubscriptions(planId: number): Promise<number> {
    const result = await prisma.orm.public.Subscription
      .where((sub) => and(sub.planId.eq(planId), sub.deletedAt.isNull(), sub.status.eq('ACTIVE')))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Subscriptions of the plan that are not CLOSED and not deleted. Read-only. */
  async countOpenSubscriptions(planId: number): Promise<number> {
    const result = await prisma.orm.public.Subscription
      .where((sub) => and(sub.planId.eq(planId), sub.deletedAt.isNull(), sub.status.neq('CLOSED')))
      .aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  async create(input: CreatePlanInput, createdById: number): Promise<PlanRow> {
    const row = await prisma.orm.public.Plan.create({
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      billingPeriod: input.billingPeriod,
      minQuantity: input.minQuantity,
      availableFrom: input.availableFrom.toISOString(),
      availableTo: input.availableTo?.toISOString() ?? null,
      autoClose: input.autoClose,
      closable: input.closable,
      pausable: input.pausable,
      renewable: input.renewable,
      isActive: input.isActive,
      createdById,
    });
    return toPlanRow(row);
  }

  async update(id: number, patch: UpdatePlanInput): Promise<PlanRow | null> {
    const row = await prisma.orm.public.Plan.whereUnique({ id }).update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.billingPeriod !== undefined ? { billingPeriod: patch.billingPeriod } : {}),
      ...(patch.minQuantity !== undefined ? { minQuantity: patch.minQuantity } : {}),
      ...(patch.availableFrom !== undefined ? { availableFrom: patch.availableFrom.toISOString() } : {}),
      ...(patch.availableTo !== undefined ? { availableTo: patch.availableTo === null ? null : patch.availableTo.toISOString() } : {}),
      ...(patch.autoClose !== undefined ? { autoClose: patch.autoClose } : {}),
      ...(patch.closable !== undefined ? { closable: patch.closable } : {}),
      ...(patch.pausable !== undefined ? { pausable: patch.pausable } : {}),
      ...(patch.renewable !== undefined ? { renewable: patch.renewable } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    });
    return row === null ? null : toPlanRow(row);
  }

  /** Marks the plan deleted. Returns null when it does not exist. */
  async softDelete(id: number): Promise<PlanRow | null> {
    const row = await prisma.orm.public.Plan.whereUnique({ id }).update({ deletedAt: new Date().toISOString() });
    return row === null ? null : toPlanRow(row);
  }
}

/** Drops `deletedAt` so it never travels past the repository. */
function toPlanRow(row: PlanRow): PlanRow {
  return {
    id: row.id, name: row.name, description: row.description, price: row.price,
    billingPeriod: row.billingPeriod, minQuantity: row.minQuantity,
    availableFrom: row.availableFrom, availableTo: row.availableTo,
    autoClose: row.autoClose, closable: row.closable, pausable: row.pausable, renewable: row.renewable,
    isActive: row.isActive, createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
