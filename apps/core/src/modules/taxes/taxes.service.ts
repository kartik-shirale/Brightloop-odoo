import type { ListMeta, TaxDto } from '@brightloop/shared';
import { forbidden, notFound, validationError } from '../../core/errors.js';
import { isAdmin, isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { rethrowDbError } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import { toTaxDto } from './taxes.dto.js';
import type { TaxRecord, TaxesGateway } from './taxes.gateway.js';
import type { TaxRow, TaxesRepository } from './taxes.repository.js';
import { rateProblem, type CreateTaxInput, type ListTaxesParams, type UpdateTaxInput } from './taxes.schema.js';

const DUPLICATE_NAME = 'A tax with this name already exists';
const IN_USE = 'This tax is used by subscription or invoice lines. Deactivate it instead of deleting it';

export class TaxesService implements TaxesGateway {
  constructor(
    private readonly repository: TaxesRepository,
    private readonly audit: AuditGateway,
  ) {}

  async list(actor: Actor, query: ListTaxesParams): Promise<{ taxes: TaxDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    return { taxes: rows.map(toTaxDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<TaxDto> {
    this.assertCanRead(actor);
    return toTaxDto(await this.requireTax(id));
  }

  async create(actor: Actor, input: CreateTaxInput, ip?: string): Promise<TaxDto> {
    this.assertAdmin(actor);
    let row: TaxRow;
    try {
      row = await this.repository.create(input);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_NAME });
    }
    await this.audit.record({
      actor, action: 'tax.create', entityType: 'Tax', entityId: row.id, ip,
      metadata: { name: row.name, type: row.type, rate: row.rate, isActive: row.isActive },
    });
    return toTaxDto(row);
  }

  /**
   * Editing never touches existing lines: they hold a snapshot of the rate they
   * were created with.
   */
  async update(actor: Actor, id: number, patch: UpdateTaxInput, ip?: string): Promise<TaxDto> {
    this.assertAdmin(actor);
    const existing = await this.requireTax(id);
    const problem = rateProblem(patch.type ?? existing.type, patch.rate ?? existing.rate);
    if (problem !== null) throw validationError('Validation failed', [{ field: 'rate', message: problem }]);

    let row: TaxRow | null;
    try {
      row = await this.repository.update(id, patch);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_NAME });
    }
    if (row === null) throw notFound('Tax not found');
    await this.audit.record({
      actor, action: 'tax.update', entityType: 'Tax', entityId: id, ip,
      metadata: { changes: patch, previous: pickPrevious(existing, patch) },
    });
    return toTaxDto(row);
  }

  /** A tax referenced by any line fails on the foreign key and becomes 409 IN_USE. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    let row: TaxRow | null;
    try {
      row = await this.repository.delete(id);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: IN_USE });
    }
    if (row === null) throw notFound('Tax not found');
    await this.audit.record({
      actor, action: 'tax.delete', entityType: 'Tax', entityId: id, ip,
      metadata: { name: row.name, type: row.type, rate: row.rate },
    });
  }

  async getByIds(ids: readonly number[]): Promise<TaxRecord[]> {
    const rows = await this.repository.findByIds([...new Set(ids)]);
    return rows.map(({ id, name, type, rate, isActive }) => ({ id, name, type, rate, isActive }));
  }

  private async requireTax(id: number): Promise<TaxRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound('Tax not found');
    return row;
  }

  private assertCanRead(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

function pickPrevious(existing: TaxRow, patch: UpdateTaxInput): Partial<Pick<TaxRow, 'name' | 'type' | 'rate' | 'isActive'>> {
  const previous: Partial<Pick<TaxRow, 'name' | 'type' | 'rate' | 'isActive'>> = {};
  if (patch.name !== undefined) previous.name = existing.name;
  if (patch.type !== undefined) previous.type = existing.type;
  if (patch.rate !== undefined) previous.rate = existing.rate;
  if (patch.isActive !== undefined) previous.isActive = existing.isActive;
  return previous;
}
