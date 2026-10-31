import { useLocation } from 'react-router-dom';
import { z } from 'zod';
const stateSchema = z.object({ email: z.email() });
export function useVerificationEmail(): string | null {
  const location = useLocation();
  const state = stateSchema.safeParse(location.state);
  return state.success ? state.data.email : null;
}
