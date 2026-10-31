/**
 * Response-envelope helpers (backend-rules.md #3).
 *
 *   success → { success: true, message, data?, meta? }
 *   failure → handled by the global error handler with
 *             { success: false, message, error: { code, details? } }
 */

import type { Response } from 'express';
import type { ListMeta } from '@brightloop/shared';

export function respond<T>(
  res: Response,
  status: number,
  message: string,
  data?: T,
  meta?: ListMeta,
): void {
  const body: Record<string, unknown> = { success: true, message };
  if (data !== undefined) {
    body.data = data;
  }
  if (meta !== undefined) {
    body.meta = meta;
  }
  res.status(status).json(body);
}

export const respondOk = <T>(
  res: Response,
  message: string,
  data?: T,
  meta?: ListMeta,
): void => respond(res, 200, message, data ?? undefined, meta);

export const respondCreated = <T>(res: Response, message: string, data?: T): void =>
  respond(res, 201, message, data ?? undefined);
