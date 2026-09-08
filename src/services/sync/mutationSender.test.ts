import { sendMutation } from './mutationSender';
import type { Mutation } from './types';

import { setTokenProvider } from '@/services/api/client';

/**
 * Turning a queued change into a request.
 *
 * The queue and the flush engine were already tested without one of these,
 * which meant the queue worked and nothing was ever sent. These tests are about
 * the seam: the right verb, the right path, and an honest answer for a change
 * this app has nowhere to send.
 */

const fetchMock = jest.fn();

const mutation = (patch: Partial<Mutation> = {}): Mutation => ({
  id: 'mut_1',
  patientId: 'pat_1',
  entity: 'follow_up',
  entityId: 'fup_1',
  operation: 'create',
  payload: { title: 'Eye clinic', kind: 'doctor_visit', dueDate: '2026-10-01' },
  baseVersion: null,
  createdAt: '2026-09-08T10:00:00.000Z',
  attempts: 0,
  nextAttemptAt: 0,
  state: 'saved_locally',
  ...patch,
});

const ok = () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify({}),
});

const requested = (): { url: string; method: string } => {
  const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
  return { url: String(url), method: init.method };
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
});

describe('sending a follow-up', () => {
  it('creates one with a POST to the record’s list', async () => {
    await sendMutation(mutation());

    expect(requested()).toMatchObject({
      method: 'POST',
      url: expect.stringContaining('/v1/patients/pat_1/follow-ups'),
    });
  });

  it('updates one with a PATCH to its own path', async () => {
    await sendMutation(mutation({ operation: 'update', payload: { status: 'completed' } }));

    expect(requested()).toMatchObject({
      method: 'PATCH',
      url: expect.stringContaining('/v1/patients/pat_1/follow-ups/fup_1'),
    });
  });

  it('deletes one with a DELETE', async () => {
    await sendMutation(mutation({ operation: 'delete', payload: null }));

    expect(requested()).toMatchObject({ method: 'DELETE' });
  });

  it('sends what the caller queued, unchanged', async () => {
    await sendMutation(mutation());

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ title: 'Eye clinic' });
  });
});

describe('a change with nowhere to go', () => {
  /**
   * `classify` retries anything it does not recognise, which is right for a
   * dropped connection and wrong for "this app has no endpoint for that". A
   * change like that would be attempted six times over an hour and then sit as
   * failed, telling somebody their note could not be sent for a reason that
   * will never change.
   */
  it.each(['observation', 'treatment', 'dose_event', 'patient'] as const)(
    'refuses a %s rather than retrying forever',
    async (entity) => {
      await expect(sendMutation(mutation({ entity }))).rejects.toMatchObject({
        kind: 'forbidden',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('says the change is still on the phone', async () => {
    await expect(sendMutation(mutation({ entity: 'observation' }))).rejects.toThrow(
      /saved on this phone/i,
    );
  });
});
