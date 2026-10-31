/**
 * Test identities and tokens for ADMIN, STAFF and CUSTOMER. Tokens are real
 * signed access JWTs (test secrets from `test-env.ts`), verified by
 * `FakeAuthService` the same way the real service verifies them, so 401 cases
 * (missing, malformed, wrong signature) behave like production.
 */

import '../test-env.js';
import { Role, type RoleDto } from '@brightloop/shared';
import { unauthorized } from '../errors.js';
import type { Actor } from '../utils/actor.js';
import type { AuthenticatedUser } from '../types/express.js';
import { signAccessToken, verifyAccessToken } from '../utils/tokens.js';
import type { AuthService } from '../../modules/auth/auth.service.js';

export const TEST_USERS: Readonly<Record<RoleDto, AuthenticatedUser>> = {
  ADMIN: { id: 1, email: 'admin@test.brightloop', name: 'Test Admin', role: Role.ADMIN, sid: 1 },
  STAFF: { id: 2, email: 'staff@test.brightloop', name: 'Test Staff', role: Role.STAFF, sid: 2 },
  CUSTOMER: { id: 3, email: 'customer@test.brightloop', name: 'Test Customer', role: Role.CUSTOMER, sid: 3 },
};

/** Customer record id that the CUSTOMER test actor owns. */
export const TEST_CUSTOMER_ID = 1001;

export const ALL_ROLES: readonly RoleDto[] = [Role.ADMIN, Role.STAFF, Role.CUSTOMER];

/** A valid access token for the test user of `role`. */
export function tokenFor(role: RoleDto): string {
  const user = TEST_USERS[role];
  return signAccessToken({ sub: user.id, role: user.role, sid: user.sid });
}

/** `Authorization` header value for the test user of `role`. */
export const bearerFor = (role: RoleDto): string => `Bearer ${tokenFor(role)}`;

/** The service-layer actor for `role`. CUSTOMER carries `TEST_CUSTOMER_ID`. */
export function actorFor(role: RoleDto, customerId: number = TEST_CUSTOMER_ID): Actor {
  const user = TEST_USERS[role];
  return role === Role.CUSTOMER
    ? { userId: user.id, role, customerId }
    : { userId: user.id, role };
}

/**
 * Drop-in for the `authenticate` middleware's dependency. `deactivate(userId)`
 * simulates a deactivated or revoked account: that user's tokens are rejected
 * from then on, as the live-user and session checks do in production.
 */
export class FakeAuthService {
  private readonly blocked = new Set<number>();

  async authenticate(token: string): Promise<AuthenticatedUser> {
    const payload = verifyAccessToken(token);
    if (payload === null) throw unauthorized('AUTH_REQUIRED', 'Invalid or expired token');
    const user = Object.values(TEST_USERS).find((candidate) => candidate.id === Number(payload.sub));
    if (user === undefined || this.blocked.has(user.id)) {
      throw unauthorized('SESSION_REVOKED', 'Session is no longer valid');
    }
    return user;
  }

  deactivate(userId: number): void {
    this.blocked.add(userId);
  }

  reactivate(userId: number): void {
    this.blocked.delete(userId);
  }

  /** The type routers expect. Only `authenticate` is ever called on it. */
  asAuthService(): AuthService {
    return this as unknown as AuthService;
  }
}
