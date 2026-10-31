import type { Paise } from '@brightloop/shared';

/** What subscriptions and templates copy into a line snapshot. */
export interface PricedItem {
  productId: number;
  variantId: number | null;
  /** Line description, for example `Odoo ERP (Brand: Odoo)`. */
  name: string;
  /** Product sales price plus the variant extra price, in paise. */
  unitPrice: Paise;
  /** False when the product or the variant is inactive. Inactive items cannot be added to new lines. */
  isActive: boolean;
}

export interface CatalogGateway {
  /**
   * Throws 404 when the product is missing or soft-deleted, and 404 when the
   * variant does not exist or belongs to another product.
   */
  getPricedItem(productId: number, variantId?: number): Promise<PricedItem>;
}
