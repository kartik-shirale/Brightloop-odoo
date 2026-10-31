import '../../core/test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promisify } from 'node:util';
import type { AuthResult, ApiResponse, UserDto, ListMeta } from '@brightloop/shared';
import { createApp } from '../../app.js';
import { serviceUnavailable } from '../../core/errors.js';
import { MemoryKvStore } from '../../config/redis.js';
import type { UserRow, SessionRow } from '../../core/types/db-rows.js';
import { hashPassword, verifyPassword } from '../../core/utils/hash.js';
import { AuthRepository, type CreateUserData, type CreateSessionData } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { UsersService } from '../users/users.service.js';
import type { ListUsersQuery, UpdateMeInput } from '../users/users.schema.js';

class TestRepository extends AuthRepository {
  users: UserRow[] = [];
  sessions: SessionRow[] = [];
  override async findUserByEmail(email: string): Promise<UserRow | null> { return this.users.find((u) => u.email === email) ?? null; }
  override async findUserByUsername(username: string): Promise<UserRow | null> { return this.users.find((u) => u.username === username) ?? null; }
  override async findUserById(id: number): Promise<UserRow | null> { return this.users.find((u) => u.id === id) ?? null; }
  override async createUser(input: CreateUserData): Promise<UserRow> {
    const now = new Date().toISOString();
    const user: UserRow = { id: this.users.length + 1, name: input.name, email: input.email,
      isActive: true, passwordHash: input.passwordHash, role: input.role ?? 'CUSTOMER', username: input.username ?? null,
      emailVerifiedAt: input.emailVerified ? now : null, deletedAt: null, passwordChangedAt: null,
      lastLoginAt: null, createdAt: now, updatedAt: now };
    this.users.push(user);
    return user;
  }
  override async markEmailVerified(id: number): Promise<UserRow> {
    const user = this.users.find((u) => u.id === id)!;
    user.emailVerifiedAt = new Date().toISOString();
    return user;
  }
  override async touchLastLogin(id: number): Promise<void> { this.users.find((u) => u.id === id)!.lastLoginAt = new Date().toISOString(); }
  override async createSession(input: CreateSessionData): Promise<SessionRow> {
    const session = { ...input, id: this.sessions.length + 1, createdAt: new Date().toISOString(), revokedAt: null, lastUsedAt: null };
    this.sessions.push(session);
    return { ...session };
  }
  override async findSessionById(id: number): Promise<SessionRow | null> {
    const session = this.sessions.find((s) => s.id === id);
    return session ? { ...session } : null;
  }
  override async findSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    const session = this.sessions.find((s) => s.currentTokenHash === hash);
    return session ? { ...session } : null;
  }
  override async rotateSession(id: number, oldHash: string, nextHash: string, expiresAt: string): Promise<boolean> {
    const session = this.sessions.find((s) => s.id === id && !s.revokedAt && s.currentTokenHash === oldHash);
    if (!session) return false;
    session.currentTokenHash = nextHash;
    session.expiresAt = expiresAt;
    return true;
  }
  override async revokeSession(id: number): Promise<void> { this.sessions.find((s) => s.id === id)!.revokedAt = new Date().toISOString(); }
  override async revokeAllSessionsForUser(id: number): Promise<void> {
    for (const session of this.sessions.filter((s) => s.userId === id)) session.revokedAt = new Date().toISOString();
  }
  override async changePassword(id: number, passwordHash: string, keepId?: number): Promise<void> {
    this.users.find((u) => u.id === id)!.passwordHash = passwordHash;
    for (const session of this.sessions.filter((s) => s.userId === id && s.id !== keepId)) session.revokedAt = new Date().toISOString();
  }
  override async listSessionsForUser(id: number): Promise<SessionRow[]> { return this.sessions.filter((s) => s.userId === id); }
  override async countSessionsForUser(id: number): Promise<number> { return this.sessions.filter((s) => s.userId === id).length; }
  override async checkHealth(): Promise<void> {}
}

class TestUsersRepository extends UsersRepository {
  constructor(private readonly auth: TestRepository) { super(); }
  lastQuery?: ListUsersQuery;
  override async listUsers(query: ListUsersQuery): Promise<UserRow[]> { this.lastQuery = query; return this.auth.users; }
  override async countUsers(): Promise<number> { return this.auth.users.length; }
  override async findUserById(id: number): Promise<UserRow | null> { return this.auth.findUserById(id); }
  override async findUserByUsername(name: string): Promise<UserRow | null> { return this.auth.users.find((u) => u.username === name) ?? null; }
  override async updateUser(id: number, patch: UpdateMeInput): Promise<UserRow> {
    return Object.assign(this.auth.users.find((u) => u.id === id)!, patch);
  }
}

