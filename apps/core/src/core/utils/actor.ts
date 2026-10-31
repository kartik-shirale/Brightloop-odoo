/**
 * The caller identity every service method receives (backend plan section 2).
 * For a CUSTOMER actor the service forces `customerId` from the actor.
 */

import { Role, type RoleDto } from '@brightloop/shared';
import { forbidden } from '../errors.js';
import type { AuthenticatedUser } from '../types/express.js';

export interface Actor {
  readonly userId: number;
  readonly role: RoleDto;
  readonly customerId?: number;
}

export function actorFromUser(user: AuthenticatedUser, customerId?: number): Actor {
  return customerId === undefined
    ? { userId: user.id, role: user.role }
    : { userId: user.id, role: user.role, customerId };
}

export const isCustomer = (actor: Actor): boolean => actor.role === Role.CUSTOMER;
export const isAdmin = (actor: Actor): boolean => actor.role === Role.ADMIN;
export const isStaffOrAdmin = (actor: Actor): boolean =>
  actor.role === Role.ADMIN || actor.role === Role.STAFF;

/** Returns the customer id a CUSTOMER actor is allowed to act on. */
export function requireCustomerId(actor: Actor): number {
  if (actor.customerId === undefined) throw forbidden('No customer profile for this account');
  return actor.customerId;
}

/**
 * Customer scope for list and read queries: the actor's own id for CUSTOMER,
 * otherwise the optional filter the staff caller asked for. A customer-supplied
 * id is ignored.
 */
export function scopedCustomerId(actor: Actor, requested?: number): number | undefined {
  return isCustomer(actor) ? requireCustomerId(actor) : requested;
}
