import type { UserDto } from './auth.js';
import type { ListQuery } from './common.js';
export interface StaffDto extends UserDto { role: 'STAFF' }
export interface CreateStaffRequest { name: string; email: string; username?: string; password: string }
export interface UpdateStaffRequest { name?: string; username?: string | null }
export interface ListStaffQuery extends ListQuery<'name' | 'email' | 'createdAt' | 'lastLoginAt'> { isActive?: boolean }
