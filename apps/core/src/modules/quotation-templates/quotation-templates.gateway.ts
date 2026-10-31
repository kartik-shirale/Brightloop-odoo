export interface TemplateLineRecord {
  productId: number;
  variantId: number | null;
  quantity: number;
  sortOrder: number;
}

export interface TemplateWithLines {
  id: number;
  name: string;
  planId: number;
  validityDays: number;
  notes: string | null;
  isActive: boolean;
  /** Ordered by sortOrder, then id. */
  lines: TemplateLineRecord[];
}

export interface TemplatesGateway {
  /** Returns null when the template is missing or soft-deleted. Callers check `isActive`. */
  getWithLines(id: number): Promise<TemplateWithLines | null>;
}
