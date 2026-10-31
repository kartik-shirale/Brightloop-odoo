/**
 * Row shapes of the `User` and `Session` contract models, mirroring
 * `src/prisma/contract.prisma` column types (TimestamptzString → ISO strings,
 * Role enum → its string union).
 */

import type { RoleDto as Role } from '@brightloop/shared';

export interface UserRow {
  id: number;
  name: string;
  username: string | null;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRow {
  id: number;
  userId: number;
  currentTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
