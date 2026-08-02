import { ApiError, kindForStatus, toApiError } from './errors';

import { config } from '@/config/env';

/**
 * Thin fetch wrapper for API Gateway.
 *
 * Deliberately dependency-free: no axios, no generated SDK. The client's only
 * jobs are attaching the Cognito ID token, enforcing a timeout, and turning
 * non-2xx responses into a typed `ApiError`.
 *
 * TODO(backend): wire `setTokenProvider` to the real Cognito session in
 * `services/auth/authService.ts` once the user pool exists.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Overrides the default timeout for slow operations such as presigning. */
  timeoutMs?: number;
  /** Skips the Authorization header — only the health check needs this. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

/** Registered once at startup by the auth service. */
export const setTokenProvider = (provider: TokenProvider): void => {
  tokenProvider = provider;
};

const buildUrl = (path: string): string =>
  `${config.api.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const messageFrom = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const { message } = payload as { message?: unknown };
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { method = 'GET', body, timeoutMs = config.api.timeoutMs, anonymous = false } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour a caller-supplied signal alongside our own timeout.
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Ayunetz-Client': `mobile/${config.environment}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (!anonymous) {
      const token = await tokenProvider();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(buildUrl(path), {
      method,
      headers,
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const payload = await parseBody(response);

    if (!response.ok) {
      throw new ApiError(
        kindForStatus(response.status),
        messageFrom(payload, `Request failed with status ${response.status}`),
        { status: response.status, requestId: response.headers.get('x-amzn-requestid') },
      );
    }

    return payload as T;
  } catch (error) {
    throw toApiError(error);
  } finally {
    clearTimeout(timer);
  }
};

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
