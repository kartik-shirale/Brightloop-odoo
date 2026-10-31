import type { ListMeta, PlanDto, PlanListItemDto } from '@brightloop/shared';
import { forbidden, notFound, validationError } from '../../core/errors.js';
import { isAdmin, isStaffOrAdmin, type Actor } from '../../core/utils/actor.js';
import { toIsoDate } from '../../core/utils/dates.js';
import { inUse, planNotAvailable } from '../../core/utils/domain-errors.js';
import { listMetaFor } from '../../core/utils/pagination.js';
import type { AuditGateway } from '../audit/audit.gateway.js';
import { toPlanDto, toPlanListItemDto } from './plans.dto.js';
import type { PlanRecord, PlansGateway } from './plans.gateway.js';
import type { PlanRow, PlansRepository } from './plans.repository.js';
import {
  availabilityProblem, type CreatePlanInput, type ListPlansParams, type UpdatePlanInput,
} from './plans.schema.js';

const PLAN_NOT_FOUND = 'Plan not found';
const PERIOD_IN_USE = 'The billing period cannot change while open subscriptions use this plan';
const DELETE_IN_USE = 'This plan has open subscriptions. Close them or deactivate the plan instead of deleting it';

export class PlansService implements PlansGateway {
  constructor(
    private readonly repository: PlansRepository,
    private readonly audit: AuditGateway,
  ) {}

  async list(actor: Actor, query: ListPlansParams): Promise<{ plans: PlanListItemDto[]; meta: ListMeta }> {
    this.assertCanRead(actor);
    const [rows, total] = await Promise.all([this.repository.list(query), this.repository.count(query)]);
    return { plans: rows.map(toPlanListItemDto), meta: listMetaFor(total, query.page, query.limit) };
  }

  async get(actor: Actor, id: number): Promise<PlanDto> {
    this.assertCanRead(actor);
    const row = await this.requirePlan(id);
    return toPlanDto(row, await this.repository.countActiveSubscriptions(id));
  }

  async create(actor: Actor, input: CreatePlanInput, ip?: string): Promise<PlanDto> {
    this.assertAdmin(actor);
    const row = await this.repository.create(input, actor.userId);
    await this.audit.record({
      actor, action: 'plan.create', entityType: 'Plan', entityId: row.id, ip,
      metadata: { name: row.name, price: row.price, billingPeriod: row.billingPeriod, isActive: row.isActive },
    });
    return toPlanDto(row, 0);
  }

  /** Flag changes apply to existing subscriptions immediately; the billing period is locked while any are open. */
  async update(actor: Actor, id: number, patch: UpdatePlanInput, ip?: string): Promise<PlanDto> {
    this.assertAdmin(actor);
    const existing = await this.requirePlan(id);

    if (patch.availableFrom !== undefined || patch.availableTo !== undefined) {
      const from = patch.availableFrom ?? new Date(existing.availableFrom);
      const to = patch.availableTo !== undefined
        ? patch.availableTo
        : existing.availableTo === null ? null : new Date(existing.availableTo);
      const problem = availabilityProblem(from, to);
      if (problem !== null) throw validationError('Validation failed', [{ field: 'availableTo', message: problem }]);
    }
    if (patch.billingPeriod !== undefined && patch.billingPeriod !== existing.billingPeriod
      && (await this.repository.countOpenSubscriptions(id)) > 0) {
      throw inUse(PERIOD_IN_USE);
    }

    const row = await this.repository.update(id, patch);
    if (row === null) throw notFound(PLAN_NOT_FOUND);
    await this.audit.record({
      actor, action: 'plan.update', entityType: 'Plan', entityId: id, ip,
      metadata: { changes: patch, previous: pickPrevious(existing, patch) },
    });
    return toPlanDto(row, await this.repository.countActiveSubscriptions(id));
  }

  async remove(actor: Actor, id: number, ip?: string): Promise<void> {
    this.assertAdmin(actor);
    const existing = await this.requirePlan(id);
    if ((await this.repository.countOpenSubscriptions(id)) > 0) throw inUse(DELETE_IN_USE);
    const row = await this.repository.softDelete(id);
    if (row === null) throw notFound(PLAN_NOT_FOUND);
    await this.audit.record({
      actor, action: 'plan.delete', entityType: 'Plan', entityId: id, ip,
      metadata: { name: existing.name, billingPeriod: existing.billingPeriod },
    });
  }

  async getById(id: number): Promise<PlanRecord | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toPlanRecord(row);
  }

  async assertAvailable(id: number, date: Date): Promise<PlanRecord> {
    const row = await this.requirePlan(id);
    const day = toIsoDate(date);
    const startsLater = day < toIsoDate(new Date(row.availableFrom));
    const endedBefore = row.availableTo !== null && day > toIsoDate(new Date(row.availableTo));
    if (!row.isActive || startsLater || endedBefore) throw planNotAvailable();
    return toPlanRecord(row);
  }

  private async requirePlan(id: number): Promise<PlanRow> {
    const row = await this.repository.findById(id);
    if (row === null) throw notFound(PLAN_NOT_FOUND);
    return row;
  }

  private assertCanRead(actor: Actor): void {
    if (!isStaffOrAdmin(actor)) throw forbidden('Insufficient permissions');
  }

  private assertAdmin(actor: Actor): void {
    if (!isAdmin(actor)) throw forbidden('Insufficient permissions');
  }
}

function toPlanRecord(row: PlanRow): PlanRecord {
  return {
    id: row.id, name: row.name, price: row.price, billingPeriod: row.billingPeriod,
    minQuantity: row.minQuantity, availableFrom: row.availableFrom, availableTo: row.availableTo,
    autoClose: row.autoClose, closable: row.closable, pausable: row.pausable, renewable: row.renewable,
    isActive: row.isActive,
  };
}

function pickPrevious(existing: PlanRow, patch: UpdatePlanInput): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof UpdatePlanInput)[]) previous[key] = existing[key];
  return previous;
}
