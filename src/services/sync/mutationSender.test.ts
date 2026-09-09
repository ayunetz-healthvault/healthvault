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
  it.each(['patient', 'document'] as const)(
    'refuses a %s rather than retrying forever',
    async (entity) => {
      await expect(sendMutation(mutation({ entity }))).rejects.toMatchObject({
        kind: 'forbidden',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('says the change is still on the phone', async () => {
    await expect(sendMutation(mutation({ entity: 'patient' }))).rejects.toThrow(
      /saved on this phone/i,
    );
  });

  /**
   * A medicine somebody was taking is not something the record can forget, and
   * a dose event is append-only — so these two operations have no endpoint by
   * design rather than by omission, and saying so beats retrying for an hour.
   */
  it('refuses to delete a medicine or edit a dose event', async () => {
    await expect(
      sendMutation(mutation({ entity: 'treatment', operation: 'delete', payload: null })),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(
      sendMutation(mutation({ entity: 'dose_event', operation: 'update' })),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    expect(fetchMock).not.toHaveBeenCalled();
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

/**
 * The three records daily care produces, now that they have somewhere to go.
 *
 * They were stored on one phone and shared with nobody, which the sender was
 * at least honest about. These are the properties that keep them honest now
 * that they travel.
 */
describe('sending a note somebody wrote', () => {
  const note = (patch: Partial<Mutation> = {}) =>
    mutation({
      entity: 'observation',
      entityId: 'obs_1',
      payload: { text: 'Dizzy after the new tablet', impact: 'moderately' },
      ...patch,
    });

  it('creates it under the id this device gave it', async () => {
    await sendMutation(note());

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(String(url)).toContain('/v1/patients/pat_1/observations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      observationId: 'obs_1',
      text: 'Dizzy after the new tablet',
    });
  });

  /**
   * The version travels with an edit, so the server can refuse one made
   * against text somebody has already replaced. Without it the last writer
   * wins and the other person's words vanish with nobody told.
   */
  it('sends the version an edit was made against', async () => {
    await sendMutation(note({ operation: 'update', baseVersion: 3, payload: { text: 'Edited' } }));

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe('PATCH');
    expect(String(url)).toContain('/observations/obs_1');
    expect(JSON.parse(init.body)).toMatchObject({ text: 'Edited', version: 3 });
  });

  it('deletes one with a DELETE to its own path', async () => {
    await sendMutation(note({ operation: 'delete', payload: null }));

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(init.method).toBe('DELETE');
    expect(String(url)).toContain('/observations/obs_1');
  });
});

describe('sending a medicine', () => {
  const medicine = (patch: Partial<Mutation> = {}) =>
    mutation({
      entity: 'treatment',
      entityId: 'trt_1',
      payload: { name: 'Metformin', times: ['08:00'], confirmedBy: 'acc_alice' },
      ...patch,
    });

  it('confirms it under this device’s id', async () => {
    await sendMutation(medicine());

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(String(url)).toContain('/v1/patients/pat_1/treatments');
    expect(JSON.parse(init.body)).toMatchObject({ scheduleId: 'trt_1', name: 'Metformin' });
  });

  /**
   * Stopping a medicine is the only edit there is, and it goes to the endpoint
   * that says so — changing the times produces a new schedule, because what
   * somebody was taking last month is part of the record.
   */
  it('sends an ending to the supersede endpoint, not a general update', async () => {
    await sendMutation(
      medicine({ operation: 'update', payload: { supersededAt: '2026-10-01T00:00:00.000Z' } }),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe('POST');
    expect(String(url)).toContain('/treatments/trt_1/supersede');
    expect(JSON.parse(init.body)).toMatchObject({ supersededAt: '2026-10-01T00:00:00.000Z' });
  });
});

describe('sending a dose', () => {
  const dose = (patch: Partial<Mutation> = {}) =>
    mutation({
      entity: 'dose_event',
      entityId: 'dse_1',
      payload: {
        scheduleId: 'trt_1',
        occurrenceKey: 'trt_1#2026-09-09#08:00',
        state: 'taken',
        undo: false,
      },
      ...patch,
    });

  it('appends it under the id this device gave it', async () => {
    await sendMutation(dose());

    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(init.method).toBe('POST');
    expect(String(url)).toContain('/v1/patients/pat_1/dose-events');
    expect(JSON.parse(init.body)).toMatchObject({ eventId: 'dse_1', state: 'taken' });
  });

  /** An undo is another append, carrying the event it supersedes. */
  it('sends an undo as an append that names what it supersedes', async () => {
    await sendMutation(
      dose({
        entityId: 'dse_2',
        payload: {
          scheduleId: 'trt_1',
          occurrenceKey: 'trt_1#2026-09-09#08:00',
          state: 'missed',
          supersedesEventId: 'dse_1',
          undo: true,
        },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      eventId: 'dse_2',
      supersedesEventId: 'dse_1',
      undo: true,
    });
  });
});
