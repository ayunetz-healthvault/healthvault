import { accountService } from './accountService';

import { setTokenProvider } from '@/services/api/client';

/**
 * Getting your data out, and getting it deleted.
 *
 * The tests are about the answers this service gives when it cannot do what
 * was asked. A deletion that would strand a record is refused and says which
 * ones; a record deletion carries the typed name; and nothing here reports
 * more than the server actually did.
 */

jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  isBackendEnabled: () => true,
}));

const fetchMock = jest.fn();

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
});

describe('exporting', () => {
  it('returns the records the account can reach', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        exportedAt: '2026-09-08T10:00:00.000Z',
        records: [{ patientId: 'pat_1', role: 'viewer', record: {} }],
      }),
    );

    const result = await accountService.requestDataExport();

    expect(result).toMatchObject({ outcome: 'ready' });
    expect(result.records).toHaveLength(1);
  });

  /** The role travels with the record, so nothing reads as wider access. */
  it('keeps the role each record was exported under', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        exportedAt: '2026-09-08T10:00:00.000Z',
        records: [{ patientId: 'pat_1', role: 'viewer', record: {} }],
      }),
    );

    expect((await accountService.requestDataExport()).records[0]?.role).toBe('viewer');
  });
});

describe('deleting an account', () => {
  it('reports what was removed when it succeeds', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { requestedAt: '2026-09-08T10:00:00.000Z', grantsRevoked: 2 }),
    );

    expect(await accountService.requestAccountDeletion()).toMatchObject({
      outcome: 'access_removed',
      grantsRevoked: 2,
    });
  });

  /**
   * The refusal is the interesting case. These records would be left with
   * nobody who can reach them, and the person needs to know which ones rather
   * than being told "something went wrong".
   */
  it('reports the records that would be left with nobody', async () => {
    fetchMock.mockResolvedValue(
      reply(409, {
        code: 'records_would_be_stranded',
        message: 'Some records would be left with nobody.',
        details: { patientIds: ['pat_1', 'pat_2'] },
      }),
    );

    expect(await accountService.requestAccountDeletion()).toEqual({
      outcome: 'records_would_be_stranded',
      patientIds: ['pat_1', 'pat_2'],
    });
  });

  it('lets a real failure through rather than reporting a deletion', async () => {
    fetchMock.mockResolvedValue(reply(500, { code: 'server' }));

    await expect(accountService.requestAccountDeletion()).rejects.toMatchObject({
      kind: 'server',
    });
  });
});

describe('deleting one record', () => {
  it('sends the typed name in the body, never in the path', async () => {
    fetchMock.mockResolvedValue(reply(200, { itemsRemoved: 12, pagesRemoved: 4 }));

    await accountService.deleteRecord('pat_1', 'Meera Nair');

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe('DELETE');
    // A person's name in a URL lands in access logs and browser history.
    expect(String(url)).not.toContain('Meera');
    expect(JSON.parse(init.body)).toEqual({ confirmName: 'Meera Nair' });
  });

  it('reports what the server said it removed', async () => {
    fetchMock.mockResolvedValue(reply(200, { itemsRemoved: 12, pagesRemoved: 4 }));

    expect(await accountService.deleteRecord('pat_1', 'Meera Nair')).toMatchObject({
      outcome: 'deleted',
      itemsRemoved: 12,
      pagesRemoved: 4,
    });
  });

  /** A refusal must not be reported to a screen as a deletion. */
  it('throws when the server refuses', async () => {
    fetchMock.mockResolvedValue(reply(403, { code: 'forbidden' }));

    await expect(accountService.deleteRecord('pat_1', 'Meera Nair')).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });
});
