import type { QuotationTemplateDto, QuotationTemplateLineDto, QuotationTemplateListItemDto } from '@brightloop/shared';
import type { TemplateLabels, TemplateLineRow, TemplateRow } from './quotation-templates.repository.js';

const UNKNOWN_LABEL = 'Unknown';

export function toListItemDto(row: TemplateRow, planName: string | undefined): QuotationTemplateListItemDto {
  return {
    id: row.id,
    name: row.name,
    planId: row.planId,
    planName: planName ?? UNKNOWN_LABEL,
    validityDays: row.validityDays,
    notes: row.notes,
    isActive: row.isActive,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toLineDto(line: TemplateLineRow, labels: TemplateLabels): QuotationTemplateLineDto {
  return {
    id: line.id,
    templateId: line.templateId,
    productId: line.productId,
    productName: labels.products.get(line.productId) ?? UNKNOWN_LABEL,
    variantId: line.variantId,
    variantLabel: line.variantId === null ? null : labels.variants.get(line.variantId) ?? UNKNOWN_LABEL,
    quantity: line.quantity,
    sortOrder: line.sortOrder,
  };
}

export function toTemplateDto(row: TemplateRow, lines: TemplateLineRow[], labels: TemplateLabels): QuotationTemplateDto {
  const plan = labels.plans.get(row.planId);
  return {
    ...toListItemDto(row, plan?.name),
    plan: { id: row.planId, name: plan?.name ?? UNKNOWN_LABEL, billingPeriod: plan?.billingPeriod ?? 'MONTHLY' },
    lines: lines.map((line) => toLineDto(line, labels)),
  };
}
