import type { ApiEndpoint, RoleDto } from '@brightloop/shared';
import type { z } from 'zod';
export interface FormFieldDefinition { key: string; label: string; type?: 'text' | 'number' | 'money' | 'percent' | 'date' | 'email' | 'password' | 'textarea' | 'boolean' | 'lines' | 'multi'; options?: readonly string[]; required?: boolean; }
export interface ResourceDefinition { title: string; singular: string; path: string; api: string; columns: string[]; fields: FormFieldDefinition[]; schema?: z.ZodType; editSchema?: z.ZodType; create?: ApiEndpoint; update?: ApiEndpoint; remove?: ApiEndpoint; writeRoles: readonly RoleDto[]; deleteRoles?: readonly RoleDto[]; statuses?: readonly string[]; filters?: string[]; }
