/**
 * RBAC matrix generated from a route table (backend plan section 9). Per route:
 * no token gives 401, every disallowed role gives 403, every allowed role gets
 * anything except 401 or 403 (a 2xx or the expected business error).
 */

import assert from 'node:assert/strict';
import type { RoleDto } from '@brightloop/shared';
import { ALL_ROLES } from './test-auth.js';
import type { TestServer } from './test-server.js';

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Relative to `/api/v1`, with real-looking ids, for example `/taxes/1`. */
  path: string;
  allowed: readonly RoleDto[];
  /** Body for write routes. Roles are checked before validation, so it may be minimal. */
  body?: unknown;
  /** When set, allowed roles must receive exactly this status. */
  expectedAllowedStatus?: number;
}

export async function assertRbacMatrix(server: TestServer, routes: readonly RouteSpec[]): Promise<void> {
  const failures: string[] = [];
  for (const route of routes) {
    const label = `${route.method} ${route.path}`;
    const send = (role?: RoleDto) => server.request(route.path, {
      method: route.method,
      ...(route.body === undefined ? {} : { body: route.body }),
      ...(role === undefined ? {} : { role }),
    });

    const anonymous = await send();
    if (anonymous.status !== 401) failures.push(`${label}: no token expected 401, got ${anonymous.status}`);

    for (const role of ALL_ROLES) {
      const { status } = await send(role);
      if (route.allowed.includes(role)) {
        if (status === 401 || status === 403) failures.push(`${label}: ${role} should be allowed, got ${status}`);
        if (route.expectedAllowedStatus !== undefined && status !== route.expectedAllowedStatus) {
          failures.push(`${label}: ${role} expected ${route.expectedAllowedStatus}, got ${status}`);
        }
      } else if (status !== 403) {
        failures.push(`${label}: ${role} should be forbidden, got ${status}`);
      }
    }
  }
  assert.deepEqual(failures, [], `RBAC matrix failures:\n${failures.join('\n')}`);
}
