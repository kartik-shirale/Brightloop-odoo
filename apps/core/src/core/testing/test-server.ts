/**
 * Ephemeral Express listener for HTTP tests. Mount the router under test with
 * the real error handler, then call it with Node `fetch` as a given role.
 */

import '../test-env.js';
import { once } from 'node:events';
import { promisify } from 'node:util';
import type { RoleDto } from '@brightloop/shared';
import express, { type Router } from 'express';
import { errorHandler, notFoundHandler } from '../middlewares/error-handler.js';
import { bearerFor } from './test-auth.js';

export interface TestRequestOptions {
  method?: string;
  body?: unknown;
  /** Send the token of this role. Omit (and leave `token` unset) for an anonymous request. */
  role?: RoleDto;
  /** Raw token, for malformed or foreign-token cases. Wins over `role`. */
  token?: string;
}

export interface TestResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

export interface TestServer {
  baseUrl: string;
  request<T = unknown>(path: string, options?: TestRequestOptions): Promise<TestResponse<T>>;
}

export interface ApiBody {
  success: boolean;
  message: string;
  data?: unknown;
  meta?: { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  error?: { code: string; details?: { field: string; message: string }[] };
}

/**
 * Starts an app on a random port and closes it when the test ends.
 * `mount` receives the `/api/v1` router, for example
 * `(v1) => v1.use('/taxes', createTaxesRouter(deps))`. Paths passed to
 * `request` are relative to `/api/v1`.
 */
export async function startTestServer(
  t: { after(fn: () => Promise<void>): void },
  mount: (v1: Router) => void,
): Promise<TestServer> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const v1 = express.Router();
  mount(v1);
  app.use('/api/v1', v1);
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await promisify(server.close.bind(server))();
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Test server has no TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async request<T>(path: string, options: TestRequestOptions = {}): Promise<TestResponse<T>> {
      const authorization = options.token !== undefined
        ? `Bearer ${options.token}`
        : options.role !== undefined ? bearerFor(options.role) : undefined;
      const response = await fetch(`${baseUrl}/api/v1${path}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(authorization === undefined ? {} : { authorization }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        body: (text.length > 0 ? JSON.parse(text) : undefined) as T,
      };
    },
  };
}
