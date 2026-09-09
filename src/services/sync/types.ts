import type { IsoDateTime } from '@/types/domain';

/**
 * What the user is told about a record's state, and nothing softer.
 *
 * The distinction that matters is between the first two. "Saved" on a phone
 * with no signal means saved *here*, and a helper on the other side of the
 * world has not seen it. A screen that shows a tick for both is lying about the
 * only thing the user would want to know.
 */
export type SyncState =
  /** Written to this device. The shared record does not have it yet. */
  | 'saved_locally'
  /** In flight. */
  | 'syncing'
  /** The server acknowledged it. Everyone with access can see it. */
  | 'synced'
  /** Sending failed, and it will be tried again. */
  | 'failed'
  /**
   * Somebody else changed the same thing first.
   *
   * Never resolved by overwriting. A device clock is not an argument about
   * whose version of a medicine list is right.
   */
  | 'conflict'
  /**
   * The server refused it and retrying cannot help — most often because access
   * was withdrawn while the change was waiting.
   */
  | 'rejected';

export type MutationEntity =
  | 'patient'
  | 'document'
  | 'follow_up'
  | 'observation'
  | 'treatment'
  | 'dose_event';

export type MutationOperation = 'create' | 'update' | 'delete';

export interface Mutation {
  /**
   * Generated on the device, before the first attempt, and never regenerated.
   *
   * This is the idempotency key. A request that times out *after* the server
   * committed it is indistinguishable from one that never arrived, so the retry
   * carries the same id and the server recognises it rather than creating a
   * second record. Regenerating it on retry — the obvious mistake — turns every
   * lost response into a duplicate.
   */
  readonly id: string;
  readonly patientId: string;
  readonly entity: MutationEntity;
  readonly entityId: string;
  readonly operation: MutationOperation;
  readonly payload: unknown;
  /**
   * The version this change was made against, or null for a create.
   *
   * The server compares it and refuses if the record has moved on. Without it,
   * two people editing the same finding produce a last-writer-wins race decided
   * by whichever phone had the better connection.
   */
  readonly baseVersion: number | null;
  readonly createdAt: IsoDateTime;
  readonly attempts: number;
  /** Epoch millis. Backoff, so a failing server is not hammered. */
  readonly nextAttemptAt: number;
  readonly state: SyncState;
  /**
   * Why it last failed, in words safe to show.
   *
   * Never the server's raw message: those can quote a document title or a
   * field value, and this is written to disk and read back on every launch.
   */
  readonly lastError?: string | undefined;
}

export interface SyncSummary {
  /** When the last successful reconciliation finished. Null if never. */
  readonly lastSyncedAt: IsoDateTime | null;
  readonly pending: number;
  readonly failed: number;
  readonly conflicts: number;
  readonly rejected: number;
}

/** True when the phone is holding changes the shared record has not seen. */
export const hasUnsyncedWork = (summary: SyncSummary): boolean =>
  summary.pending > 0 || summary.failed > 0 || summary.conflicts > 0;

/**
 * How a last-sync time should be described.
 *
 * "Synced" with no time is the wrong answer: a caregiver looking at a record
 * needs to know whether they are seeing this morning's dose or last Tuesday's.
 * Never syncing at all says so plainly rather than showing a blank.
 */
export const describeLastSync = (
  lastSyncedAt: IsoDateTime | null,
  now: Date = new Date(),
): string => {
  if (lastSyncedAt === null) return 'Not synced yet';

  const elapsedMs = now.getTime() - new Date(lastSyncedAt).getTime();
  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `Synced ${days} day${days === 1 ? '' : 's'} ago`;
};
