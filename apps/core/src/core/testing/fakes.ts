/**
 * Builders for fake repositories and gateways, so unit tests never touch the
 * database, Redis or a real mailer.
 */

import type { ListMeta, SequenceKey } from '@brightloop/shared';
import type { AuditGateway, AuditRecordInput } from '../../modules/audit/audit.gateway.js';
import type { SequenceGateway } from '../../modules/sequences/sequences.gateway.js';
import { formatSequenceNumber } from '../utils/sequence-sql.js';
import { listMetaFor } from '../utils/pagination.js';

/**
 * A stand-in for a repository class. Methods you pass in work; calling any
 * other method throws, so a test fails loudly instead of hitting a real
 * database through an unstubbed path.
 */
export function fakeRepository<T extends object>(overrides: Partial<T>): T {
  return new Proxy(overrides as T, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver) as unknown;
      if (typeof property === 'symbol' || property === 'then') return undefined;
      return () => {
        throw new Error(`Unexpected call to "${property}" on a fake repository: stub it in the test`);
      };
    },
  });
}

/** Records every audit entry instead of writing it. */
export class RecordingAudit implements AuditGateway {
  readonly entries: AuditRecordInput[] = [];

  async record(input: AuditRecordInput): Promise<void> {
    this.entries.push(input);
  }

  actions(): string[] {
    return this.entries.map((entry) => entry.action);
  }
}

/** Gateway fake that numbers per key like the real one, with no database. */
export class FakeSequenceGateway implements SequenceGateway {
  private readonly counters = new Map<SequenceKey, number>();

  constructor(private readonly year: number = 2026) {}

  async next(key: SequenceKey): Promise<string> {
    const value = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, value);
    return formatSequenceNumber(key, this.year, value);
  }
}

export interface FakeMailMessage {
  to: string;
  kind: string;
  params: Record<string, string | number>;
}

/** Collects outgoing mail; `failNext` makes the next sends throw to test delivery failures. */
export class FakeMailer {
  readonly sent: FakeMailMessage[] = [];
  private failures = 0;
  private error: Error = new Error('mail delivery failed');

  failNext(times = 1, error: Error = new Error('mail delivery failed')): void {
    this.failures = times;
    this.error = error;
  }

  async send(message: FakeMailMessage): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw this.error;
    }
    this.sent.push(message);
  }
}

/** Auto-incrementing in-memory table for repository fakes. */
export class InMemoryTable<T extends { id: number }> {
  readonly rows: T[] = [];
  private nextId = 1;

  insert(data: Omit<T, 'id'>): T {
    const row = { ...data, id: this.nextId } as T;
    this.nextId += 1;
    this.rows.push(row);
    return row;
  }

  find(id: number): T | null {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  update(id: number, patch: Partial<T>): T | null {
    const row = this.find(id);
    if (row === null) return null;
    Object.assign(row, patch);
    return row;
  }

  remove(id: number): boolean {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

/** Applies page and limit to rows and builds the same meta the services return. */
export function paginateRows<T>(rows: readonly T[], page: number, limit: number): { data: T[]; meta: ListMeta } {
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    meta: listMetaFor(rows.length, page, limit),
  };
}

/** A clock you can move, for time-dependent service tests. */
export function fixedClock(start: string): { now: () => Date; set(value: string): void; advanceDays(days: number): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set(value) {
      current = new Date(value);
    },
    advanceDays(days) {
      current = new Date(current.getTime() + days * 86_400_000);
    },
  };
}
