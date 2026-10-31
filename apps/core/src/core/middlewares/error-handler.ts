/**
 * Global error handler + 404 fallback (backend-rules.md #5).
 * Everything exits through the standard failure envelope.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { sha256 } from '../utils/hash.js';

/** 404 for unknown API routes, same envelope shape. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    error: { code: 'NOT_FOUND' },
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) { _next(error); return; }
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, requestId: req.id }, error.message);
    } else {
      logger.debug({ code: error.code, requestId: req.id }, error.message);
    }
    const body: Record<string, unknown> = {
      success: false,
      message: error.message,
      error: { code: error.code, ...(error.details !== undefined ? { details: error.details } : {}) },
    };
    if (error.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    res.status(error.status).json(body);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (kind === 'entity.parse.failed' || kind === 'entity.too.large') {
    res.status(kind === 'entity.too.large' ? 413 : 400).json({ success: false,
      message: kind === 'entity.too.large' ? 'Request body too large' : 'Malformed JSON body',
      error: { code: 'VALIDATION_ERROR' } });
    return;
  }
  const mapped = code === 'P2002' || code === '23505' ? 409 :
    code === 'P2025' ? 404 : code === 'P2003' || code === '23503' ? 400 : undefined;
  if (mapped) {
    res.status(mapped).json({ success: false, message: mapped === 409 ? 'Resource already exists' :
      mapped === 404 ? 'Resource not found' : 'Invalid reference',
      error: { code: mapped === 409 ? 'CONFLICT' : mapped === 404 ? 'NOT_FOUND' : 'BAD_REQUEST' } });
    return;
  }

  // Unknown failure: log with a stable fingerprint, hide internals from clients.
  const fingerprint = sha256(message).slice(0, 12);
  logger.error({ err: error, fingerprint, requestId: req.id }, 'unhandled error');
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: { code: 'INTERNAL_ERROR', details: { fingerprint } },
  });
};
