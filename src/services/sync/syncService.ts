import { createOutbox, type Outbox } from './outbox';
import type { Mutation, SyncSummary } from './types';

import { ApiError } from '@/services/api/errors';
import { nowIso } from '@/utils/date';

/**
 * Sending what the phone is holding, and saying honestly what happened.
 *
 * The engine is small on purpose. Almost all of the difficulty in sync is not
 * in the sending — it is in deciding what each failure *means*, and this file
 * exists so that decision is written down once instead of being made
 * differently at every call site.
 *
 * ## The four answers a request can give
 *
 * | What came back | What it means | What happens |
 * | --- | --- | --- |
 * | 2xx | committed | drop it from the outbox |
 * | network, timeout, 5xx, 429 | unknown | retry with backoff, **same id** |
 * | 409 | somebody else got there first | conflict, stop, ask a person |
 * | 401/403/404 | this account may not do this | rejected, stop |
 *
 * Row two is the one that matters. A timeout after the server committed looks
 * exactly like a request that never arrived, so the retry carries the same
 * mutation id and the server recognises it rather than creating a second
 * record. That is why the id is generated at enqueue and never regenerated.
 *
 * Row four is what revocation looks like from the phone: a change made while
 * access was still held, sent after it was withdrawn. It must not be retried,
 * and it must not be silently dropped — the person made it, and they are told
 * it could not be delivered.
 */

export type SendResult =
  | { readonly outcome: 'committed' }
  | { readonly outcome: 'retry'; readonly reason: string }
  | { readonly outcome: 'conflict'; readonly reason: string }
  | { readonly outcome: 'rejected'; readonly reason: string };

/** Sends one mutation. Injected so the engine can be tested without a server. */
export type MutationSender = (mutation: Mutation) => Promise<void>;

/**
 * Classifies a failure.
 *
 * Deliberately conservative: anything not recognised is a retry, because
 * treating an unknown failure as permanent throws away somebody's change.
 */
export const classify = (error: unknown): Exclude<SendResult, { outcome: 'committed' }> => {
  if (!(error instanceof ApiError)) {
    return { outcome: 'retry', reason: 'Could not reach the server.' };
  }

  switch (error.kind) {
    case 'conflict':
      return {
        outcome: 'conflict',
        reason: 'Somebody else changed this first. Check which version is right.',
      };
    case 'unauthorized':
    case 'forbidden':
      return {
        outcome: 'rejected',
        reason: 'This change could not be saved because you no longer have access to this record.',
      };
    case 'not_found':
      return {
        outcome: 'rejected',
        reason: 'This record is no longer available to you, so the change was not saved.',
      };
    case 'too_large':
      return { outcome: 'rejected', reason: 'This was too large to send.' };
    case 'network':
    case 'timeout':
    case 'server':
    case 'rate_limited':
    case 'unknown':
    default:
      // `userMessage` is written for a person and carries no record content.
      return { outcome: 'retry', reason: error.userMessage };
  }
};

export interface FlushReport {
  readonly attempted: number;
  readonly committed: number;
  readonly retrying: number;
  readonly conflicts: number;
  readonly rejected: number;
}

export interface SyncService {
  enqueue: Outbox['enqueue'];
  /** Sends everything due. Safe to call repeatedly; does nothing when idle. */
  flush(send: MutationSender, now?: Date): Promise<FlushReport>;
  summary(now?: Date): Promise<SyncSummary>;
  outbox: Outbox;
  /** Drops every pending change for a record the account can no longer reach. */
  dropForPatient(patientId: string): Promise<number>;
}

export const createSyncService = (accountId: string): SyncService => {
  const outbox = createOutbox(accountId);

  /** One flush at a time. Two would send the same mutation twice. */
  let flushing = false;
  let lastSyncedAt: string | null = null;

  return {
    outbox,
    enqueue: outbox.enqueue,

    async flush(send, now = new Date()) {
      const empty: FlushReport = {
        attempted: 0,
        committed: 0,
        retrying: 0,
        conflicts: 0,
        rejected: 0,
      };
      if (flushing) return empty;

      flushing = true;
      let committed = 0;
      let retrying = 0;
      let conflicts = 0;
      let rejected = 0;

      try {
        const due = await outbox.due(now);

        for (const mutation of due) {
          await outbox.markSyncing(mutation.id);

          try {
            await send(mutation);
            await outbox.settle(mutation.id);
            committed += 1;
          } catch (error) {
            const result = classify(error);

            if (result.outcome === 'conflict') {
              await outbox.reject(mutation.id, 'conflict', result.reason);
              conflicts += 1;
            } else if (result.outcome === 'rejected') {
              await outbox.reject(mutation.id, 'rejected', result.reason);
              rejected += 1;
            } else {
              await outbox.retryLater(mutation.id, result.reason, now);
              retrying += 1;
              /**
               * Stop at the first unknown failure.
               *
               * Almost always the connection, and marching through fifty
               * mutations to fail each one in turn burns battery, inflates
               * every attempt count, and pushes them all into long backoff for
               * a problem that was never theirs.
               */
              break;
            }
          }
        }

        // A flush that sent nothing is not a sync. Recording the time here
        // would let a phone that has been offline for a week claim it synced
        // a moment ago, which is exactly the lie this whole story is about.
        if (committed > 0) lastSyncedAt = nowIso();

        return { attempted: due.length, committed, retrying, conflicts, rejected };
      } finally {
        flushing = false;
      }
    },

    async summary() {
      const mutations = await outbox.all();
      return {
        lastSyncedAt,
        pending: mutations.filter(
          (mutation) => mutation.state === 'saved_locally' || mutation.state === 'syncing',
        ).length,
        failed: mutations.filter((mutation) => mutation.state === 'failed').length,
        conflicts: mutations.filter((mutation) => mutation.state === 'conflict').length,
        rejected: mutations.filter((mutation) => mutation.state === 'rejected').length,
      };
    },

    /**
     * Discards pending changes for a record this account can no longer reach.
     *
     * Called when the server says a record is gone — revoked, or deleted.
     * Keeping the changes would mean retrying them forever against a record
     * that will keep refusing, and there is nowhere for them to land.
     *
     * Returns how many were dropped so the UI can say so. A change quietly
     * vanishing is worse than one the user is told about.
     */
    async dropForPatient(patientId) {
      const mutations = await outbox.all();
      const doomed = mutations.filter((mutation) => mutation.patientId === patientId);
      for (const mutation of doomed) await outbox.discard(mutation.id);
      return doomed.length;
    },
  };
};
