import { consentService } from './consentService';

import { setTokenProvider } from '@/services/api/client';

/**
 * The client side of consent.
 *
 * Two behaviours are worth a test, and neither is about JSON shape. A notice
 * that changed between the screen opening and the person answering must not be
 * recorded as agreement to the new wording. And a request that fails must not
 * leave a screen believing a decision was saved.
 */

const fetchMock = jest.fn();

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

const view = {
  noticeVersion: '2026-09-08.1',
  consent: [
    {
      purpose: 'ai_processing',
      granted: true,
      needsReconsent: false,
      withdrawalEffect: 'New documents will be stored but not summarised.',
      decidedAt: '2026-09-08T10:00:00.000Z',
      decidedBy: 'acc_alice',
      onBehalfOfPatient: false,
    },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
});

describe('reading what has been agreed', () => {
  it('returns the server’s answer, including the notice version', async () => {
    fetchMock.mockResolvedValue(reply(200, view));

    expect(await consentService.current('pat_1')).toMatchObject({
      noticeVersion: '2026-09-08.1',
    });
  });
});

describe('recording a decision', () => {
  it('sends the version the person was shown', async () => {
    fetchMock.mockResolvedValue(reply(201, view));

    await consentService.decide({
      patientId: 'pat_1',
      purpose: 'ai_processing',
      granted: true,
      noticeVersion: '2026-09-08.1',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      noticeVersion: string;
    };
    expect(body.noticeVersion).toBe('2026-09-08.1');
  });

  /**
   * The wording changed underneath them. Agreement to text they never read is
   * not agreement, so this is its own outcome rather than an error to retry.
   */
  it('reports a changed notice rather than treating it as a failure', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'stale_notice' }));

    const result = await consentService.decide({
      patientId: 'pat_1',
      purpose: 'ai_processing',
      granted: true,
      noticeVersion: '2020-01-01.1',
    });

    expect(result).toEqual({ outcome: 'notice_changed' });
  });

  it('lets a real failure through rather than reporting success', async () => {
    fetchMock.mockResolvedValue(reply(500, { code: 'server' }));

    await expect(
      consentService.decide({
        patientId: 'pat_1',
        purpose: 'ai_processing',
        granted: true,
        noticeVersion: '2026-09-08.1',
      }),
    ).rejects.toMatchObject({ kind: 'server' });
  });
});
