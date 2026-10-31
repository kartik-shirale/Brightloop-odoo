import type { RequestHandler, Response } from 'express';
import type { ZodType, output } from 'zod';
import { validationError } from '../errors.js';

type InputSource = 'body' | 'query' | 'params';
function validate(source: InputSource, schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(validationError('Validation failed', result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.'), message: issue.message,
      }))));
      return;
    }
    // Express 5 exposes req.query through a getter. Store parsed input separately.
    res.locals.validated ??= {};
    res.locals.validated[source] = result.data;
    next();
  };
}
export const validateBody = (schema: ZodType): RequestHandler => validate('body', schema);
export const validateQuery = (schema: ZodType): RequestHandler => validate('query', schema);
export const validateParams = (schema: ZodType): RequestHandler => validate('params', schema);

/** Read only after the matching validation middleware succeeds. */
export function validated<T extends ZodType>(res: Response, source: InputSource, schema: T): output<T> {
  void schema;
  return res.locals.validated[source] as output<T>;
}
