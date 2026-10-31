import '../../core/test-env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Role } from '@brightloop/shared';
import { MemoryKvStore } from '../../config/redis.js';
import { FakeAuthService, actorFor } from '../../core/testing/test-auth.js';
import { RecordingAudit, fakeRepository, paginateRows } from '../../core/testing/fakes.js';
import { assertRbacMatrix } from '../../core/testing/rbac-matrix.js';
import { startTestServer, type ApiBody } from '../../core/testing/test-server.js';
import type { SessionRow, UserRow } from '../../core/types/db-rows.js';
import { hashPassword, verifyPassword } from '../../core/utils/hash.js';
import { signAccessToken } from '../../core/utils/tokens.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { AuthService } from '../auth/auth.service.js';
import { OtpService } from '../auth/otp.service.js';
import { createStaffRouter } from './staff.routes.js';
import type { StaffRepository } from './staff.repository.js';
import { StaffService } from './staff.service.js';

const NOW = '2026-10-31T00:00:00.000Z';
const PASSWORD = 'Password123!';
const sqlError = (sqlState: string): Error => Object.assign(new Error('db'), { name: 'SqlQueryError', sqlState });

function userRow(id: number, role: UserRow['role'], extra: Partial<UserRow> = {}): UserRow {
  return {
    id, name: `User ${id}`, username: null, email: `user${id}@test.brightloop`, passwordHash: 'hash', role,
    isActive: true, emailVerifiedAt: NOW, passwordChangedAt: null, lastLoginAt: null, deletedAt: null,
    createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

interface Setup {
  users: UserRow[];
  sessions: SessionRow[];
  audit: RecordingAudit;
  service: StaffService;
  transactions: string[];
  lastList: { search?: string; isActive?: boolean; sortBy: string; limit: number }[];
  failNext: { create?: Error; update?: Error };
}

/** Users 1..3 are the harness ADMIN, STAFF and CUSTOMER; users 4 and 5 are staff members. */
function setup(): Setup {
  const users = [
    userRow(1, 'ADMIN'), userRow(2, 'STAFF'), userRow(3, 'CUSTOMER'),
    userRow(4, 'STAFF', { username: 'sam' }), userRow(5, 'STAFF'),
  ];
  const sessions: SessionRow[] = [4, 4, 5].map((userId, index) => ({
    id: 100 + index, userId, currentTokenHash: `h${index}`, userAgent: null, ip: null,
    expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, lastUsedAt: null, createdAt: NOW,
  }));
  const audit = new RecordingAudit();
  const transactions: string[] = [];
  const lastList: Setup['lastList'] = [];
  const failNext: Setup['failNext'] = {};
  const visible = (id: number): UserRow | undefined => users.find((u) => u.id === id && u.role === 'STAFF' && u.deletedAt === null);
  const revoke = (userId: number): void => {
    for (const s of sessions.filter((x) => x.userId === userId && x.revokedAt === null)) s.revokedAt = NOW;
  };
  const repository = fakeRepository<StaffRepository>({
    async list(query) {
      lastList.push({ search: query.search, isActive: query.isActive, sortBy: query.sortBy, limit: query.limit });
      return paginateRows(users.filter((u) => u.role === 'STAFF' && u.deletedAt === null), query.page, query.limit).data;
    },
    async count() { return users.filter((u) => u.role === 'STAFF' && u.deletedAt === null).length; },
    async findStaffById(id) { return visible(id) ?? null; },
    async findByEmail(email) { return users.find((u) => u.email === email) ?? null; },
    async findByUsername(username) { return users.find((u) => u.username === username) ?? null; },
    async create(data) {
      if (failNext.create) throw failNext.create;
      const row = userRow(users.length + 1, 'STAFF', { ...data, emailVerifiedAt: NOW });
      users.push(row);
      return row;
    },
    async update(id, patch) {
      if (failNext.update) throw failNext.update;
      const row = visible(id);
      if (row === undefined) return null;
      Object.assign(row, patch);
      return row;
    },
    async activate(id) {
      const row = visible(id);
      if (row === undefined) return null;
      row.isActive = true;
      return row;
    },
    async deactivate(id) {
      const row = visible(id);
      if (row === undefined) return null;
      transactions.push(`deactivate:${id}`);
      row.isActive = false;
      revoke(id);
      return row;
    },
    async softDelete(id) {
      const row = visible(id);
      if (row === undefined) return null;
      transactions.push(`delete:${id}`);
      row.deletedAt = NOW;
      row.isActive = false;
      revoke(id);
      return row;
    },
  });
  return { users, sessions, audit, transactions, lastList, failNext, service: new StaffService(repository, audit) };
}

async function server(t: { after(fn: () => Promise<void>): void }, s: Setup) {
  const auth = new FakeAuthService();
  return startTestServer(t, (v1) => v1.use('/staff', createStaffRouter({
    authService: auth.asAuthService(), staffService: s.service,
  })));
}

const newStaff = { name: 'New Staff', email: 'new@example.com', username: 'newbie', password: PASSWORD };
type StaffBody = ApiBody & { data: { id: number; role: string; isActive: boolean; emailVerifiedAt: string | null } };

test('RBAC matrix: only ADMIN may use any staff route, STAFF and CUSTOMER get 403, anonymous 401', async (t) => {
  const s = setup();
  await assertRbacMatrix(await server(t, s), [
    { method: 'GET', path: '/staff', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
    { method: 'GET', path: '/staff/4', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/staff', allowed: [Role.ADMIN], body: newStaff, expectedAllowedStatus: 201 },
    { method: 'PATCH', path: '/staff/4', allowed: [Role.ADMIN], body: { name: 'Renamed' }, expectedAllowedStatus: 200 },
    { method: 'POST', path: '/staff/4/deactivate', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
    { method: 'POST', path: '/staff/4/activate', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
    { method: 'DELETE', path: '/staff/5', allowed: [Role.ADMIN], expectedAllowedStatus: 200 },
  ]);
});

test('create forces role STAFF, verifies the email, hashes the password and never returns it', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const response = await srv.request<StaffBody>('/staff', { method: 'POST', role: Role.ADMIN, body: { ...newStaff, email: '  New@Example.COM ' } });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.role, 'STAFF');
  assert.equal(response.body.data.isActive, true);
  assert.notEqual(response.body.data.emailVerifiedAt, null);
  assert.match(response.headers.get('location') ?? '', /\/staff\/6$/);
  assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
  assert.equal(JSON.stringify(response.body).includes(PASSWORD), false);
  const stored = s.users.at(-1)!;
  assert.equal(stored.email, 'new@example.com');
  assert.equal(stored.role, 'STAFF');
  assert.notEqual(stored.passwordHash, PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, stored.passwordHash), true);
  assert.deepEqual(s.audit.actions(), ['staff.create']);
  assert.equal(JSON.stringify(s.audit.entries[0]).includes(PASSWORD), false);
});

test('create rejects a role in the body, unknown keys and weak passwords', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/staff', { method: 'POST', role: Role.ADMIN, body });
  const bad: unknown[] = [
    { ...newStaff, role: 'ADMIN' }, { ...newStaff, isActive: false }, { ...newStaff, password: 'Short1!' },
    { ...newStaff, password: 'alllowercase1!' }, { ...newStaff, password: 'ALLUPPERCASE1!' },
    { ...newStaff, password: 'NoSpecial1234' }, { ...newStaff, password: `Aa1!${'x'.repeat(69)}` },
    { ...newStaff, password: `Aa1!${'é'.repeat(35)}` },
    { ...newStaff, email: 'not-an-email' }, { ...newStaff, name: 'A' }, { ...newStaff, username: 'a b' },
    { email: newStaff.email, password: PASSWORD },
  ];
  for (const body of bad) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  assert.equal(s.users.length, 5);
  assert.equal((await post({ ...newStaff, password: `Aa1!${'x'.repeat(68)}` })).status, 201);
});

test('email is unique including soft-deleted users, username is unique, both return 409 DUPLICATE', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const post = (body: unknown) => srv.request<ApiBody>('/staff', { method: 'POST', role: Role.ADMIN, body });
  const sameEmail = await post({ ...newStaff, email: 'user4@test.brightloop' });
  assert.equal(sameEmail.status, 409);
  assert.equal(sameEmail.body.error?.code, 'DUPLICATE');
  assert.equal((await srv.request('/staff/5', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.equal((await post({ ...newStaff, email: 'user5@test.brightloop' })).body.error?.code, 'DUPLICATE');
  assert.equal((await post({ ...newStaff, email: 'user1@test.brightloop' })).status, 409);
  const sameUsername = await post({ ...newStaff, username: 'sam' });
  assert.equal(sameUsername.status, 409);
  assert.equal(sameUsername.body.error?.code, 'DUPLICATE');
  s.failNext.create = sqlError('23505');
  const race = await post(newStaff);
  assert.equal(race.status, 409);
  assert.equal(race.body.error?.code, 'DUPLICATE');
  assert.deepEqual(s.audit.actions(), ['staff.delete']);
});

test('update changes only name and username, rejects other keys, empty patches and duplicate usernames', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const patch = (id: number, body: unknown) => srv.request<ApiBody & { data: { name: string; username: string | null } }>(`/staff/${id}`, { method: 'PATCH', role: Role.ADMIN, body });
  const ok = await patch(5, { name: 'Renamed', username: 'renamed' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.data.name, ok.body.data.username], ['Renamed', 'renamed']);
  assert.equal((await patch(5, { username: null })).body.data.username, null);
  for (const body of [{}, { role: 'ADMIN' }, { email: 'x@y.com' }, { isActive: false }, { password: PASSWORD }, { username: 'a b' }]) {
    assert.equal((await patch(5, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await patch(5, { username: 'sam' })).status, 409);
  assert.equal((await patch(4, { username: 'sam' })).status, 200);
  s.failNext.update = sqlError('23505');
  assert.equal((await patch(5, { username: 'other' })).status, 409);
  assert.equal((await patch(99, { name: 'Ghost' })).status, 404);
  assert.equal(s.users[4]?.role, 'STAFF');
  assert.deepEqual(s.audit.actions(), ['staff.update', 'staff.update', 'staff.update']);
});

test('ADMIN and CUSTOMER ids, soft-deleted and unknown ids are 404 on every id route', async (t) => {
  const s = setup();
  s.users.push(userRow(6, 'STAFF', { deletedAt: NOW }));
  const srv = await server(t, s);
  for (const id of [1, 3, 6, 99]) {
    for (const [method, suffix] of [['GET', ''], ['PATCH', ''], ['POST', '/activate'], ['DELETE', '']] as const) {
      const response = await srv.request<ApiBody>(`/staff/${id}${suffix}`, { method, role: Role.ADMIN, ...(method === 'PATCH' ? { body: { name: 'Nope' } } : {}) });
      // Admin id 1 is the caller itself: only the self-guarded routes answer 403 before the lookup.
      const expected = id === 1 && method === 'DELETE' ? 403 : 404;
      assert.equal(response.status, expected, `${method} /staff/${id}${suffix}`);
    }
    if (id !== 1) assert.equal((await srv.request(`/staff/${id}/deactivate`, { method: 'POST', role: Role.ADMIN })).status, 404);
  }
  assert.equal((await srv.request('/staff/3/deactivate', { method: 'POST', role: Role.ADMIN })).status, 404);
  assert.equal(s.users[2]?.isActive, true);
  assert.equal(s.audit.entries.length, 0);
  assert.equal((await srv.request('/staff/abc', { role: Role.ADMIN })).status, 400);
});

test('deactivate sets isActive=false and revokes sessions in one repository call; it is idempotent', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const first = await srv.request<StaffBody>('/staff/4/deactivate', { method: 'POST', role: Role.ADMIN });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.isActive, false);
  assert.deepEqual(s.transactions, ['deactivate:4']);
  assert.deepEqual(s.sessions.map((x) => x.revokedAt !== null), [true, true, false]);
  assert.equal((await srv.request('/staff/4/deactivate', { method: 'POST', role: Role.ADMIN })).status, 200);
  const activated = await srv.request<StaffBody>('/staff/4/activate', { method: 'POST', role: Role.ADMIN });
  assert.equal(activated.body.data.isActive, true);
  assert.equal((await srv.request('/staff/4/activate', { method: 'POST', role: Role.ADMIN })).status, 200);
  assert.deepEqual(s.audit.actions(), ['staff.deactivate', 'staff.deactivate', 'staff.activate', 'staff.activate']);
});

test('delete soft-deletes and revokes sessions in one repository call, then the member is gone', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  assert.equal((await srv.request('/staff/4', { method: 'DELETE', role: Role.ADMIN })).status, 200);
  assert.deepEqual(s.transactions, ['delete:4']);
  assert.notEqual(s.users[3]?.deletedAt, null);
  assert.equal(s.sessions.filter((x) => x.userId === 4).every((x) => x.revokedAt !== null), true);
  assert.equal(s.sessions.find((x) => x.userId === 5)?.revokedAt, null);
  assert.equal((await srv.request('/staff/4', { role: Role.ADMIN })).status, 404);
  assert.equal((await srv.request('/staff/4', { method: 'DELETE', role: Role.ADMIN })).status, 404);
  assert.deepEqual(s.audit.actions(), ['staff.delete']);
});

test('an admin cannot deactivate or delete themselves; the service also refuses non-admin actors', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  assert.equal((await srv.request('/staff/1/deactivate', { method: 'POST', role: Role.ADMIN })).status, 403);
  assert.equal((await srv.request('/staff/1', { method: 'DELETE', role: Role.ADMIN })).status, 403);
  const selfActor = { userId: 4, role: Role.ADMIN };
  await assert.rejects(s.service.deactivate(selfActor, 4), { status: 403 });
  await assert.rejects(s.service.remove(selfActor, 4), { status: 403 });
  assert.equal(s.users[3]?.isActive, true);
  assert.equal(s.users[3]?.deletedAt, null);
  const list = { page: 1, limit: 10, sortBy: 'name', sortOrder: 'asc' } as const;
  for (const role of [Role.STAFF, Role.CUSTOMER]) {
    const actor = actorFor(role);
    await assert.rejects(s.service.list(actor, list), { status: 403 });
    await assert.rejects(s.service.get(actor, 4), { status: 403 });
    await assert.rejects(s.service.create(actor, newStaff), { status: 403 });
    await assert.rejects(s.service.update(actor, 4, { name: 'No' }), { status: 403 });
    await assert.rejects(s.service.deactivate(actor, 4), { status: 403 });
    await assert.rejects(s.service.activate(actor, 4), { status: 403 });
    await assert.rejects(s.service.remove(actor, 4), { status: 403 });
  }
  assert.equal(s.audit.entries.length, 0);
});

test('list: bounded strict query, search, isActive filter, whitelisted sort, meta', async (t) => {
  const s = setup();
  const srv = await server(t, s);
  const get = (query: string) => srv.request<ApiBody & { data: { role: string }[] }>(`/staff${query}`, { role: Role.ADMIN });
  for (const bad of ['?limit=101', '?limit=0', '?page=0', '?sortBy=role', '?sortBy=passwordHash', '?sortOrder=up', '?isActive=yes', '?role=ADMIN', '?bogus=1', '?search=']) {
    const response = await get(bad);
    assert.equal(response.status, 400, bad);
    assert.equal(response.body.error?.code, 'VALIDATION_ERROR');
  }
  for (const sortBy of ['name', 'email', 'createdAt', 'lastLoginAt']) {
    assert.equal((await get(`?sortBy=${sortBy}`)).status, 200);
    assert.equal(s.lastList.at(-1)?.sortBy, sortBy);
  }
  const ok = await get('?search=sam&isActive=false&limit=2');
  assert.equal(ok.status, 200);
  assert.deepEqual(s.lastList.at(-1), { search: 'sam', isActive: false, sortBy: 'createdAt', limit: 2 });
  assert.equal(ok.body.data.length, 2);
  assert.equal(ok.body.data.every((row) => row.role === 'STAFF'), true);
  assert.deepEqual(ok.body.meta, { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false });
  assert.equal(JSON.stringify(ok.body).includes('passwordHash'), false);
});

test('a deactivated staff member is rejected on the next request through the REAL AuthService', async (t) => {
  // Same storage the real auth repository would read; only the persistence layer is faked.
  const s = setup();
  s.users[3]!.passwordHash = await hashPassword(PASSWORD);
  const live = s.users[3]!;
  class SharedAuthRepository extends AuthRepository {
    override async findUserById(id: number): Promise<UserRow | null> { return s.users.find((u) => u.id === id) ?? null; }
    override async findSessionById(id: number): Promise<SessionRow | null> { return s.sessions.find((x) => x.id === id) ?? null; }
  }
  const kv = new MemoryKvStore();
  const realAuth = new AuthService(new SharedAuthRepository(), new OtpService({ async sendOtp() {} }, kv), kv);
  const srv = await startTestServer(t, (v1) => v1.use('/staff', createStaffRouter({ authService: realAuth, staffService: s.service })));
  s.sessions.push({ ...s.sessions[0]!, id: 200, userId: 1, currentTokenHash: 'admin' });
  const adminBearer = signAccessToken({ sub: 1, role: 'ADMIN', sid: 200 });
  const staffToken = signAccessToken({ sub: live.id, role: 'STAFF', sid: 100 });

  // The staff member's token authenticates (then hits the ADMIN gate: 403, not 401).
  assert.equal((await srv.request('/staff', { token: staffToken })).status, 403);
  assert.equal((await srv.request('/staff/4/deactivate', { method: 'POST', token: adminBearer })).status, 200);
  assert.equal(live.isActive, false);
  assert.equal((await srv.request('/staff', { token: staffToken })).status, 401);

  // Reactivated: the user is live again but the revoked session stays dead.
  assert.equal((await srv.request('/staff/4/activate', { method: 'POST', token: adminBearer })).status, 200);
  assert.equal((await srv.request('/staff', { token: staffToken })).status, 401);

  // A deleted member is rejected even with a fresh unrevoked session.
  s.sessions.push({ ...s.sessions[0]!, id: 201, userId: 5, currentTokenHash: 'fresh', revokedAt: null });
  const otherToken = signAccessToken({ sub: 5, role: 'STAFF', sid: 201 });
  assert.equal((await srv.request('/staff', { token: otherToken })).status, 403);
  assert.equal((await srv.request('/staff/5', { method: 'DELETE', token: adminBearer })).status, 200);
  assert.equal((await srv.request('/staff', { token: otherToken })).status, 401);
});
