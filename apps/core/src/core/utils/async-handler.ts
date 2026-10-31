/**
 * Wraps async route handlers so rejections reach the global error handler
 * (backend-rules.md #4). Sync-thrown values inside async handlers are static.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
