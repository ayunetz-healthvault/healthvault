import { reviewService } from './reviewService';

import { setTokenProvider } from '@/services/api/client';

/**
 * Checking a summary against the original.
 *
 * The behaviour worth testing is not the JSON: it is that a correction always
 * names the version it was made against, and that a summary which changed
 * underneath the reader is reported as such rather than retried.
 */

const fetchMock = jest.fn();

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

const draft = {
  patientId: 'pat_1',
  documentId: 'doc_1',
  field: 'findings.0.value',
  previousValue: '142 mg/dL',
  correctedValue: '124 mg/dL',
  summaryVersion: 1,
};

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
});

describe('reading the original', () => {
  it('returns a URL per page', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { pages: [{ page: 1, url: 'https://x.invalid/1', expiresInSeconds: 300 }] }),
    );

    expect(await reviewService.pages('pat_1', 'doc_1')).toHaveLength(1);
  });
});

describe('correcting what the app read', () => {
  it('sends the version the corrector was looking at', async () => {
    fetchMock.mockResolvedValue(reply(201, {}));

    await reviewService.correct(draft);

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      summaryVersion: 1,
      previousValue: '142 mg/dL',
      correctedValue: '124 mg/dL',
    });
  });

  /**
   * The document was read again while somebody was correcting it. Retrying
   * would apply a correction to words they never saw, so this is an outcome to
   * show rather than a failure to repeat.
   */
  it('reports a summary that changed underneath the reader', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'summary_changed' }));

    expect(await reviewService.correct(draft)).toEqual({ outcome: 'summary_changed' });
  });

  it('lets a real failure through rather than reporting success', async () => {
    fetchMock.mockResolvedValue(reply(500, { code: 'server' }));

    await expect(reviewService.correct(draft)).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('recording that somebody checked it', () => {
  it('names the version that was checked', async () => {
    fetchMock.mockResolvedValue(reply(200, {}));

    await reviewService.markReviewed('pat_1', 'doc_1', 2);

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ summaryVersion: 2 });
  });

  it('reports a version mismatch instead of ticking the wrong text', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'summary_changed' }));

    expect(await reviewService.markReviewed('pat_1', 'doc_1', 1)).toEqual({
      outcome: 'summary_changed',
    });
  });
});
