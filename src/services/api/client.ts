import { ApiError, kindForStatus, toApiError } from './errors';

import { config } from '@/config/env';

/**
 * Thin fetch wrapper for API Gateway.
 *
 * Deliberately dependency-free: no axios, no generated SDK. The client's jobs
 * are attaching the Cognito ID token, enforcing a timeout, recovering from a
 * token that expired mid-flight, and turning non-2xx responses into a typed
 * `ApiError`.
 *
 * `setTokenProvider` is wired to the real session by `authService.initialise`.
 * The provider it registers already refreshes ahead of expiry, so the 401 retry
 * below is the second line of defence, not the first: it covers the cases the
 * clock cannot predict — a revoked session, a pool whose token lifetime was
 * shortened, a device whose clock is wrong.
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
/** Forces a refresh and returns the new token, or null if the session ended. */
type TokenRefresher = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;
let tokenRefresher: TokenRefresher = async () => null;

/** Registered once at startup by the auth service. */
export const setTokenProvider = (provider: TokenProvider, refresher?: TokenRefresher): void => {
  tokenProvider = provider;
  tokenRefresher = refresher ?? (async () => null);
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

/**
 * Sends one request. Separated from `apiRequest` so the 401 retry can send the
 * same request twice without re-running the retry logic inside itself.
 */
const sendOnce = async <T>(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<T> => {
  const { method = 'GET', body, timeoutMs = config.api.timeoutMs } = options;

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
    if (token !== null) headers.Authorization = `Bearer ${token}`;

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
        {
          status: response.status,
          requestId: response.headers.get('x-amzn-requestid'),
          details: detailsFrom(payload),
        },
      );
    }

    return payload as T;
  } catch (error) {
    throw toApiError(error);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The `details` object from an error body, when there is one.
 *
 * Carried through so a caller can act on a refusal — which records would be
 * stranded, which summary version is current — rather than being left with a
 * status code and a sentence.
 */
const detailsFrom = (payload: unknown): Record<string, unknown> | null => {
  if (payload === null || typeof payload !== 'object') return null;
  const details = (payload as { details?: unknown }).details;
  return details !== null && typeof details === 'object'
    ? (details as Record<string, unknown>)
    : null;
};

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const anonymous = options.anonymous ?? false;
  const token = anonymous ? null : await tokenProvider();

  try {
    return await sendOnce<T>(path, options, token);
  } catch (error) {
    const failure = toApiError(error);

    /**
     * One retry, and only for an expired credential.
     *
     * Not retried on 403: that is a grant decision, and asking again with a
     * fresher token gets the same answer. Not retried on a request that never
     * carried a token, because there is nothing to refresh. And exactly once —
     * a refresh that yields another 401 means the session is over, and looping
     * would hammer the identity provider on every screen.
     */
    if (failure.kind !== 'unauthorized' || anonymous) throw failure;

    const refreshed = await tokenRefresher().catch(() => null);
    if (refreshed === null) throw failure;

    return sendOnce<T>(path, options, refreshed);
  }
};

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  /**
   * `DELETE`, optionally with a body.
   *
   * A body on a DELETE is unusual but right here: deleting a record requires
   * the person to type its name, and a name is exactly the kind of thing that
   * must not travel in a URL, where it lands in access logs and browser
   * history. The only alternative — a POST that deletes — hides the verb.
   */
  delete: <T>(
    path: string,
    options?: Omit<RequestOptions, 'method'> & { body?: unknown },
  ) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
