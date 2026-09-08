import { apiClient, setTokenProvider } from './client';

/**
 * The 401 retry.
 *
 * The failure this guards against is subtle: a token that expires between the
 * moment it is attached and the moment API Gateway checks it. The user sees a
 * request fail for no reason they can act on, and the obvious "fix" — retrying
 * everything — turns a revoked session into a loop against the identity
 * provider from every screen at once.
 */

const fetchMock = jest.fn();

const respond = (status: number, body: unknown = {}): void => {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });
};

const authorizationOf = (callIndex: number): string | undefined =>
  (fetchMock.mock.calls[callIndex]?.[1] as { headers: Record<string, string> }).headers
    .Authorization;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => null);
});

describe('apiRequest', () => {
  it('attaches the current token', async () => {
    setTokenProvider(async () => 'token-a');
    respond(200, { ok: true });

    await apiClient.get('/v1/parents');

    expect(authorizationOf(0)).toBe('Bearer token-a');
  });

  it('sends no Authorization header when there is no session', async () => {
    respond(200, {});
    await apiClient.get('/v1/parents');

    expect(authorizationOf(0)).toBeUndefined();
  });

  it('refreshes once and replays the request when the token was expired', async () => {
    setTokenProvider(
      async () => 'stale-token',
      async () => 'fresh-token',
    );
    respond(401, { message: 'Sign in again to continue.' });
    respond(200, { parents: [] });

    await expect(apiClient.get('/v1/parents')).resolves.toEqual({ parents: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authorizationOf(0)).toBe('Bearer stale-token');
    expect(authorizationOf(1)).toBe('Bearer fresh-token');
  });

  it('gives up after one retry rather than looping against the provider', async () => {
    setTokenProvider(
      async () => 'stale-token',
      async () => 'fresh-token',
    );
    respond(401, {});
    respond(401, {});

    await expect(apiClient.get('/v1/parents')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces the 401 when the session has genuinely ended', async () => {
    setTokenProvider(
      async () => 'stale-token',
      async () => null,
    );
    respond(401, {});

    await expect(apiClient.get('/v1/parents')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * A 403 is a grant decision, not an expiry. Asking again with a fresher token
   * gets the same answer, and retrying would hide a real access denial behind a
   * doubled request.
   */
  it('does not retry a 403', async () => {
    setTokenProvider(
      async () => 'token',
      async () => 'fresh',
    );
    respond(403, {});

    await expect(apiClient.get('/v1/parents')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * A record being erased answers 410. Left to the `unknown` fallback it would
   * be retried for an hour before anybody was told the record had gone.
   */
  it('reads a 410 as gone rather than something to retry', async () => {
    setTokenProvider(async () => 'token');
    respond(410, { code: 'record_deleting' });

    await expect(apiClient.get('/v1/patients/pat_1')).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh a request that never carried a token', async () => {
    const refresher = jest.fn(async () => 'fresh');
    setTokenProvider(async () => 'token', refresher);
    respond(401, {});

    await expect(apiClient.get('/health', { anonymous: true })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(refresher).not.toHaveBeenCalled();
  });

  it('does not retry a server error', async () => {
    setTokenProvider(
      async () => 'token',
      async () => 'fresh',
    );
    respond(500, {});

    await expect(apiClient.get('/v1/parents')).rejects.toMatchObject({ kind: 'server' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replays the original method and body, not a bare GET', async () => {
    setTokenProvider(
      async () => 'stale',
      async () => 'fresh',
    );
    respond(401, {});
    respond(201, { created: true });

    await apiClient.post('/v1/documents', { title: 'Report' });

    const second = fetchMock.mock.calls[1]?.[1] as { method: string; body: string };
    expect(second.method).toBe('POST');
    expect(JSON.parse(second.body)).toEqual({ title: 'Report' });
  });
});
