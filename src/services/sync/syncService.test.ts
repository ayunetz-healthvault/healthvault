import AsyncStorage from '@react-native-async-storage/async-storage';

import { backoffMs, createOutbox, MAX_ATTEMPTS } from './outbox';
import { classify, createSyncService } from './syncService';
import { describeLastSync, hasUnsyncedWork, type Mutation } from './types';

import { ApiError } from '@/services/api/errors';
import { destroyVaultKey } from '@/services/storage/vaultCrypto';

/**
 * Sync, and the four things a failed request can mean.
 *
 * The test this file exists for is "a lost response does not become a duplicate
 * record". Everything else is the machinery that makes that safe: the id is
 * generated once, retries reuse it, and only an answer the server actually gave
 * can move a change out of the queue.
 */

const ACCOUNT = 'acc_alice';
const NOW = new Date('2026-09-08T10:00:00.000Z');

const enqueueDose = async (
  service: ReturnType<typeof createSyncService>,
  patientId = 'pat_1',
): Promise<Mutation> =>
  service.enqueue({
    patientId,
    entity: 'dose_event',
    entityId: 'dse_1',
    operation: 'create',
    payload: { takenAt: '2026-09-08T08:00:00.000Z' },
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  await destroyVaultKey(ACCOUNT);
});

describe('classify', () => {
  it.each([
    ['network', 'retry'],
    ['timeout', 'retry'],
    ['server', 'retry'],
    ['rate_limited', 'retry'],
    ['unknown', 'retry'],
    ['conflict', 'conflict'],
    ['unauthorized', 'rejected'],
    ['forbidden', 'rejected'],
    ['not_found', 'rejected'],
  ] as const)('treats a %s failure as %s', (kind, outcome) => {
    expect(classify(new ApiError(kind, 'x')).outcome).toBe(outcome);
  });

  /** Treating an unknown failure as permanent throws away somebody's change. */
  it('retries anything it does not recognise', () => {
    expect(classify(new Error('something odd')).outcome).toBe('retry');
    expect(classify('a string').outcome).toBe('retry');
  });

  it('never repeats a raw server message, which can quote record content', () => {
    const error = new ApiError('conflict', 'Document "Meera Nair blood test" was modified');

    expect(classify(error).reason).not.toContain('Meera');
  });
});

describe('sending', () => {
  it('drops a mutation the server acknowledged', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    const report = await service.flush(async () => undefined, NOW);

    expect(report).toMatchObject({ attempted: 1, committed: 1 });
    expect(await service.outbox.all()).toEqual([]);
  });

  it('keeps a mutation the server never answered', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    await service.flush(async () => {
      throw new ApiError('network', 'offline');
    }, NOW);

    const [mutation] = await service.outbox.all();
    expect(mutation).toMatchObject({ state: 'saved_locally', attempts: 1 });
  });

  /**
   * The one the whole design is for. A response lost after the server committed
   * is indistinguishable from one that never arrived, so the retry has to be
   * recognisable as the same change.
   */
  it('retries with the same id, so a lost response cannot become a duplicate', async () => {
    const service = createSyncService(ACCOUNT);
    const original = await enqueueDose(service);

    await service.flush(async () => {
      throw new ApiError('timeout', 'gone');
    }, NOW);

    const seen: string[] = [];
    await service.flush(
      async (mutation) => {
        seen.push(mutation.id);
      },
      new Date(NOW.getTime() + backoffMs(1) + 1),
    );

    expect(seen).toEqual([original.id]);
  });

  it('does not send a mutation again before its backoff has elapsed', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    await service.flush(async () => {
      throw new ApiError('network', 'offline');
    }, NOW);

    const report = await service.flush(async () => undefined, new Date(NOW.getTime() + 100));

    expect(report.attempted).toBe(0);
  });

  it('backs off further each time, up to a ceiling', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(3));
    expect(backoffMs(100)).toBe(backoffMs(200));
  });

  /**
   * A connection failure is almost never about the particular change. Marching
   * through the queue to fail each one inflates every attempt count and pushes
   * them all into long backoff for a problem that was never theirs.
   */
  it('stops at the first unreachable-server failure rather than failing the queue', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);
    await service.enqueue({
      patientId: 'pat_1',
      entity: 'follow_up',
      entityId: 'fup_1',
      operation: 'create',
      payload: {},
    });

    let calls = 0;
    await service.flush(async () => {
      calls += 1;
      throw new ApiError('network', 'offline');
    }, NOW);

    expect(calls).toBe(1);
    const mutations = await service.outbox.all();
    expect(mutations.filter((mutation) => mutation.attempts > 0)).toHaveLength(1);
  });

  it('gives up automatic retries after a bounded number of attempts', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    let at = NOW.getTime();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await service.flush(
        async () => {
          throw new ApiError('server', 'boom');
        },
        new Date(at),
      );
      at += backoffMs(attempt) + 1;
    }

    const [mutation] = await service.outbox.all();
    expect(mutation).toMatchObject({ state: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('sends nothing while a flush is already running', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    let inFlight = 0;
    let overlapped = false;

    const send = async (): Promise<void> => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await Promise.resolve();
      inFlight -= 1;
    };

    await Promise.all([service.flush(send, NOW), service.flush(send, NOW)]);

    expect(overlapped).toBe(false);
  });
});

