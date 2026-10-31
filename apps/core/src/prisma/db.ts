import { env } from '../config/env.js';
import postgres, { type PostgresClient } from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db: PostgresClient<Contract> = postgres({
  contract,
  url: env.DATABASE_URL,
});
