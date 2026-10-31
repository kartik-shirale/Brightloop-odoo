import type { IsoDateTime, ListQuery } from './common.js';
import type { PlanRefDto } from './plans.js';
export interface QuotationTemplateLineInput {
  productId: number;
  variantId?: number | null;
  quantity: number;
  sortOrder?: number;
}
export interface QuotationTemplateLineDto {
  id: number;
  templateId: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  sortOrder: number;
}
export interface QuotationTemplateListItemDto {
  id: number;
  name: string;
  planId: number;
  planName: string;
  validityDays: number;
  notes: string | null;
  isActive: boolean;
  createdById: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export interface QuotationTemplateDto extends QuotationTemplateListItemDto {
  plan: PlanRefDto;
  lines: QuotationTemplateLineDto[];
}
export interface CreateQuotationTemplateRequest {
  name: string;
  planId: number;
  validityDays: number;
  notes?: string | null;
  isActive?: boolean;
  lines: QuotationTemplateLineInput[];
}
export interface UpdateQuotationTemplateRequest {
  name?: string;
  planId?: number;
  validityDays?: number;
  notes?: string | null;
  isActive?: boolean;
  /** Replaces the complete line set when supplied. */
  lines?: QuotationTemplateLineInput[];
}
export interface ListQuotationTemplatesQuery extends ListQuery<'name' | 'validityDays' | 'createdAt'> {
  planId?: number;
  isActive?: boolean;
}