async function fixture(t: { after(fn: () => Promise<void>): void }, deliveryFailures = 0) {
  const repository = new TestRepository();
  const kv = new MemoryKvStore();
  const sent: { toEmail: string; otp: string; kind: string }[] = [];
  const otpService = new OtpService({ async sendOtp(input) {
    if (deliveryFailures > 0) { deliveryFailures--; throw serviceUnavailable('Test delivery failure'); }
    sent.push(input);
  } }, kv);
  const authService = new AuthService(repository, otpService, kv);
  const usersRepository = new TestUsersRepository(repository);
  const usersService = new UsersService(usersRepository, {
    async updatePasswordAndRevokeOthers(id, hash, keep) { await repository.changePassword(id, hash, keep); },
    async revokeSessionForUser(id, sid) { if ((await repository.findSessionById(sid))?.userId === id) await repository.revokeSession(sid); },
  });
  const { app } = createApp({ authRepository: repository, authService, otpService, usersRepository, usersService }, kv);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await promisify(server.close.bind(server))(); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  async function request(path: string, method = 'GET', body?: unknown, token?: string, cookie?: string): Promise<Response> {
    return fetch(`${base}/api/v1${path}`, { method, headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function login(email: string, password = 'Password123!'): Promise<{ auth: AuthResult; cookie: string }> {
    const response = await request('/auth/login', 'POST', { email, password });
    assert.equal(response.status, 200);
    const payload = await response.json() as ApiResponse<AuthResult>;
    return { auth: payload.data!, cookie: response.headers.get('set-cookie')!.split(';')[0] };
  }
  async function addUser(email: string, role: UserRow['role'] = 'CUSTOMER'): Promise<UserRow> {
    return repository.createUser({ name: 'Test User', email, role, emailVerified: true, passwordHash: await hashPassword('Password123!') });
  }
  return { repository, usersRepository, authService, request, sent, login, addUser, base, kv };
}

test('HTTP registration, verification, login, refresh cookies, logout and validation', async (t) => {
  const f = await fixture(t);
  const body = { name: 'Alice', username: 'alice', email: ' Alice@Example.com ', password: 'Password123!', confirmPassword: 'Password123!', role: 'ADMIN' };
  assert.equal((await f.request('/auth/register', 'POST', { ...body, confirmPassword: 'bad' })).status, 400);
  const registered = await f.request('/auth/register', 'POST', body);
  assert.equal(registered.status, 201);
  assert.equal(f.repository.users[0].role, 'CUSTOMER');
  assert.equal(f.repository.users[0].username, 'alice');
  assert.equal(f.repository.users[0].emailVerifiedAt, null);
  assert.equal((await f.request('/auth/login', 'POST', { email: 'alice@example.com', password: 'Password123!' })).status, 403);
  const verified = await f.request('/auth/verify-otp', 'POST', { email: 'alice@example.com', otp: f.sent[0].otp });
  assert.equal(verified.status, 200);
  const auth = (await verified.json() as ApiResponse<AuthResult>).data!;
  assert(!('refreshToken' in auth));
  assert(!('passwordHash' in auth.user));
  const cookieHeader = verified.headers.get('set-cookie')!;
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Lax/);
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await f.request('/users/me', 'GET', undefined, auth.accessToken)).status, 200);
  assert.equal((await f.request('/auth/verify-otp', 'POST', { email: 'alice@example.com', otp: f.sent[0].otp })).status, 400);
  const refreshed = await f.request('/auth/refresh', 'POST', undefined, undefined, cookie);
  assert.equal(refreshed.status, 200);
  const nextCookie = refreshed.headers.get('set-cookie')!.split(';')[0];
  assert.notEqual(cookie, nextCookie);
  assert.equal((await f.request('/auth/refresh', 'POST', undefined, undefined, cookie)).status, 401);
  assert.equal((await f.request('/auth/logout', 'POST', undefined, undefined, nextCookie)).status, 200);
  assert.equal((await f.request('/users/me', 'GET', undefined, auth.accessToken)).status, 401);
  assert.equal((await f.request('/auth/refresh', 'POST', undefined, undefined, nextCookie)).status, 401);
  await f.login('alice@example.com');
});

