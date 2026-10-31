/**
 * Request-id correlation + child logger (backend-rules.md #9).
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../logger.js';

export const requestContext = (): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    req.id = randomUUID();
    res.setHeader('x-request-id', req.id);
    const child = logger.child({ requestId: req.id });
    const start = Date.now();
    res.on('finish', () => {
      child.info(
        {
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'request completed',
      );
    });
    next();
  };
};
