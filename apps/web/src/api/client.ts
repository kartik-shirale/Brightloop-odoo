import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_ROUTES, type ApiError, type ApiResponse, type AuthResult } from '@brightloop/shared';
import { CONFIG } from '@/constants/config';
import { MESSAGES } from '@/constants/messages';
import type { ApiFailure } from '@/types/auth';
import { getSession, getSessionRevision, publishSession } from '@/api/session';

const options = { baseURL: CONFIG.API_URL, timeout: CONFIG.REQUEST_TIMEOUT, withCredentials: true,
  headers: { 'Content-Type': 'application/json' } };
export const client = axios.create(options);
const refreshClient = axios.create(options);
let refreshPromise: Promise<AuthResult> | null = null;

export function normalizeError(error: unknown): ApiFailure {
  if (!axios.isAxiosError<ApiError>(error)) return { message: MESSAGES.ERROR, status: 0, code: 'UNKNOWN', details: [] };
  const response = error.response;
  const body = response?.data;
  const status = response?.status ?? 0;
  const details = body?.error?.details;
  const fields = Array.isArray(details) ? details.filter((item): item is { field: string; message: string } =>
    typeof item === 'object' && item !== null && typeof item.field === 'string' && typeof item.message === 'string') : [];
  let message = body?.message ?? MESSAGES.ERROR;
  if (!response) message = MESSAGES.NETWORK;
  if (status >= 500 && body?.error?.code !== 'EMAIL_DELIVERY_FAILED') message = 'The service is temporarily unavailable. Please try again shortly.';
  if (status === 429 && !body?.message) message = MESSAGES.RETRY;
  return { message, status, code: body?.error?.code ?? error.code ?? 'REQUEST_FAILED', details: fields,
    retryAfter: Number(response?.headers['retry-after']) || undefined };
}

/** Shared by initial restoration and the 401 interceptor: only one rotation in flight. */
export async function restoreSession(): Promise<AuthResult> {
  if (refreshPromise) return refreshPromise;
  const revision = getSessionRevision();
  refreshPromise = (async () => {
    try {
      const { data } = await refreshClient.post<ApiResponse<AuthResult>>(API_ROUTES.auth.refresh, {});
      if (!data.data) throw new Error('Missing session');
      if (getSessionRevision() !== revision) throw new Error('Session changed during refresh');
      publishSession(data.data);
      return data.data;
    } catch (error) {
      const failure = normalizeError(error);
      if (failure.status === 401 && getSessionRevision() === revision) publishSession(null);
      throw failure;
    } finally { refreshPromise = null; }
  })();
  return refreshPromise;
}

client.interceptors.request.use((request) => {
  const token = getSession()?.accessToken;
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  return request;
});
interface RetriableRequest extends InternalAxiosRequestConfig { retried?: boolean }
client.interceptors.response.use((response) => response, async (error: AxiosError<ApiError>) => {
  const request = error.config as RetriableRequest | undefined;
  const publicActions: readonly string[] = [API_ROUTES.auth.login, API_ROUTES.auth.register, API_ROUTES.auth.verifyOtp,
    API_ROUTES.auth.verifyResetOtp, API_ROUTES.auth.refresh, API_ROUTES.auth.logout, API_ROUTES.auth.resendOtp,
    API_ROUTES.auth.forgotPassword, API_ROUTES.auth.resetPassword];
  const isAuthAction = publicActions.includes(request?.url ?? '');
  if (error.response?.status === 401 && request && !request.retried && !isAuthAction && getSession()) {
    request.retried = true;
    const currentToken = getSession()?.accessToken;
    const sentToken = request.headers.get('Authorization');
    if (sentToken === `Bearer ${currentToken}`) await restoreSession();
    if (getSession()) return await client(request);
  }
  if (error.response?.status === 401 && request?.retried) publishSession(null);
  throw normalizeError(error);
});

export async function waitForSessionRefresh(): Promise<void> { if (refreshPromise) await refreshPromise; }
