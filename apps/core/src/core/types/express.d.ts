/**
 * Augmentations for framework types, strictly scoped.
 */

import type { RoleDto as Role } from '@brightloop/shared';

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** Session that minted the access token in use. */
  sid: number;
}

declare global {
  namespace Express {
    interface Request {
      /** Request correlation id (also echoed via `x-request-id`). */
      id: string;
      /** Populated by the authenticate middleware on protected routes. */
      user?: AuthenticatedUser;
    }
  }
}
