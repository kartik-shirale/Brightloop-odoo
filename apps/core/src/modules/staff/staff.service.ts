import type { ListMeta, StaffDto } from '@brightloop/shared';
import { forbidden, notFound } from '../../core/errors.js';
import { isAdmin, type Actor } from '../../core/utils/actor.js';
import { duplicate, rethrowDbError } from '../../core/utils/domain-errors.js';
import { hashPassword } from '../../core/utils/hash.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { UserRow } from '../../core/types/db-rows.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import { toStaffDto } from './staff.dto.js';
import type { StaffRepository } from './staff.repository.js';
import type { CreateStaffInput, ListStaffParams, UpdateStaffInput } from './staff.schema.js';

const DUPLICATE_EMAIL = 'A user with this email already exists';
const DUPLICATE_USERNAME = 'A user with this username already exists';
const DUPLICATE_ANY = 'A user with this email or username already exists';
const NOT_FOUND = 'Staff member not found';

export class StaffService {
  constructor(
    private readonly repository: StaffRepository,
    private readonly audit: AuditGateway,
  ) {}

  async list(actor: Actor, query: ListStaffParams): Promise<{ staff: StaffDto[]; meta: ListMeta }> {
    this.assertAdmin(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    return { staff: rows.map(toStaffDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<StaffDto> {
    this.assertAdmin(actor);
    return toStaffDto(await this.requireStaff(id));
  }

  /** The role is always STAFF and the account is verified and active from the start. */
  async create(actor: Actor, input: CreateStaffInput, ip?: string): Promise<StaffDto> {
    this.assertAdmin(actor);
    if (await this.repository.findByEmail(input.email) !== null) throw duplicate(DUPLICATE_EMAIL);
    if (input.username !== undefined && await this.repository.findByUsername(input.username) !== null) {
      throw duplicate(DUPLICATE_USERNAME);
    }
    const passwordHash = await hashPassword(input.password);
    let row: UserRow;
    try {
      row = await this.repository.create({
        name: input.name, email: input.email, username: input.username ?? null, passwordHash,
      });
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_ANY });
    }
    await this.audit.record({
      actor, action: 'staff.create', entityType: 'User', entityId: row.id, ip,
      metadata: { name: row.name, email: row.email, username: row.username },
    });
    return toStaffDto(row);
  }

  async update(actor: Actor, id: number, patch: UpdateStaffInput, ip?: string): Promise<StaffDto> {
    this.assertAdmin(actor);
    const existing = await this.requireStaff(id);
    if (patch.username !== undefined && patch.username !== null && patch.username !== existing.username) {
      const owner = await this.repository.findByUsername(patch.username);
      if (owner !== null && owner.id !== id) throw duplicate(DUPLICATE_USERNAME);
    }
    let row: UserRow | null;
    try {
      row = await this.repository.update(id, patch);
    } catch (error) {
      return rethrowDbError(error, { unique: DUPLICATE_USERNAME });
    }
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({
      actor, action: 'staff.update', entityType: 'User', entityId: id, ip,
      metadata: {
        changes: patch,
        previous: {
          ...(patch.name !== undefined ? { name: existing.name } : {}),
          ...(patch.username !== undefined ? { username: existing.username } : {}),
        },
      },
    });
    return toStaffDto(row);
  }

  /** Idempotent: deactivating an inactive member succeeds and still revokes any live session. */
  async deactivate(actor: Actor, id: number, ip?: string): Promise<StaffDto> {
    this.assertAdmin(actor);
    this.assertNotSelf(actor, id, 'You cannot deactivate your own account');
    await this.requireStaff(id);
    const row = await this.repository.deactivate(id);
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({ actor, action: 'staff.deactivate', entityType: 'User', entityId: id, ip });
    return toStaffDto(row);
  }

  /** Idempotent: activating an active member succeeds. */
  async activate(actor: Actor, id: number, ip?: string): Promise<StaffDto> {
    this.assertAdmin(actor);
    await this.requireStaff(id);
    const row = await this.repository.activate(id);
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({ actor, action: 'staff.activate', entityType: 'User', entityId: id, ip });
    return toStaffDto(row);
  }

  /** Soft delete: the row stays (its email remains reserved) and every session is revoked. */
  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    this.assertNotSelf(actor, id, 'You cannot delete your own account');
    const existing = await this.requireStaff(id);
    const row = await this.repository.softDelete(id);
    if (row === null) throw notFound(NOT_FOUND);
    await this.audit.record({
      actor, action: 'staff.delete', entityType: 'User', entityId: id, ip,
      metadata: { name: existing.name, email: existing.email },
    });
  }

  private async requireStaff(id: number): Promise<UserRow> {
    const row = await this.repository.findStaffById(id);
    if (row === null) throw notFound(NOT_FOUND);
    return row;
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertNotSelf(actor: Actor, id: number, message: string): void {
    if (actor.userId === id) throw forbidden(message);
  }
}