describe('a change somebody else got to first', () => {
  it('stops rather than overwriting', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    await service.flush(async () => {
      throw new ApiError('conflict', 'version mismatch');
    }, NOW);

    const [mutation] = await service.outbox.all();
    expect(mutation?.state).toBe('conflict');
  });

  it('is not picked up again by an automatic flush', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);
    await service.flush(async () => {
      throw new ApiError('conflict', 'x');
    }, NOW);

    const later = await service.flush(
      async () => undefined,
      new Date(NOW.getTime() + 365 * 24 * 60 * 60_000),
    );

    expect(later.attempted).toBe(0);
  });

  it('goes back in line when a person asks it to', async () => {
    const service = createSyncService(ACCOUNT);
    const mutation = await enqueueDose(service);
    await service.flush(async () => {
      throw new ApiError('conflict', 'x');
    }, NOW);

    await service.outbox.retryNow(mutation.id, NOW);
    const report = await service.flush(async () => undefined, NOW);

    expect(report.committed).toBe(1);
  });

  /** Otherwise a hopeless change can be retried forever, one tap at a time. */
  it('keeps the attempt history when a person retries', async () => {
    const service = createSyncService(ACCOUNT);
    const mutation = await enqueueDose(service);
    await service.flush(async () => {
      throw new ApiError('server', 'boom');
    }, NOW);

    await service.outbox.retryNow(mutation.id, NOW);

    expect((await service.outbox.all())[0]?.attempts).toBe(1);
  });
});

describe('access withdrawn while a change was waiting', () => {
  it('stops retrying, and says why in words the user can act on', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    await service.flush(async () => {
      throw new ApiError('forbidden', 'no grant');
    }, NOW);

    const [mutation] = await service.outbox.all();
    expect(mutation?.state).toBe('rejected');
    expect(mutation?.lastError).toMatch(/no longer have access/i);
  });

  it('does not silently drop the change', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);
    await service.flush(async () => {
      throw new ApiError('unauthorized', 'x');
    }, NOW);

    expect(await service.outbox.all()).toHaveLength(1);
  });

  it('drops a record’s pending changes when the record itself is gone', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service, 'pat_gone');
    await enqueueDose(service, 'pat_still_mine');

    const dropped = await service.dropForPatient('pat_gone');

    expect(dropped).toBe(1);
    expect((await service.outbox.all()).map((mutation) => mutation.patientId)).toEqual([
      'pat_still_mine',
    ]);
  });
});

describe('what the user is told', () => {
  it('does not claim a sync happened when nothing was sent', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);
    await service.flush(async () => {
      throw new ApiError('network', 'offline');
    }, NOW);

    expect((await service.summary()).lastSyncedAt).toBeNull();
  });

  it('records the time only once something was actually acknowledged', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);
    await service.flush(async () => undefined, NOW);

    expect((await service.summary()).lastSyncedAt).not.toBeNull();
  });

  it('counts what is waiting, by kind', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service, 'pat_1');
    await service.enqueue({
      patientId: 'pat_2',
      entity: 'follow_up',
      entityId: 'fup_1',
      operation: 'create',
      payload: {},
    });
    await service.flush(async (mutation) => {
      if (mutation.entity === 'dose_event') throw new ApiError('conflict', 'x');
    }, NOW);

    const summary = await service.summary();
    expect(summary.conflicts).toBe(1);
    expect(hasUnsyncedWork(summary)).toBe(true);
  });

  it('reports a clean queue as nothing outstanding', async () => {
    const summary = await createSyncService(ACCOUNT).summary();

    expect(hasUnsyncedWork(summary)).toBe(false);
  });
});

describe('describeLastSync', () => {
  const at = (minutesAgo: number): string =>
    new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

  /** A blank would read as "fine". Never having synced is a fact worth saying. */
  it('says so plainly when nothing has ever synced', () => {
    expect(describeLastSync(null, NOW)).toBe('Not synced yet');
  });

  it.each([
    [0, 'Synced just now'],
    [1, 'Synced 1 minute ago'],
    [5, 'Synced 5 minutes ago'],
    [60, 'Synced 1 hour ago'],
    [200, 'Synced 3 hours ago'],
    [60 * 24 * 3, 'Synced 3 days ago'],
  ])('describes %s minutes ago as "%s"', (minutes, expected) => {
    expect(describeLastSync(at(minutes), NOW)).toBe(expected);
  });
});

describe('the outbox survives a restart', () => {
  it('still holds a pending change when rebuilt from storage', async () => {
    const service = createSyncService(ACCOUNT);
    await enqueueDose(service);

    // A fresh instance, as a cold start would build.
    expect(await createOutbox(ACCOUNT).all()).toHaveLength(1);
  });

  it('writes nothing recognisable to disk', async () => {
    const service = createSyncService(ACCOUNT);
    await service.enqueue({
      patientId: 'pat_1',
      entity: 'observation',
      entityId: 'obs_1',
      operation: 'create',
      payload: { note: 'Amma felt dizzy after the new tablet' },
    });

    const keys = await AsyncStorage.getAllKeys();
    const values = await Promise.all(keys.map((key) => AsyncStorage.getItem(key)));

    expect(values.join('|')).not.toContain('dizzy');
  });

  it('keeps one account’s queue away from another’s', async () => {
    await enqueueDose(createSyncService(ACCOUNT));

    expect(await createOutbox('acc_bob').all()).toEqual([]);
  });
});
