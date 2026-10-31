export const CONFIG = Object.freeze({
  API_URL: (import.meta.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, ''),
  /** Every core route lives under this prefix; API_URL is only the origin (empty = Vite proxy). */
  API_PREFIX: '/api/v1',
  REQUEST_TIMEOUT: 15000,
  COVER_IMAGE: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1600&q=85',
});
