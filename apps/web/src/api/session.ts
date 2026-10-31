import type { AuthResult } from '@brightloop/shared';
let session: AuthResult | null = null;
let revision = 0;
const subscribers = new Set<() => void>();
export function getSession(): AuthResult | null { return session; }
export function getSessionRevision(): number { return revision; }
export function publishSession(value: AuthResult | null): void {
  session = value;
  revision += 1;
  for (const subscriber of subscribers) subscriber();
}
export function subscribeSession(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
