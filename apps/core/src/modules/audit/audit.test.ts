import '../../core/test-env.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { promisify } from 'node:util';
import { Role, type RoleDto } from '@brightloop/shared';
import express from 'express';
import { unauthorized } from '../../core/errors.js';
import { errorHandler } from '../../core/middlewares/error-handler.js';
import type { AuthenticatedUser } from '../../core/types/express.js';
import type { Actor } from '../../core/utils/actor.js';
import type { AuthService } from '../auth/auth.service.js';
import { AuditRepository, type AuditLogInsert, type AuditLogRow } from './audit.repository.js';
import { createAuditRouter } from './audit.routes.js';
import type { ListAuditLogsParams } from './audit.schema.js';
import { AuditService, redactMetadata } from './audit.service.js';

class FakeAuditRepository extends AuditRepository {
  inserted: AuditLogInsert[] = [];
  lastQuery: ListAuditLogsParams | undefined;
  failInsert = false;
  rows: AuditLogRow[] = [];

  override async insert(entry: AuditLogInsert): Promise<void> {
    if (this.failInsert) throw new Error('db down');
    this.inserted.push(entry);
  }
  override async list(query: ListAuditLogsParams): Promise<AuditLogRow[]> {
    this.lastQuery = query;
    return this.rows.slice((query.page - 1) * query.limit, query.page * query.limit);
  }
  override async count(): Promise<number> {
    return this.rows.length;
  }
  override async findUserNames(): Promise<Map<number, string>> {
    return new Map([[1, 'Ada Admin']]);
  }
}

const users: Record<string, AuthenticatedUser> = {
  admin: { id: 1, email: 'a@x.test', name: 'Ada Admin', role: Role.ADMIN, sid: 1 },
  staff: { id: 2, email: 's@x.test', name: 'Sam Staff', role: Role.STAFF, sid: 2 },
  customer: { id: 3, email: 'c@x.test', name: 'Cy Customer', role: Role.CUSTOMER, sid: 3 },
};

const fakeAuth = {
  async authenticate(token: string): Promise<AuthenticatedUser> {
    const user = users[token];
    if (!user) throw unauthorized('AUTH_REQUIRED', 'Invalid token');
    return user;
  },
} as unknown as AuthService;

function actor(role: RoleDto): Actor {
  return { userId: 9, role };
}

function sampleRow(id: number): AuditLogRow {
  return {
    id, userId: 1, action: 'invoice.confirm', entityType: 'Invoice', entityId: id,
    metadata: { ok: true }, ip: null, createdAt: '2026-10-31T00:00:00.000Z',
  };
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const repository = new FakeAuditRepository();
  const auditService = new AuditService(repository);
  const app = express();
  app.use('/api/v1/audit-logs', createAuditRouter({ authService: fakeAuth, auditService }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await promisify(server.close.bind(server))(); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const get = (query = '', token?: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${address.port}/api/v1/audit-logs${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return { repository, auditService, get };
}

test('redactMetadata masks credential-like keys at any depth and keeps other values', () => {
  const result = redactMetadata({
    name: 'x', password: 'p', nested: { refreshToken: 't', otp: '123456', amount: 500 },
    list: [{ apiKey: 'k', ok: true }], when: new Date('2026-01-01T00:00:00Z'), skip: undefined,
  });
  assert.deepEqual(result, {
    name: 'x', password: '[REDACTED]', nested: { refreshToken: '[REDACTED]', otp: '[REDACTED]', amount: 500 },
    list: [{ apiKey: '[REDACTED]', ok: true }], when: '2026-01-01T00:00:00.000Z',
  });
});

test('record stores the actor, null for system work, and never throws on failure', async (t) => {
  const { repository, auditService } = await fixture(t);
  await auditService.record({ actor: actor(Role.STAFF), action: 'invoice.confirm', entityType: 'Invoice', entityId: 5, metadata: { token: 'secret' } });
  await auditService.record({ actor: null, action: 'billing.run', entityType: 'BillingRun' });
  assert.equal(repository.inserted[0]?.userId, 9);
  assert.deepEqual(repository.inserted[0]?.metadata, { token: '[REDACTED]' });
  assert.equal(repository.inserted[1]?.userId, null);
  assert.equal(repository.inserted[1]?.metadata, null);
  repository.failInsert = true;
  await assert.doesNotReject(auditService.record({ actor: null, action: 'x', entityType: 'Y' }));
});

test('service list rejects non-admin actors', async (t) => {
  const { auditService } = await fixture(t);
  const query = { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' } as const;
  await assert.rejects(auditService.list(actor(Role.STAFF), query), { status: 403 });
});

test('RBAC matrix: 401 without token, 403 for STAFF and CUSTOMER, 200 for ADMIN', async (t) => {
  const { get } = await fixture(t);
  assert.equal((await get()).status, 401);
  assert.equal((await get('', 'bogus')).status, 401);
  assert.equal((await get('', 'staff')).status, 403);
  assert.equal((await get('', 'customer')).status, 403);
  assert.equal((await get('', 'admin')).status, 200);
});

test('list returns data with user names and pagination meta, and an empty page past the end', async (t) => {
  const { repository, get } = await fixture(t);
  repository.rows = [sampleRow(3), sampleRow(2), sampleRow(1)];
  const first = await (await get('?limit=2', 'admin')).json() as { data: { userName: string }[]; meta: Record<string, unknown> };
  assert.equal(first.data.length, 2);
  assert.equal(first.data[0]?.userName, 'Ada Admin');
  assert.deepEqual(first.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  const past = await (await get('?limit=2&page=9', 'admin')).json() as { data: unknown[]; meta: { hasNext: boolean } };
  assert.equal(past.data.length, 0);
  assert.equal(past.meta.hasNext, false);
});

test('query validation: limit 101, bad sortBy, unknown key and bad filters give 400', async (t) => {
  const { get } = await fixture(t);
  for (const query of ['?limit=101', '?sortBy=action', '?bogus=1', '?userId=0', '?createdFrom=nope', '?search=']) {
    const response = await get(query, 'admin');
    assert.equal(response.status, 400, query);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  }
});

test('filters are parsed and a date-only createdTo means the end of that day', async (t) => {
  const { repository, get } = await fixture(t);
  const response = await get('?search=INV&userId=1&entityType=Invoice&entityId=4&createdFrom=2026-10-01&createdTo=2026-10-31&sortOrder=asc', 'admin');
  assert.equal(response.status, 200);
  const query = repository.lastQuery;
  assert.equal(query?.search, 'INV');
  assert.equal(query?.userId, 1);
  assert.equal(query?.entityId, 4);
  assert.equal(query?.sortOrder, 'asc');
  assert.equal(query?.createdFrom?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(query?.createdTo?.toISOString(), '2026-10-31T23:59:59.999Z');
});
