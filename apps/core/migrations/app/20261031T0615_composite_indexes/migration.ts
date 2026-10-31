#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3a065292d6b8db87ba883fafc274779dcb077be21b01fdf300d75e1b4ab4df84/contract';
import endContract from '../../snapshots/3a065292d6b8db87ba883fafc274779dcb077be21b01fdf300d75e1b4ab4df84/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b19135167b39385a703113bb2e1086ad575cc59a6243090883e2d05bcf170702/contract';
import startContract from '../../snapshots/b19135167b39385a703113bb2e1086ad575cc59a6243090883e2d05bcf170702/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'Invoice',
        index: 'Invoice_customerId_status_idx_2986b558',
        columns: ['customerId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Invoice',
        index: 'Invoice_status_issueDate_idx_6b9a7042',
        columns: ['status', 'issueDate'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Subscription',
        index: 'Subscription_customerId_status_idx_2986b558',
        columns: ['customerId', 'status'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
