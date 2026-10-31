import { Role } from '@brightloop/shared';
/**
 * Users business logic (backend-rules.md #10). Listing and stats are
 * admin/staff-only; profile updates and password changes are per-user.
 */

import { hashPassword, verifyPassword } from '../../core/utils/hash.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import { notFound, forbidden, badRequest } from '../../core/errors.js';
import type { AuthenticatedUser } from '../../core/types/express.js';
import { toUserDto, type ListUsersResult } from './users.dto.js';
import type { UsersRepository } from './users.repository.js';
import type { ChangePasswordInput, ListUsersQuery, UpdateMeInput } from './users.schema.js';

export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly authSessions: AuthSessionGateway,
  ) {}

  async list(query: ListUsersQuery): Promise<ListUsersResult> {
    const [rows, total] = await Promise.all([
      this.repository.listUsers(query),
      this.repository.countUsers(query),
    ]);
    return {
      users: rows.map(toUserDto),
      meta: listMetaFor(total, query.page, query.limit),
    };
  }

  async getById(id: number): Promise<ReturnType<typeof toUserDto>> {
    const row = await this.repository.findUserById(id);
    if (!row || row.deletedAt !== null) {
      throw notFound('User not found');
    }
    return toUserDto(row);
  }

  async getForViewer(viewer: AuthenticatedUser, id: number): Promise<ReturnType<typeof toUserDto>> {
    if (viewer.role !== Role.ADMIN && viewer.role !== Role.STAFF && viewer.id !== id) {
      throw notFound('User not found');
    }
    return this.getById(id);
  }

  /** Own-profile patch; email/password changes have dedicated flows. */
  async updateMe(user: AuthenticatedUser, patch: UpdateMeInput) {
    if (patch.username !== undefined && patch.username !== null) {
      const taken = await this.repository.findUserByUsername(patch.username);
      if (taken && taken.id !== user.id) {
        throw badRequest('Username is already taken');
      }
    }
    const row = await this.repository.updateUser(user.id, patch);
    return toUserDto(row);
  }

  /** Rotates the password and revokes every other session (rule #8). */
  async changePassword(user: AuthenticatedUser, input: ChangePasswordInput): Promise<void> {
    const row = await this.repository.findUserById(user.id);
    if (!row) {
      throw notFound('User not found');
    }
    const currentOk = await verifyPassword(input.currentPassword, row.passwordHash);
    if (!currentOk) {
      throw forbidden('Current password is incorrect');
    }
    if (input.currentPassword === input.password) {
      throw badRequest('New password must be different from the current one');
    }
    await this.authSessions.updatePasswordAndRevokeOthers(
      user.id,
      await hashPassword(input.password),
      user.sid,
    );
  }

  async stats() {
    return this.repository.stats();
  }
}

/** Narrow bridge to the auth module (modules never import its repository, rule #1). */
export interface AuthSessionGateway {
  updatePasswordAndRevokeOthers(
    userId: number,
    passwordHash: string,
    keepSessionId: number,
  ): Promise<void>;
  revokeSessionForUser(userId: number, sessionId: number): Promise<void>;
}
