import { currentSyncService, flushPending, pushChange, resetSyncServices } from './pushService';

import { setTokenProvider } from '@/services/api/client';
import { closeVault, openVaultFor } from '@/services/storage/activeVault';

/**
 * Queueing a change, then trying to send it.
 *
 * The ordering is the property under test: the change is written to the
 * encrypted outbox first and sent second. A caregiver in a lift has still
 * recorded what they recorded, and nothing here is allowed to lose it because
 * the network was not there at that moment.
 */

jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  isBackendEnabled: () => true,
}));

const fetchMock = jest.fn();

const change = {
  patientId: 'pat_1',
  entity: 'follow_up' as const,
  entityId: 'fup_1',
  operation: 'create' as const,
  payload: { title: 'Eye clinic', kind: 'doctor_visit', dueDate: '2026-10-01' },
};

const ok = () => ({
  ok: true,
  status: 201,
  headers: { get: () => null },
  text: async () => JSON.stringify({}),
});

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
  resetSyncServices();
  await openVaultFor('acc_alice');
  /**
   * The outbox is encrypted storage keyed by account, and it survives a
   * `resetSyncServices` — which is the whole point of it. Tests that share an
   * account therefore share a queue, so it is emptied here rather than each
   * test inheriting the last one's unsent changes.
   */
  await currentSyncService()?.outbox.clear();
});

afterEach(() => {
  closeVault();
  resetSyncServices();
});

describe('recording a change', () => {
  it('sends it and reports that it arrived', async () => {
    expect(await pushChange(change)).toEqual({ delivered: true });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('leaves nothing in the queue once the server has it', async () => {
    await pushChange(change);

    const service = currentSyncService();
    expect(await service?.outbox.all()).toEqual([]);
  });
});

describe('when the server cannot be reached', () => {
  /**
   * The important one. The change is kept, the caller is told it did not
   * arrive, and nothing pretends otherwise.
   */
  it('keeps the change and says it did not arrive', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    expect(await pushChange(change)).toEqual({ delivered: false });

    const service = currentSyncService();
    expect(await service?.outbox.all()).toHaveLength(1);
  });

  it('sends it on a later flush', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await pushChange(change);

    fetchMock.mockResolvedValue(ok());
    // The queue backs off after a failure, so the retry is asked for at a time
    // past the wait rather than by sleeping through it.
    const service = currentSyncService();
    const [queued] = await service!.outbox.all();
    await service!.outbox.retryNow(queued!.id);

    const report = await flushPending();

    expect(report?.committed).toBe(1);
    expect(await service?.outbox.all()).toEqual([]);
  });
});

describe('when access has been withdrawn', () => {
  /**
   * A 404 means this account can no longer reach the record. Retrying cannot
   * fix that, and the change must not be dropped silently either — the person
   * made it, and they are told it could not be delivered.
   */
  it('stops retrying and keeps the change visible', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => JSON.stringify({ code: 'not_found' }),
    });

    expect(await pushChange(change)).toEqual({ delivered: false });

    const service = currentSyncService();
    const [queued] = (await service?.outbox.all()) ?? [];
    expect(queued?.state).toBe('rejected');
  });
});

describe('two accounts on one phone', () => {
  it('never sends one account’s queue under another’s session', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await pushChange(change);

    closeVault();
    resetSyncServices();
    await openVaultFor('acc_bob');

    fetchMock.mockResolvedValue(ok());
    const report = await flushPending();

    // Bob's queue is empty; Alice's is still Alice's, waiting for her session.
    expect(report?.attempted).toBe(0);
  });
});
