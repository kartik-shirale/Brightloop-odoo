/**
 * The only place money and rate arithmetic is defined (backend plan 3.4).
 * Money is integer paise, rates are basis points (18% = 1800). No floats are
 * ever stored; every function here takes and returns safe integers.
 */

import type { BasisPoints, Paise } from '@brightloop/shared';
import { BillingPeriod, TaxType } from '@brightloop/shared';

const BPS_DENOMINATOR = 10000;

export function assertInteger(value: number, label = 'value'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

/** Rounded share of `amount` for a rate in basis points. Round per line, then sum. */
export function bpsOf(amount: Paise, bps: BasisPoints): Paise {
  assertInteger(amount, 'amount');
  assertInteger(bps, 'bps');
  return Math.round((amount * bps) / BPS_DENOMINATOR);
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const value of values) {
    assertInteger(value, 'amount');
    total += value;
  }
  return total;
}

/** `quantity * unitPrice`, the pre-discount, pre-tax line amount. */
export function lineAmount(quantity: number, unitPrice: Paise): Paise {
  assertInteger(quantity, 'quantity');
  assertInteger(unitPrice, 'unitPrice');
  return quantity * unitPrice;
}

/**
 * Tax on an already-discounted line amount. PERCENTAGE uses basis points of the
 * amount; FIXED is paise per unit.
 */
export function taxOnLine(
  type: TaxType,
  rate: BasisPoints | Paise,
  discountedAmount: Paise,
  quantity: number,
): Paise {
  if (type === TaxType.FIXED) {
    assertInteger(rate, 'rate');
    assertInteger(quantity, 'quantity');
    return rate * quantity;
  }
  return bpsOf(discountedAmount, rate);
}

/** A discount never exceeds its base. PERCENTAGE is bps of the base, FIXED is paise per application. */
export function discountAmount(
  type: 'PERCENTAGE' | 'FIXED',
  value: BasisPoints | Paise,
  base: Paise,
): Paise {
  const raw = type === 'PERCENTAGE' ? bpsOf(base, value) : value;
  return Math.max(0, Math.min(raw, base));
}

/**
 * Splits `total` across `weights` proportionally. Each share is rounded down and
 * the last entry absorbs the remainder, so the shares always sum to `total`.
 */
export function allocateProportionally(total: Paise, weights: readonly Paise[]): Paise[] {
  assertInteger(total, 'total');
  if (weights.length === 0) return [];
  const weightSum = sumPaise(weights);
  if (weightSum <= 0) {
    return weights.map((_, index) => (index === weights.length - 1 ? total : 0));
  }
  const shares: Paise[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length - 1; index += 1) {
    const share = Math.floor((total * weights[index]!) / weightSum);
    shares.push(share);
    allocated += share;
  }
  shares.push(total - allocated);
  return shares;
}

/** Recurring amount normalised to one month, integer paise (DAILY x30, WEEKLY x52/12, YEARLY /12). */
export function monthlyEquivalent(amount: Paise, period: BillingPeriod): Paise {
  assertInteger(amount, 'amount');
  switch (period) {
    case BillingPeriod.DAILY:
      return amount * 30;
    case BillingPeriod.WEEKLY:
      return Math.round((amount * 52) / 12);
    case BillingPeriod.MONTHLY:
      return amount;
    case BillingPeriod.YEARLY:
      return Math.round(amount / 12);
  }
}
