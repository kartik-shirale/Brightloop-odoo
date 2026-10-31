/**
 * The single shared Prisma 8 contract client (backend-rules.md #6).
 * The concrete client is built in `src/prisma/db.ts` next to the contract.
 */

export { db as prisma, contract as prismaContract } from '../prisma/db.js';
export type { PostgresClient } from '@prisma/orm-postgres/runtime';