test('HTTP role gates, parsed queries and resource ownership', async (t) => {
  const f = await fixture(t);
  const user = await f.addUser('user@example.com');
  await f.addUser('admin@example.com', 'ADMIN');
  await f.addUser('staff@example.com', 'STAFF');
  const normal = await f.login('user@example.com');
  const admin = await f.login('admin@example.com');
  const manager = await f.login('staff@example.com');
  assert.equal((await f.request('/users')).status, 401);
  assert.equal((await f.request('/users', 'GET', undefined, normal.auth.accessToken)).status, 403);
  const result = await f.request('/users?page=2&limit=5&verified=false', 'GET', undefined, admin.auth.accessToken);
  assert.equal(result.status, 200);
  const payload = await result.json() as ApiResponse<UserDto[]> & { meta: ListMeta };
  assert.equal(payload.meta.page, 2);
  assert.equal(f.usersRepository.lastQuery?.verified, false);
  assert.equal((await f.request('/users', 'GET', undefined, manager.auth.accessToken)).status, 200);
  assert.equal((await f.request('/users?limit=999', 'GET', undefined, admin.auth.accessToken)).status, 400);
  assert.equal((await f.request('/users/nope', 'GET', undefined, normal.auth.accessToken)).status, 400);
  assert.equal((await f.request(`/users/${user.id + 1}`, 'GET', undefined, normal.auth.accessToken)).status, 404);
  const response = await f.request('/users/me', 'PATCH', { name: 'Alice New' }, normal.auth.accessToken);
  assert.equal(response.status, 200);
  assert.equal(f.repository.users[0].name, 'Alice New');
});

test('password change revokes other devices; OTP reset revokes all devices', async (t) => {
  const f = await fixture(t);
  const user = await f.addUser('user@example.com');
  const first = await f.login(user.email);
  const second = await f.login(user.email);
  const changed = await f.request('/users/me/password', 'POST', { currentPassword: 'Password123!', password: 'Changed123!', confirmPassword: 'Changed123!' }, first.auth.accessToken);
  assert.equal(changed.status, 200);
  assert(await verifyPassword('Changed123!', user.passwordHash));
  assert.equal((await f.request('/users/me', 'GET', undefined, first.auth.accessToken)).status, 200);
  assert.equal((await f.request('/users/me', 'GET', undefined, second.auth.accessToken)).status, 401);
  assert.equal((await f.request('/auth/forgot-password', 'POST', { email: user.email })).status, 200);
  const reset = await f.request('/auth/reset-password', 'POST', { email: user.email, otp: f.sent[0].otp, password: 'Reset1234!', confirmPassword: 'Reset1234!' });
  assert.equal(reset.status, 200);
  assert.equal((await f.request('/users/me', 'GET', undefined, first.auth.accessToken)).status, 401);
  await f.login(user.email, 'Reset1234!');
});

test('concurrent refresh consumes one token; session expiry, revocation and ownership', async (t) => {
  const f = await fixture(t);
  const user = await f.addUser('user@example.com');
  await f.addUser('other@example.com');
  const first = await f.login(user.email);
  const other = await f.login('other@example.com');
  const results = await Promise.all([f.request('/auth/refresh', 'POST', undefined, undefined, first.cookie), f.request('/auth/refresh', 'POST', undefined, undefined, first.cookie)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const listed = await f.request('/auth/sessions?page=1&limit=10', 'GET', undefined, first.auth.accessToken);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as { meta: ListMeta }).meta.total, 1);
  assert.equal((await f.request('/auth/sessions/not-number', 'DELETE', undefined, first.auth.accessToken)).status, 400);
  assert.equal((await f.request('/auth/sessions/2', 'DELETE', undefined, first.auth.accessToken)).status, 400);
  assert.equal((await f.request('/auth/sessions/2', 'DELETE', undefined, other.auth.accessToken)).status, 200);
  assert.equal((await f.request('/users/me', 'GET', undefined, other.auth.accessToken)).status, 401);
  f.repository.sessions[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await f.request('/users/me', 'GET', undefined, first.auth.accessToken)).status, 401);
  const fresh = await f.login(user.email);
  assert.equal((await f.request('/auth/logout-all', 'POST', undefined, fresh.auth.accessToken)).status, 200);
  assert.equal((await f.request('/users/me', 'GET', undefined, fresh.auth.accessToken)).status, 401);
});

