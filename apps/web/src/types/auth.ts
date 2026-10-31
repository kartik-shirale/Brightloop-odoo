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
export interface ApiFailureDetail { field: string; message: string }
export interface ApiFailure { message: string; status: number; code: string; details: ApiFailureDetail[]; retryAfter?: number }
export type RecoveryStep = { kind: 'email' } | { kind: 'otp'; email: string } | { kind: 'reset'; email: string; resetToken: string };
