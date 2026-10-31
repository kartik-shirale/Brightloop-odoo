import type { BillingPeriod } from '@brightloop/shared';
import { and, or, type ModelAccessor } from '@prisma/orm-family-sql/orm-client';
import { prisma } from '../../config/prisma.js';
import { offsetFor } from '../../core/utils/pagination.js';
import type { Contract } from '../../prisma/contract.d.js';
import type { CreateTemplateInput, ListTemplatesParams, UpdateTemplateInput } from './quotation-templates.schema.js';

export interface TemplateRow {
  id: number;
  name: string;
  planId: number;
  validityDays: number;
  notes: string | null;
  isActive: boolean;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateLineRow {
  id: number;
  templateId: number;
  productId: number;
  variantId: number | null;
  quantity: number;
  sortOrder: number;
}

/** A line ready to store. `sortOrder` is the array index. */
export interface TemplateLineWrite {
  productId: number;
  variantId: number | null;
  quantity: number;
  sortOrder: number;
}

export interface TemplateLabels {
  plans: Map<number, { name: string; billingPeriod: BillingPeriod }>;
  products: Map<number, string>;
  /** `Attribute: value` */
  variants: Map<number, string>;
}

type TemplateAccessor = ModelAccessor<Contract, 'QuotationTemplate', 'public'>;

function buildWhere(query: ListTemplatesParams) {
  return (template: TemplateAccessor) => {
    const conditions = [template.deletedAt.isNull()];
    if (query.search !== undefined) {
      conditions.push(or(template.name.ilike(`%${query.search}%`), template.notes.ilike(`%${query.search}%`)));
    }
    if (query.planId !== undefined) conditions.push(template.planId.eq(query.planId));
    if (query.isActive !== undefined) conditions.push(template.isActive.eq(query.isActive));
    return and(...conditions);
  };
}

export class QuotationTemplatesRepository {
  async list(query: ListTemplatesParams): Promise<TemplateRow[]> {
    const asc = query.sortOrder === 'asc';
    const rows = await prisma.orm.public.QuotationTemplate
      .where(buildWhere(query))
      .orderBy([
        (template) => {
          const column = query.sortBy === 'name' ? template.name
            : query.sortBy === 'validityDays' ? template.validityDays
              : template.createdAt;
          return asc ? column.asc() : column.desc();
        },
        (template) => (asc ? template.id.asc() : template.id.desc()),
      ])
      .limit(query.limit)
      .offset(offsetFor(query.page, query.limit))
      .all();
    return rows.map(toTemplateRow);
  }

  async count(query: ListTemplatesParams): Promise<number> {
    const result = await prisma.orm.public.QuotationTemplate.where(buildWhere(query)).aggregate((agg) => ({ total: agg.count() }));
    return result.total;
  }

  /** Excludes soft-deleted templates. */
  async findById(id: number): Promise<TemplateRow | null> {
    const row = await prisma.orm.public.QuotationTemplate
      .where((template) => and(template.id.eq(id), template.deletedAt.isNull()))
      .first();
    return row === null ? null : toTemplateRow(row);
  }

  /** Ordered by sortOrder, then id. */
  async listLines(templateId: number): Promise<TemplateLineRow[]> {
    const rows = await prisma.orm.public.QuotationTemplateLine
      .where((line) => line.templateId.eq(templateId))
      .orderBy([(line) => line.sortOrder.asc(), (line) => line.id.asc()])
      .all();
    return rows.map(toLineRow);
  }

  /** Names for display only. Read-only; deleted plans and products still resolve. */
  async lookupLabels(planIds: readonly number[], productIds: readonly number[], variantIds: readonly number[]): Promise<TemplateLabels> {
    const [plans, products, variants] = await Promise.all([
      planIds.length === 0 ? [] : prisma.orm.public.Plan.where((plan) => plan.id.in([...planIds])).all(),
      productIds.length === 0 ? [] : prisma.orm.public.Product.where((product) => product.id.in([...productIds])).all(),
      variantIds.length === 0 ? [] : prisma.orm.public.ProductVariant.where((variant) => variant.id.in([...variantIds])).all(),
    ]);
    return {
      plans: new Map(plans.map((plan) => [plan.id, { name: plan.name, billingPeriod: plan.billingPeriod }])),
      products: new Map(products.map((product) => [product.id, product.name])),
      variants: new Map(variants.map((variant) => [variant.id, `${variant.attribute}: ${variant.value}`])),
    };
  }

  /** The template and all its lines commit together, or neither does. */
  async create(
    input: CreateTemplateInput,
    lines: readonly TemplateLineWrite[],
    createdById: number,
  ): Promise<{ template: TemplateRow; lines: TemplateLineRow[] }> {
    return prisma.transaction(async (tx) => {
      const template = await tx.orm.public.QuotationTemplate.create({
        name: input.name,
        planId: input.planId,
        validityDays: input.validityDays,
        notes: input.notes ?? null,
        isActive: input.isActive,
        createdById,
      });
      const created = await tx.orm.public.QuotationTemplateLine.createAll(
        lines.map((line) => ({ templateId: template.id, ...line })),
      );
      return { template: toTemplateRow(template), lines: sortLines(created.map(toLineRow)) };
    });
  }

  /**
   * Updates the fields and, when `lines` is given, replaces every line (delete then
   * insert) in one transaction. Returns null when the template does not exist or is deleted.
   */
  async update(id: number, patch: UpdateTemplateInput, lines?: readonly TemplateLineWrite[]): Promise<TemplateRow | null> {
    return prisma.transaction(async (tx) => {
      const rows = await tx.orm.public.QuotationTemplate
        .where((template) => and(template.id.eq(id), template.deletedAt.isNull()))
        .updateAll({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.planId !== undefined ? { planId: patch.planId } : {}),
          ...(patch.validityDays !== undefined ? { validityDays: patch.validityDays } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          updatedAt: new Date().toISOString(),
        });
      const row = rows[0];
      if (row === undefined) return null;
      if (lines !== undefined) {
        await tx.orm.public.QuotationTemplateLine.where((line) => line.templateId.eq(id)).deleteAll();
        await tx.orm.public.QuotationTemplateLine.createAll(lines.map((line) => ({ templateId: id, ...line })));
      }
      return toTemplateRow(row);
    });
  }

  /** Returns null when the template does not exist or is already deleted. Lines are kept. */
  async softDelete(id: number): Promise<TemplateRow | null> {
    const rows = await prisma.orm.public.QuotationTemplate
      .where((template) => and(template.id.eq(id), template.deletedAt.isNull()))
      .updateAll({ deletedAt: new Date().toISOString() });
    const row = rows[0];
    return row === undefined ? null : toTemplateRow(row);
  }
}

/** Drops `deletedAt` so it never travels past the repository. */
function toTemplateRow(row: TemplateRow): TemplateRow {
  return {
    id: row.id, name: row.name, planId: row.planId, validityDays: row.validityDays, notes: row.notes,
    isActive: row.isActive, createdById: row.createdById, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toLineRow(row: TemplateLineRow): TemplateLineRow {
  return {
    id: row.id, templateId: row.templateId, productId: row.productId, variantId: row.variantId,
    quantity: row.quantity, sortOrder: row.sortOrder,
  };
}

function sortLines(lines: TemplateLineRow[]): TemplateLineRow[] {
  return [...lines].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}
