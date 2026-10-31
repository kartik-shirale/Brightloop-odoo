/**
 * List-endpoint contract (backend plan 3.2): bounded pagination, whitelisted
 * sort, trimmed search, comma enum filters, strict unknown-key rejection.
 * Offsets and meta come from the existing `pagination.ts` helpers.
 */

import { z } from 'zod';
import { parseDateInput } from './dates.js';
import { MAX_PAGE_SIZE } from './pagination.js';

export const DEFAULT_PAGE_SIZE = 10;

const pageField = z.coerce.number().int().min(1).default(1);
const limitField = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);
const searchField = z.string().trim().min(1).max(100).optional();
const sortOrderField = z.enum(['asc', 'desc']).default('desc');

/** Splits `a,b,c`, trims, drops empties and duplicates. */
export function splitComma(value: string): string[] {
  return [...new Set(value.split(',').map((part) => part.trim()).filter((part) => part.length > 0))];
}

/** `status=ACTIVE,PAUSED` into a validated, de-duplicated array. A single value works too. */
export function commaEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.string().transform((raw, ctx): T[number][] => {
    const parts = splitComma(raw);
    if (parts.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Expected at least one value' });
      return z.NEVER;
    }
    const allowed = new Set<string>(values);
    const invalid = parts.filter((part) => !allowed.has(part));
    if (invalid.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Invalid value(s): ${invalid.join(', ')}. Allowed: ${values.join(', ')}` });
      return z.NEVER;
    }
    return parts as T[number][];
  });
}

/** `include=variants,lines` limited to a whitelist. */
export const includeList = commaEnum;

/** Accepts only the literal strings `true` and `false`. */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Positive integer, for ids and counts passed in the query string. */
export const queryPositiveInt = z.coerce.number().int().min(1);

/** Integer at least zero, for money filters in paise. */
export const queryPaise = z.coerce.number().int().min(0);

/**
 * ISO 8601 date or instant. A date-only `to` filter means the end of that day,
 * so range filters are inclusive.
 */
export function queryDate(bound: 'from' | 'to' = 'from') {
  return z.string().transform((raw, ctx): Date => {
    const parsed = parseDateInput(raw, { endOfDay: bound === 'to' });
    if (parsed === null) {
      ctx.addIssue({ code: 'custom', message: 'Expected an ISO 8601 date (YYYY-MM-DD) or date-time' });
      return z.NEVER;
    }
    return parsed;
  });
}

/** Path parameter `:id` (or any named id): a positive integer. */
export const idParam = z.coerce.number().int().min(1);
export const idParamsSchema = z.strictObject({ id: idParam });

type FilterShape = Record<string, z.ZodType>;

export interface ListQueryOptions<
  S extends readonly [string, ...string[]],
  F extends FilterShape,
> {
  /** Whitelisted sort keys. `id` is always appended as a tie-breaker by the repository. */
  sortable: S;
  defaultSort: S[number];
  /** Endpoint filters built from `commaEnum`, `queryBoolean`, `queryDate`, `queryPaise`. Each is made optional here. */
  filters?: F;
}

/**
 * Builds the strict Zod schema for a GET list. Unknown keys fail with a 400
 * VALIDATION_ERROR through the existing validation middleware. `search` is
 * always present; a list without search fields calls `.omit({ search: true })`.
 */
export function buildListQuerySchema<
  const S extends readonly [string, ...string[]],
  F extends FilterShape = Record<never, never>,
>(options: ListQueryOptions<S, F>) {
  const base = {
    page: pageField,
    limit: limitField,
    sortBy: z.enum(options.sortable).default(options.defaultSort),
    sortOrder: sortOrderField,
    search: searchField,
  };
  const filters = Object.fromEntries(
    Object.entries(options.filters ?? {}).map(([key, schema]) => [key, schema.optional()]),
  ) as OptionalShape<F>;
  return z.strictObject({ ...base, ...filters });
}

type OptionalShape<F extends FilterShape> = {
  [K in keyof F]: z.ZodOptional<F[K]>;
};
