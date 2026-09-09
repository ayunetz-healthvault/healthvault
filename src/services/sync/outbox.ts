import type { Mutation, MutationEntity, MutationOperation, SyncState } from './types';

import { createEncryptedStore } from '@/services/storage/encryptedStore';
import { nowIso } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * The durable outbox.
 *
 * Every change the user makes is written here *before* it is sent, and stays
 * until the server acknowledges it. That ordering is the whole design: a change
 * that exists only in memory is a change lost to a crash, a battery, or a
 * user closing the app on a train.
 *
 * Stored through `encryptedStore`, so the queue is encrypted and namespaced by
 * account like everything else. A pending "record this dose" is as clinical as
 * the record it will become.
 */

const OUTBOX_KEY = 'outbox';

/**
 * How many times to retry before giving up on automatic retry.
 *
 * Bounded because an endlessly retrying queue on a phone is a battery
 * complaint and, worse, a mutation that can never succeed blocking everything
 * behind it. At the limit it becomes `failed`, which is visible and has a
 * manual retry — the user decides, rather than the queue quietly spinning.
 */
export const MAX_ATTEMPTS = 6;

/** Exponential with a ceiling, so a long outage does not mean a long silence. */
export const backoffMs = (attempts: number): number =>
  Math.min(30 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));

export interface EnqueueInput {
  patientId: string;
  entity: MutationEntity;
  entityId: string;
  operation: MutationOperation;
  payload: unknown;
  baseVersion?: number | null;
}

export interface Outbox {
  all(): Promise<Mutation[]>;
  enqueue(input: EnqueueInput): Promise<Mutation>;
  /** Mutations whose backoff has elapsed, oldest first. */
  due(now?: Date): Promise<Mutation[]>;
  markSyncing(id: string): Promise<void>;
  /** Removes an acknowledged mutation. */
  settle(id: string): Promise<void>;
  /** Records a failure and schedules the next attempt. */
  retryLater(id: string, reason: string, now?: Date): Promise<Mutation | null>;
  /** Marks a mutation the server refused in a way retrying cannot fix. */
  reject(id: string, state: Extract<SyncState, 'conflict' | 'rejected'>, reason: string): Promise<void>;
  /** Puts a failed or conflicted mutation back in line, at the user's request. */
  retryNow(id: string, now?: Date): Promise<void>;
  /** Drops a mutation the user has abandoned. */
  discard(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const createOutbox = (accountId: string): Outbox => {
  const store = createEncryptedStore(accountId);

  const read = async (): Promise<Mutation[]> => (await store.read<Mutation[]>(OUTBOX_KEY)) ?? [];
  const write = async (mutations: Mutation[]): Promise<void> => {
    await store.write(OUTBOX_KEY, mutations);
  };

  const update = async (
    id: string,
    change: (mutation: Mutation) => Mutation,
  ): Promise<Mutation | null> => {
    const mutations = await read();
    const index = mutations.findIndex((mutation) => mutation.id === id);
    if (index === -1) return null;

    const next = change(mutations[index] as Mutation);
    await write(mutations.map((mutation, at) => (at === index ? next : mutation)));
    return next;
  };

  return {
    all: read,

    async enqueue(input) {
      const mutation: Mutation = {
        // Once, here. Never regenerated on retry — see `Mutation.id`.
        id: createId('mut'),
        patientId: input.patientId,
        entity: input.entity,
        entityId: input.entityId,
        operation: input.operation,
        payload: input.payload,
        baseVersion: input.baseVersion ?? null,
        createdAt: nowIso(),
        attempts: 0,
        // Zero means "due now", rather than stamping the wall clock. A new
        // change should be sent at the first opportunity whatever the device
        // clock says — and a phone whose clock is wrong, or has just been
        // corrected, should not end up with a queue scheduled in its own
        // future.
        nextAttemptAt: 0,
        state: 'saved_locally',
      };

      await write([...(await read()), mutation]);
      return mutation;
    },

    async due(now = new Date()) {
      return (await read())
        .filter(
          (mutation) =>
            (mutation.state === 'saved_locally' || mutation.state === 'syncing') &&
            mutation.nextAttemptAt <= now.getTime(),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async markSyncing(id) {
      await update(id, (mutation) => ({ ...mutation, state: 'syncing' }));
    },

    async settle(id) {
      await write((await read()).filter((mutation) => mutation.id !== id));
    },

    async retryLater(id, reason, now = new Date()) {
      return update(id, (mutation) => {
        const attempts = mutation.attempts + 1;
        return {
          ...mutation,
          attempts,
          // At the limit it stops retrying and waits for the user, rather than
          // spinning forever behind a change that can never succeed.
          state: attempts >= MAX_ATTEMPTS ? 'failed' : 'saved_locally',
          nextAttemptAt: now.getTime() + backoffMs(attempts),
          lastError: reason,
        };
      });
    },

    async reject(id, state, reason) {
      await update(id, (mutation) => ({
        ...mutation,
        state,
        lastError: reason,
        // Far enough out that nothing picks it up automatically; only
        // `retryNow` moves it, and only because somebody asked.
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
      }));
    },

    async retryNow(id, now = new Date()) {
      await update(id, (mutation) => ({
        ...mutation,
        state: 'saved_locally',
        // Attempts are *not* reset. The count is the history of this change,
        // and hiding it would let a hopeless mutation be retried forever one
        // tap at a time.
        nextAttemptAt: now.getTime(),
      }));
    },

    async discard(id) {
      await write((await read()).filter((mutation) => mutation.id !== id));
    },

    async clear() {
      await store.remove(OUTBOX_KEY);
    },
  };
};
