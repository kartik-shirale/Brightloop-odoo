import type { AuthResult, RoleDto, UserDto } from '@brightloop/shared';
export interface AuthContextValue {
  user: UserDto | null;
  role: RoleDto | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  setSession: (session: AuthResult | null) => void;
  logout: () => Promise<void>;
  retrySession: () => void;
}
export type { ValidationErrorDetail as ApiFailureDetail } from '@brightloop/shared';
export type { NormalizedApiError as ApiFailure } from '@/types/api';
export type RecoveryStep = { kind: 'email' } | { kind: 'otp'; email: string } | { kind: 'reset'; email: string; resetToken: string };
