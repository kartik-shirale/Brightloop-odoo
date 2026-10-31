import { useCallback, useContext } from 'react';
import type { RoleDto } from '@brightloop/shared';
import { AuthContext } from '@/context/auth-context-value';
import type { AuthContextValue } from '@/types/auth';
export function useAuth(): AuthContextValue & { hasRole: (...roles: RoleDto[]) => boolean } {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  const hasRole = useCallback((...roles: RoleDto[]) => value.role !== null && roles.includes(value.role), [value.role]);
  return { ...value, hasRole };
}
