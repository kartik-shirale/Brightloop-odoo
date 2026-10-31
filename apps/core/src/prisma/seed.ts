import { passwordSchema } from '../modules/auth/auth.schema.js';
import { PASSWORD_POLICY, Role } from '@brightloop/shared';
/**
 * Seeds the default admin (role ADMIN, pre-verified) — sign-ups can only
 * create CUSTOMER accounts (backend-rules.md RBAC).
 */

import { prisma } from '../config/prisma.js';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { pathToFileURL } from 'node:url';
import { env } from '../config/env.js';
import { hashPassword } from '../core/utils/hash.js';
import { logger } from '../core/logger.js';

export async function seed(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    logger.info('Admin seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to enable it');
    return;
  }
  const repository = new AuthRepository();
  const admin = await repository.findUserByEmail(env.ADMIN_EMAIL);
  if (admin) {
    logger.info('Admin account already exists; seed leaves it unchanged');
    return;
  }
  if (!passwordSchema.safeParse(env.ADMIN_PASSWORD).success) throw new Error(`New admin password: ${PASSWORD_POLICY.MESSAGE}`);
  await repository.createUser({
    name: 'Admin', email: env.ADMIN_EMAIL,
    passwordHash: await hashPassword(env.ADMIN_PASSWORD), role: Role.ADMIN, emailVerified: true,
  });
  logger.info('admin seeded');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await seed(); } finally { await prisma.close(); }
}
