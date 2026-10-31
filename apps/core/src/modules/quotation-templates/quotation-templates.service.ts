import type { ListMeta, QuotationTemplateDto, QuotationTemplateListItemDto } from '@brightloop/shared';
import { AppError, forbidden, notFound, validationError } from '../../core/errors.js';
import { isAdmin, isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { rethrowDbError } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import type { PlansGateway } from '../plans/plans.gateway.js';
import type { CatalogGateway } from '../products/products.gateway.js';
import { toListItemDto, toTemplateDto } from './quotation-templates.dto.js';
import type { TemplatesGateway, TemplateWithLines } from './quotation-templates.gateway.js';
import type {
  QuotationTemplatesRepository, TemplateLabels, TemplateLineRow, TemplateLineWrite, TemplateRow,
} from './quotation-templates.repository.js';
import type {
  CreateTemplateInput, ListTemplatesParams, TemplateLineInput, UpdateTemplateInput,
} from './quotation-templates.schema.js';

const TEMPLATE_NOT_FOUND = 'Quotation template not found';
const FK_MESSAGE = 'A plan, product or variant used by this template no longer exists';

export class QuotationTemplatesService implements TemplatesGateway {
  constructor(
    private readonly repository: QuotationTemplatesRepository,
    private readonly audit: AuditGateway,
    private readonly catalog: CatalogGateway,
    private readonly plans: PlansGateway,
  ) {}

  async list(actor: Actor, query: ListTemplatesParams): Promise<{ templates: QuotationTemplateListItemDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    const labels = await this.repository.lookupLabels([...new Set(rows.map((row) => row.planId))], [], []);
    return {
      templates: rows.map((row) => toListItemDto(row, labels.plans.get(row.planId)?.name)),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }

  async get(actor: Actor, id: number): Promise<QuotationTemplateDto> {
    this.assertCanRead(actor);
    const row = await this.requireTemplate(id);
    return this.toDetail(row, await this.repository.listLines(id));
  }

  async create(actor: Actor, input: CreateTemplateInput, ip?: string): Promise<QuotationTemplateDto> {
    this.assertAdmin(actor);
    const lines = toWrites(input.lines);
    await Promise.all([this.assertPlanUsable(input.planId), this.assertLinesUsable(input.lines)]);
    try {
      const created = await this.repository.create(input, lines, actor.userId);
      await this.audit.record({
        actor, action: 'quotationTemplate.create', entityType: 'QuotationTemplate', entityId: created.template.id, ip,
        metadata: {
          name: created.template.name, planId: created.template.planId, validityDays: created.template.validityDays,
          isActive: created.template.isActive, lineCount: created.lines.length,
        },
      });
      return await this.toDetail(created.template, created.lines);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: FK_MESSAGE });
    }
  }

  /** When `lines` is sent it replaces every line, atomically in one repository call. */
  async update(actor: Actor, id: number, patch: UpdateTemplateInput, ip?: string): Promise<QuotationTemplateDto> {
    this.assertAdmin(actor);
    const existing = await this.requireTemplate(id);
    if (patch.planId !== undefined && patch.planId !== existing.planId) await this.assertPlanUsable(patch.planId);
    if (patch.lines !== undefined) await this.assertLinesUsable(patch.lines);

    let row: TemplateRow | null;
    try {
      row = await this.repository.update(id, patch, patch.lines === undefined ? undefined : toWrites(patch.lines));
    } catch (error) {
      return rethrowDbError(error, { foreignKey: FK_MESSAGE });
    }
    if (row === null) throw notFound(TEMPLATE_NOT_FOUND);

    const { lines, ...fields } = patch;
    await this.audit.record({
      actor, action: 'quotationTemplate.update', entityType: 'QuotationTemplate', entityId: id, ip,
      metadata: {
        changes: fields,
        previous: pickPrevious(existing, fields),
        ...(lines === undefined ? {} : { linesReplaced: lines.length }),
      },
    });
    return this.toDetail(row, await this.repository.listLines(id));
  }

  /** Soft delete. Existing subscriptions keep their own copied lines. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    const existing = await this.requireTemplate(id);
    const row = await this.repository.softDelete(id);
    if (row === null) throw notFound(TEMPLATE_NOT_FOUND);
    await this.audit.record({
      actor, action: 'quotationTemplate.delete', entityType: 'QuotationTemplate', entityId: id, ip,
      metadata: { name: existing.name, planId: existing.planId },
    });
  }

  async getWithLines(id: number): Promise<TemplateWithLines | null> {
    const row = await this.repository.findById(id);
    if (row === null) return null;
    const lines = await this.repository.listLines(id);
    return {
      id: row.id, name: row.name, planId: row.planId, validityDays: row.validityDays, notes: row.notes,
      isActive: row.isActive,
      lines: lines.map((line) => ({
        productId: line.productId, variantId: line.variantId, quantity: line.quantity, sortOrder: line.sortOrder,
      })),
    };
  }

  private async toDetail(row: TemplateRow, lines: TemplateLineRow[]): Promise<QuotationTemplateDto> {
    const labels: TemplateLabels = await this.repository.lookupLabels(
      [row.planId],
      [...new Set(lines.map((line) => line.productId))],
      [...new Set(lines.flatMap((line) => (line.variantId === null ? [] : [line.variantId])))],
    );
    return toTemplateDto(row, lines, labels);
  }

  private async assertPlanUsable(planId: number): Promise<void> {
    const plan = await this.plans.getById(planId);
    if (plan === null) throw validationError('Validation failed', [{ field: 'planId', message: 'Plan not found' }]);
    if (!plan.isActive) throw validationError('Validation failed', [{ field: 'planId', message: 'Plan is not active' }]);
  }

  /** Every product and variant must exist, match, and be active. Catalog 404s become field errors. */
  private async assertLinesUsable(lines: readonly TemplateLineInput[]): Promise<void> {
    await Promise.all(lines.map(async (line, index) => {
      const field = `lines.${index}.${line.variantId === undefined || line.variantId === null ? 'productId' : 'variantId'}`;
      try {
        const item = await this.catalog.getPricedItem(line.productId, line.variantId ?? undefined);
        if (!item.isActive) {
          throw validationError('Validation failed', [{ field, message: 'Product or variant is not active' }]);
        }
      } catch (error) {
        if (error instanceof AppError && error.status === 404) {
          throw validationError('Validation failed', [{ field, message: 'Product not found, or the variant does not belong to the product' }]);
        }
        throw error;
      }
    }));
  }

  private async requireTemplate(id: number): Promise<TemplateRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound(TEMPLATE_NOT_FOUND);
    return row;
  }

  private assertCanRead(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

function toWrites(lines: readonly TemplateLineInput[]): TemplateLineWrite[] {
  return lines.map((line, index) => ({
    productId: line.productId, variantId: line.variantId ?? null, quantity: line.quantity, sortOrder: index,
  }));
}

function pickPrevious(existing: TemplateRow, patch: Omit<UpdateTemplateInput, 'lines'>): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) previous[key] = existing[key];
  return previous;
}
