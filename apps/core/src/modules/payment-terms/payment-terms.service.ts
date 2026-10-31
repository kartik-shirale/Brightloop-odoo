import type { ListMeta, PaymentTermDto } from '@brightloop/shared';
import { forbidden, notFound, validationError } from '../../core/errors.js';
import { isAdmin, isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { inUse, rethrowDbError } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import { toPaymentTermDto } from './payment-terms.dto.js';
import type { PaymentTermRecord, PaymentTermsGateway } from './payment-terms.gateway.js';
import type { DeleteOutcome, PaymentTermRow, PaymentTermsRepository } from './payment-terms.repository.js';
import {
  DEFAULT_MUST_BE_ACTIVE,
  type CreatePaymentTermInput,
  type ListPaymentTermsParams,
  type UpdatePaymentTermInput,
} from './payment-terms.schema.js';

const DUPLICATE_NAME = 'A payment term with this name already exists';
const IN_USE = 'This payment term is used by subscriptions or invoices. Deactivate it instead of deleting it';
const IS_DEFAULT = 'The default payment term cannot be deleted. Make another term the default first';

export class PaymentTermsService implements PaymentTermsGateway {
  constructor(
    private readonly repository: PaymentTermsRepository,
    private readonly audit: AuditGateway,
  ) {}

  async list(actor: Actor, query: ListPaymentTermsParams): Promise<{ paymentTerms: PaymentTermDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    return { paymentTerms: rows.map(toPaymentTermDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<PaymentTermDto> {
    this.assertCanRead(actor);
    return toPaymentTermDto(await this.requireTerm(id));
  }

  async create(actor: Actor, input: CreatePaymentTermInput, ip?: string): Promise<PaymentTermDto> {
    this.assertAdmin(actor);
    let row: PaymentTermRow;
    try {
      row = await this.repository.create(input);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_NAME });
    }
    await this.audit.record({
      actor, action: 'payment-term.create', entityType: 'PaymentTerm', entityId: row.id, ip,
      metadata: { name: row.name, dueDays: row.dueDays, isDefault: row.isDefault, isActive: row.isActive },
    });
    return toPaymentTermDto(row);
  }

  /** Making a term the default clears the previous default atomically. The default must stay active. */
  async update(actor: Actor, id: number, patch: UpdatePaymentTermInput, ip?: string): Promise<PaymentTermDto> {
    this.assertAdmin(actor);
    const existing = await this.requireTerm(id);
    const willBeDefault = patch.isDefault ?? existing.isDefault;
    const willBeActive = patch.isActive ?? existing.isActive;
    if (willBeDefault && !willBeActive) {
      throw validationError('Validation failed', [{ field: 'isActive', message: DEFAULT_MUST_BE_ACTIVE }]);
    }

    let row: PaymentTermRow | null;
    try {
      row = await this.repository.update(id, patch);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_NAME });
    }
    if (row === null) throw notFound('Payment term not found');
    await this.audit.record({
      actor, action: 'payment-term.update', entityType: 'PaymentTerm', entityId: id, ip,
      metadata: { changes: patch, previous: pickPrevious(existing, patch) },
    });
    return toPaymentTermDto(row);
  }

  /** A referenced term fails on the foreign key and becomes 409 IN_USE; so does the default term. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    let outcome: DeleteOutcome;
    try {
      outcome = await this.repository.delete(id);
    } catch (error) {
      return rethrowDbError(error, { foreignKey: IN_USE });
    }
    if (outcome.kind === 'not-found') throw notFound('Payment term not found');
    if (outcome.kind === 'is-default') throw inUse(IS_DEFAULT);
    await this.audit.record({
      actor, action: 'payment-term.delete', entityType: 'PaymentTerm', entityId: id, ip,
      metadata: { name: outcome.row.name, dueDays: outcome.row.dueDays },
    });
  }

  async getById(id: number): Promise<PaymentTermRecord | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toRecord(row);
  }

  async getDefault(): Promise<PaymentTermRecord | null> {
    const row = await this.repository.findDefault();
    return row === null ? null : toRecord(row);
  }

  private async requireTerm(id: number): Promise<PaymentTermRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound('Payment term not found');
    return row;
  }

  private assertCanRead(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

function toRecord({ id, name, dueDays, isDefault, isActive }: PaymentTermRow): PaymentTermRecord {
  return { id, name, dueDays, isDefault, isActive };
}

type Tracked = Pick<PaymentTermRow, 'name' | 'dueDays' | 'isDefault' | 'isActive'>;

function pickPrevious(existing: PaymentTermRow, patch: UpdatePaymentTermInput): Partial<Tracked> {
  const previous: Partial<Tracked> = {};
  if (patch.name !== undefined) previous.name = existing.name;
  if (patch.dueDays !== undefined) previous.dueDays = existing.dueDays;
  if (patch.isDefault !== undefined) previous.isDefault = existing.isDefault;
  if (patch.isActive !== undefined) previous.isActive = existing.isActive;
  return previous;
}
