import { Role, type CustomerDto, type CustomerListItemDto, type ListMeta } from '@brightloop/shared';
import { forbidden, notFound } from '../../core/errors.js';
import { isAdmin, isCustomer, isStaffOrAdmin, requireCustomerId, type Actor } from '../../core/utils/actor.js';
import { classifyDbError, inUse, rethrowDbError } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import {
  toCustomerDto, toCustomerListItemDto, toCustomerRecord, toCustomerSnapshot, toSummaryDto,
} from './customers.dto.js';
import type { CustomerRecord, CustomerSnapshot, CustomersGateway } from './customers.gateway.js';
import type { CustomerRow, CustomersRepository } from './customers.repository.js';
import type { CreateCustomerInput, ListCustomersParams, UpdateCustomerInput } from './customers.schema.js';

const NOT_FOUND = 'Customer not found';
const LINK_CONFLICT = 'A customer is already linked to this user account';

/** What a customer may change on their own profile: no email, no staff notes. */
export type CustomerProfilePatch = Omit<UpdateCustomerInput, 'email' | 'notes'>;

export class CustomersService implements CustomersGateway {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly audit: AuditGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(actor: Actor, query: ListCustomersParams): Promise<{ customers: CustomerListItemDto[]; meta: ListMeta }> {
    this.assertStaffOrAdmin(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    const withSummary = query.include?.includes('summary') === true;
    const summaries = withSummary ? await this.repository.summaries(rows.map((row) => row.id), this.now()) : null;
    const customers = rows.map((row) => toCustomerListItemDto(
      row, summaries === null ? undefined : toSummaryDto(summaries.get(row.id)),
    ));
    return { customers, meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<CustomerDto> {
    this.assertStaffOrAdmin(actor);
    return this.detail(await this.requireCustomer(id));
  }

  async create(actor: Actor, input: CreateCustomerInput, ip?: string): Promise<CustomerDto> {
    this.assertStaffOrAdmin(actor);
    let row: CustomerRow;
    try {
      row = await this.repository.create(input);
    } catch (error) {
      return rethrowDbError(error, { unique: LINK_CONFLICT });
    }
    await this.audit.record({
      actor, action: 'customer.create', entityType: 'Customer', entityId: row.id, ip,
      metadata: { name: row.name, email: row.email, linkedUserId: row.userId },
    });
    return this.detail(row);
  }

  async update(actor: Actor, id: number, patch: UpdateCustomerInput, ip?: string): Promise<CustomerDto> {
    this.assertStaffOrAdmin(actor);
    const existing = await this.requireCustomer(id);
    const row = await this.repository.update(id, patch);
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({
      actor, action: 'customer.update', entityType: 'Customer', entityId: id, ip,
      metadata: { changes: patch, previous: pickPrevious(existing, patch) },
    });
    return this.detail(row);
  }

  /**
   * Portal self-service edit (PATCH /me). CUSTOMER only; the customer id always comes from
   * the actor. Email and notes cannot be changed here.
   */
  async updateOwnProfile(actor: Actor, patch: CustomerProfilePatch, ip?: string): Promise<CustomerRecord> {
    if (!isCustomer(actor)) throw forbidden('Insufficient permissions');
    const id = requireCustomerId(actor);
    const existing = await this.requireCustomer(id);
    const changes: CustomerProfilePatch = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.taxId !== undefined ? { taxId: patch.taxId } : {}),
      ...(patch.addressLine1 !== undefined ? { addressLine1: patch.addressLine1 } : {}),
      ...(patch.addressLine2 !== undefined ? { addressLine2: patch.addressLine2 } : {}),
      ...(patch.city !== undefined ? { city: patch.city } : {}),
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.postalCode !== undefined ? { postalCode: patch.postalCode } : {}),
      ...(patch.country !== undefined ? { country: patch.country } : {}),
    };
    const row = await this.repository.update(id, changes);
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({
      actor, action: 'customer.profile.update', entityType: 'Customer', entityId: id, ip,
      metadata: { source: 'portal', changes, previous: pickPrevious(existing, changes) },
    });
    return toCustomerRecord(row);
  }

  /** Soft delete. Blocked while the customer has ACTIVE or PAUSED subscriptions or unpaid invoices. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    await this.requireCustomer(id);
    const blockers = await this.repository.deleteBlockers(id);
    if (blockers.subscriptions > 0 || blockers.invoices > 0) {
      throw inUse('This customer has active or paused subscriptions or unpaid invoices');
    }
    const row = await this.repository.softDelete(id);
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({
      actor, action: 'customer.delete', entityType: 'Customer', entityId: id, ip,
      metadata: { name: row.name, email: row.email },
    });
  }

  async getById(id: number): Promise<CustomerRecord | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toCustomerRecord(row);
  }

  async getOrCreateForUser(userId: number): Promise<CustomerRecord> {
    const existing = await this.repository.findByUserId(userId);
    if (existing !== null) return this.activeRecord(existing);

    const user = await this.repository.findUserById(userId);
    if (user === null) throw notFound('User not found');
    if (user.role !== Role.CUSTOMER) throw forbidden('Only customer accounts have a customer profile');

    let row: CustomerRow;
    let action: 'customer.link' | 'customer.create';
    try {
      const linked = await this.repository.linkByEmail(user.id, user.email);
      row = linked ?? await this.repository.createForUser(user);
      action = linked === null ? 'customer.create' : 'customer.link';
    } catch (error) {
      if (classifyDbError(error) !== 'unique') throw error;
      // A parallel request created or linked the customer first: use its result.
      const winner = await this.repository.findByUserId(userId);
      if (winner === null) return rethrowDbError(error, { unique: LINK_CONFLICT });
      return this.activeRecord(winner);
    }
    await this.audit.record({
      actor: { userId: user.id, role: user.role }, action, entityType: 'Customer', entityId: row.id,
      metadata: { source: 'portal', email: row.email },
    });
    return toCustomerRecord(row);
  }

  async snapshot(id: number): Promise<CustomerSnapshot> {
    return toCustomerSnapshot(await this.requireCustomer(id));
  }

  private activeRecord(row: CustomerRow): CustomerRecord {
    if (row.deletedAt !== null) throw forbidden('This customer account is no longer active');
    return toCustomerRecord(row);
  }

  private async detail(row: CustomerRow): Promise<CustomerDto> {
    const summaries = await this.repository.summaries([row.id], this.now());
    return toCustomerDto(row, toSummaryDto(summaries.get(row.id)));
  }

  private async requireCustomer(id: number): Promise<CustomerRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound(NOT_FOUND);
    return row;
  }

  private assertStaffOrAdmin(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

function pickPrevious(existing: CustomerRow, patch: UpdateCustomerInput): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof UpdateCustomerInput)[]) previous[key] = existing[key];
  return previous;
}
