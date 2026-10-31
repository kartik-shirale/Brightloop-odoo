import type { StaffDto } from '@brightloop/shared';
import { Role } from '@brightloop/shared';
import type { UserRow } from '../../core/types/db-rows.js';

/** Explicit field list: the password hash and deletedAt never leave the module. */
export function toStaffDto(row: UserRow): StaffDto {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role: Role.STAFF,
    isActive: row.isActive,
    emailVerifiedAt: row.emailVerifiedAt,
    passwordChangedAt: row.passwordChangedAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
