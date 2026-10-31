/**
 * Users module DTOs. Rows are mapped to the shared `UserDto` — password
 * hashes never cross the service boundary.
 */

import type { ListMeta, UserDto } from '@brightloop/shared';
import type { UserRow } from '../../core/types/db-rows.js';

export const toUserDto = (row: UserRow): UserDto => ({
  id: row.id,
  name: row.name,
  username: row.username,
  email: row.email,
  role: row.role,
  isActive: row.isActive,
  emailVerifiedAt: row.emailVerifiedAt,
  passwordChangedAt: row.passwordChangedAt,
  lastLoginAt: row.lastLoginAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface ListUsersResult {
  users: UserDto[];
  meta: ListMeta;
}

export interface UserStats {
  total: number;
  verified: number;
  unverified: number;
  admins: number;
}
