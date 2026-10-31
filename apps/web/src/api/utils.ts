import type { ApiListSuccess, ApiSuccess } from '@brightloop/shared';
import { MESSAGES } from '@/constants/messages';
import type { ListResult, QueryScalar, QueryValue } from '@/types/api';

function serializeValue(value: QueryScalar): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

export function serializeQuery<T extends object>(query: T & Record<keyof T, QueryValue>): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(query) as (keyof T & string)[]) {
    const value = query[key];
    const serialized = Array.isArray(value)
      ? value.map((item: QueryScalar) => serializeValue(item)).filter((item) => item !== undefined).join(',')
      : serializeValue(value as QueryScalar);
    if (serialized !== undefined && serialized !== '') params.set(key, serialized);
  }
  return params;
}

export function unwrap<T>(envelope: ApiSuccess<T>): T {
  if (envelope.success !== true || envelope.data === undefined) throw new Error(MESSAGES.ERROR);
  return envelope.data;
}

export function unwrapList<T>(envelope: ApiListSuccess<T>): ListResult<T> {
  const data = unwrap(envelope);
  if (!Array.isArray(data) || envelope.meta === undefined) throw new Error(MESSAGES.ERROR);
  return { data, meta: envelope.meta };
}