test('reset OTP exchange returns a single-use grant restricted to the verified email', async (t) => {
  const f = await fixture(t);
  const user = await f.addUser('reset@example.com');
  await f.addUser('other@example.com');
  await f.request('/auth/forgot-password', 'POST', { email: user.email });
  const verified = await f.request('/auth/verify-reset-otp', 'POST', { email: user.email, otp: f.sent[0].otp });
  assert.equal(verified.status, 200);
  const { data } = await verified.json() as { data: { resetToken: string } };
  assert.match(data.resetToken, /^[0-9a-f]{96}$/);
  const password = { password: 'BrandNew123!', confirmPassword: 'BrandNew123!' };
  assert.equal((await f.request('/auth/reset-password', 'POST', { email: user.email, resetToken: data.resetToken, ...password })).status, 200);
  assert.equal((await f.request('/auth/reset-password', 'POST', { email: user.email, resetToken: data.resetToken, ...password })).status, 400);
  assert.equal((await f.request('/auth/verify-reset-otp', 'POST', { email: user.email, otp: f.sent[0].otp })).status, 400);
  await f.login(user.email, password.password);
});

test('signup can resume after a delivery failure without duplicate users or changing credentials', async (t) => {
  const f = await fixture(t, 1);
  const body = { name: 'Alice', username: 'alice', email: 'alice@example.com', password: 'Password123!', confirmPassword: 'Password123!' };
  assert.equal((await f.request('/auth/register', 'POST', body)).status, 503);
  assert.equal(f.repository.users.length, 1);
  assert.equal(await f.kv.get('app:auth:otp:daily:verify:alice@example.com'), null);
  const wrongPassword = { ...body, password: 'Different123!', confirmPassword: 'Different123!' };
  assert.equal((await f.request('/auth/register', 'POST', wrongPassword)).status, 409);
  assert.equal((await f.request('/auth/register', 'POST', { ...body, name: 'Changed', username: 'changed' })).status, 201);
  assert.equal(f.repository.users.length, 1);
  assert.equal(f.repository.users[0].name, 'Alice');
  assert.equal(f.repository.users[0].username, 'alice');
  assert(await verifyPassword(body.password, f.repository.users[0].passwordHash));
  assert.equal(f.sent.length, 1);
  assert.equal((await f.request('/auth/verify-otp', 'POST', { email: body.email, otp: f.sent[0].otp })).status, 200);
  assert.equal((await f.request('/auth/register', 'POST', body)).status, 409);
});

test('inactive accounts cannot log in, refresh, verify or keep using an access token', async (t) => {
  const f = await fixture(t);
  const user = await f.addUser('inactive@example.com', 'STAFF');
  const signedIn = await f.login(user.email);
  user.isActive = false;
  assert.equal((await f.request('/auth/login', 'POST', { email: user.email, password: 'Password123!' })).status, 401);
  assert.equal((await f.request('/users/me', 'GET', undefined, signedIn.auth.accessToken)).status, 401);
  assert.equal((await f.request('/auth/refresh', 'POST', undefined, undefined, signedIn.cookie)).status, 401);
  assert.equal((await f.request('/auth/verify-otp', 'POST', { email: user.email, otp: '123456' })).status, 400);
  assert.equal((await f.request('/auth/verify-reset-otp', 'POST', { email: user.email, otp: '123456' })).status, 400);
  assert.equal((await f.request('/auth/reset-password', 'POST', { email: user.email, otp: '123456', password: 'Changed123!', confirmPassword: 'Changed123!' })).status, 400);
  await f.request('/auth/forgot-password', 'POST', { email: user.email });
  await f.request('/auth/resend-otp', 'POST', { email: user.email });
  assert.equal(f.sent.length, 0);
});

test('signup password policy matches Brightloop without rejecting legacy login passwords', async (t) => {
  const f = await fixture(t);
  const user = await f.repository.createUser({name: 'Legacy Customer', email: 'legacy@example.com', passwordHash: await hashPassword('oldpass1'), emailVerified: true});
  await f.login(user.email, 'oldpass1');
  for (const password of ['Short1!', 'alllowercase!', 'ALLUPPERCASE!', 'NoSymbols123']) {
    const response = await f.request('/auth/register', 'POST', { name: 'New Customer', email: 'new@example.com', password, confirmPassword: password });
    assert.equal(response.status, 400);
  }
  assert.equal(f.repository.users.length, 1);
});
