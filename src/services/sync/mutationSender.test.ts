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

const ok = (body: unknown = { followUp: { followUpId: 'fup_1' } }) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
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

/**
 * The id that has to survive the round trip.
 *
 * The bug: the device wrote a follow-up with its own id, the server minted a
 * different one, and every later change addressed a row the server had never
 * heard of. The fix is one field, and these are the properties that make it
 * worth having.
 */
describe('the id a created follow-up is saved under', () => {
  it('is sent with the create', async () => {
    await sendMutation(mutation());

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ followUpId: 'fup_1', title: 'Eye clinic' });
  });

  /**
   * The same id on a retry is what makes a lost response harmless: the server
   * recognises it rather than creating Thursday's appointment twice.
   */
  it('is the same on a retry of the same change', async () => {
    const queued = mutation();

    await sendMutation(queued);
    await sendMutation(queued);

    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as { body: string }).body) as { followUpId: string },
    );
    expect(bodies.map((body) => body.followUpId)).toEqual(['fup_1', 'fup_1']);
  });

  /**
   * A server that answered with a different id would leave this device holding
   * a local id nothing else knows, and the failure would surface much later as
   * a 404 on an edit. Better to fail here, where the cause is visible.
   */
  it('is a conflict when the server answers with a different one', async () => {
    fetchMock.mockResolvedValue(ok({ followUp: { followUpId: 'fup_server_9' } }));

    await expect(sendMutation(mutation())).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('accepts a response that does not echo the follow-up at all', async () => {
    fetchMock.mockResolvedValue(ok({}));

    await expect(sendMutation(mutation())).resolves.toBeUndefined();
  });
});
