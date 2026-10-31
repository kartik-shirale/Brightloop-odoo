import { test, expect } from '@playwright/test';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ApiListSuccess, ApiSuccess, ListProductsQuery, PaginationMeta } from '@brightloop/shared';
import type { UseFormSetError } from 'react-hook-form';
import { serializeQuery, unwrap, unwrapList } from '../src/api/utils';
import { applyServerErrors } from '../src/lib/apply-server-errors';
import { applyFieldErrors, getErrorMessage, isApiFailure, normalizeApiError } from '../src/lib/errors';
import { DOMAIN_ERROR_MESSAGES, MESSAGES } from '../src/constants/messages';

const meta: PaginationMeta = { page: 1, limit: 10, total: 0, totalPages: 0, hasNext: false, hasPrev: false };

function serverError(data: unknown, status = 400, retryAfter?: string): AxiosError<unknown> {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, {
    data, status, statusText: 'Failure', config,
    headers: new AxiosHeaders(retryAfter === undefined ? {} : { 'retry-after': retryAfter }),
  });
}

test('query serialization follows shared queries and preserves false and zero', () => {
  const query: ListProductsQuery = { page: 1, limit: 10, search: '  plan & service  ',
    type: ['SERVICE', 'SOFTWARE'], isActive: false, minPrice: 0, include: ['variants'] };
  const params = serializeQuery(query);
  expect(Object.fromEntries(params)).toEqual({ page: '1', limit: '10', search: 'plan & service',
    type: 'SERVICE,SOFTWARE', isActive: 'false', minPrice: '0', include: 'variants' });
  expect(new URLSearchParams(params.toString()).get('search')).toBe('plan & service');
  expect(query.search).toBe('  plan & service  ');
});

test('query serialization omits empty values and joins readonly arrays', () => {
  expect(Object.fromEntries(serializeQuery({ missing: undefined, cleared: null, empty: '', spaces: '  ',
    array: [], values: ['ACTIVE', '', null, undefined, 'PAUSED'] as const,
    dates: ['2026-11-05'], enabled: true }))).toEqual({ values: 'ACTIVE,PAUSED', dates: '2026-11-05', enabled: 'true' });
});

test('envelope utilities preserve payloads and list metadata', () => {
  for (const data of [0, false, '', null]) expect(unwrap({ success: true, message: 'OK', data })).toBe(data);
  const envelope: ApiListSuccess<{ id: number }> = { success: true, message: 'OK', data: [], meta };
  const result = unwrapList(envelope);
  expect(result).toEqual({ data: [], meta });
  expect(result.data).toBe(envelope.data);
  expect(result.meta).toBe(meta);
});

test('incomplete success envelopes throw instead of returning invalid data', () => {
  expect(() => unwrap({ success: true, message: 'OK' } as ApiSuccess<unknown>)).toThrow();
  expect(() => unwrapList({ success: true, message: 'OK', data: [] } as unknown as ApiListSuccess<unknown>)).toThrow();
  expect(() => unwrapList({ success: true, message: 'OK', data: null, meta } as unknown as ApiListSuccess<unknown>)).toThrow();
});

test('normalization preserves HTTP status, domain code, and valid field details', () => {
  const error = serverError({ success: false, message: 'Invalid quantity', error: { code: 'VALIDATION_ERROR',
    details: [{ field: 'lines.0.quantity', message: 'Use at least one' }, null, { field: 1, message: 'Invalid' }] } });
  const normalized = normalizeApiError(error);
  expect(normalized).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid quantity',
    details: [{ field: 'lines.0.quantity', message: 'Use at least one' }] });
  expect(isApiFailure(normalized)).toBe(true);
  expect(normalizeApiError(normalized)).toBe(normalized);
});

test('every domain code has the same message for raw and normalized errors', () => {
  for (const [code, message] of Object.entries(DOMAIN_ERROR_MESSAGES)) {
    const error = serverError({ success: false, message: 'Backend message', error: { code } });
    expect(getErrorMessage(error)).toBe(message);
    expect(getErrorMessage(normalizeApiError(error))).toBe(message);
  }
});

test('auth messages, network errors, rate limits, and diagnostics stay safe', () => {
  expect(getErrorMessage(serverError({ message: 'Invalid or expired code', error: { code: 'BAD_REQUEST' } })))
    .toBe('Invalid or expired code');
  expect(getErrorMessage(new AxiosError('Connection refused', 'ERR_NETWORK'))).toBe(MESSAGES.NETWORK);
  const limited = normalizeApiError(serverError({}, 429, '30'));
  expect(limited).toMatchObject({ status: 429, message: MESSAGES.RETRY, retryAfter: 30 });
  expect(normalizeApiError(serverError({}, 429, '-1')).retryAfter).toBeUndefined();
  expect(normalizeApiError(serverError({ message: 'Internal stack trace', error: {
    code: 'INTERNAL_ERROR', details: { fingerprint: 'private' } } }, 500)))
    .toMatchObject({ status: 500, message: MESSAGES.ERROR, details: [] });
  expect(normalizeApiError(serverError({ message: 'Email unavailable', error: { code: 'EMAIL_DELIVERY_FAILED' } }, 503)).message)
    .toBe('Email unavailable');
});

test('unknown or malformed errors cannot break the error display', () => {
  for (const value of [null, undefined, 'failure', new Error('private'), { status: 400, message: 'Invalid', details: 'bad' }]) {
    expect(isApiFailure(value)).toBe(false);
    expect(getErrorMessage(value)).toBe(MESSAGES.ERROR);
  }
  for (const body of [null, 'not JSON', { message: {}, error: 'bad' }]) {
    expect(getErrorMessage(serverError(body))).toBe(MESSAGES.ERROR);
  }
  expect(typeof getErrorMessage(serverError({ error: { code: '__proto__' } }))).toBe('string');
});

test('server details reach nested fields and form-level errors through both APIs', () => {
  interface Values { name: string; lines: { quantity: number }[] }
  const calls: { field: string; message: string | undefined; type: string | undefined }[] = [];
  const setError: UseFormSetError<Values> = (field, error) => {
    calls.push({ field, message: error.message, type: error.type });
  };
  const details = [{ field: 'lines.0.quantity', message: 'Too small' }, { field: '', message: 'Check this form' }];
  applyServerErrors(details, setError);
  expect(calls).toEqual([{ field: 'lines.0.quantity', message: 'Too small', type: 'server' },
    { field: 'root.server', message: 'Check this form', type: 'server' }]);
  calls.length = 0;
  applyFieldErrors(serverError({ message: 'Invalid', error: { code: 'VALIDATION_ERROR', details } }), setError);
  expect(calls).toHaveLength(2);
  calls.length = 0;
  applyFieldErrors(new Error('Unknown'), setError);
  expect(calls).toEqual([]);
});
