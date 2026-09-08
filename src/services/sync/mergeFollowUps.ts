import type { MutationOperation } from './types';

import type { FollowUp } from '@/types/domain';

/**
 * Putting the family's shared task list next to this phone's copy of it.
 *
 * Follow-ups are the one record that exists *because* two people are involved:
 * one person books the appointment, another takes their mother to it, and a
 * third needs to know it happened. So a pull has to bring other people's
 * changes down — that was missing entirely, and a task created on one phone
 * simply never appeared on any other.
 *
 * Bringing them down safely is the part that needs rules:
 *
 * - **A change this phone has not managed to send yet wins.** It is the only
 *   copy of what somebody just did, and the server's version is by definition
 *   the state before they did it. Overwriting it with the pull would silently
 *   undo a completed appointment while its request sat in the outbox.
 * - **Otherwise the server wins.** It has everybody's changes, and this device
 *   may have been offline since yesterday.
 * - **A task the server no longer has is gone.** Somebody deleted it, and
 *   keeping it here would resurrect it on this phone alone.
 *
 * The third rule is the one that needs care, and the pending changes are what
 * make it safe: a task created on this device and not yet accepted is absent
 * from the server for a completely different reason.
 *
 * ## Why the pending *operation* matters, not just the id
 *
 * A pending delete has no local row to protect — the screen removes it before
 * queueing the request, which is what makes deleting feel immediate. So the
 * first two rules never see it, and the last loop, which adds everything the
 * server returned that this device does not have, put the appointment straight
 * back. The person deleted it, watched it disappear, and found it waiting for
 * them after the next refresh.
 *
 * ## Why an unreadable queue stops the merge
 *
 * `pending` can be `unknown`, and that is not the same as empty. If the outbox
 * cannot be read, this device cannot tell a task the server deleted from one it
 * is about to delete itself — so it changes nothing rather than guessing, and
 * the next pull settles it. Treating a failed read as "no pending changes" is
 * how a queue error turns into somebody's deletion being undone.
 */

/** A change this device is holding: which task, and what it will do to it. */
export interface PendingChange {
  readonly entityId: string;
  readonly operation: MutationOperation;
}

export interface MergeFollowUpsInput {
  /** Every follow-up currently on this device, across all patients. */
  readonly local: FollowUp[];
  /** What the server returned, keyed by patient. */
  readonly remoteByPatient: Record<string, FollowUp[]>;
  /** Patients this account can no longer reach. Their tasks go with them. */
  readonly removedPatientIds: readonly string[];
  /**
   * Changes still waiting in the outbox, or `unknown` when the queue could not
   * be read.
   *
   * Passed in rather than read from the queue, so this stays a function about
   * merging and can be argued with in a test that has no storage.
   */
  readonly pending: readonly PendingChange[] | 'unknown';
}

export const mergeFollowUps = ({
  local,
  remoteByPatient,
  removedPatientIds,
  pending,
}: MergeFollowUpsInput): FollowUp[] => {
  const removed = new Set(removedPatientIds);

  /**
   * Nothing is known about what this device is holding, so nothing is applied.
   *
   * Except a record going away: revocation and deletion are the server's to
   * decide and no local change can be waiting to contradict them.
   */
  if (pending === 'unknown') {
    return local.filter((followUp) => !removed.has(followUp.parentId));
  }

  const held = new Set(pending.map((change) => change.entityId));
  const deleting = new Set(
    pending.filter((change) => change.operation === 'delete').map((change) => change.entityId),
  );
  const pulledPatientIds = new Set(Object.keys(remoteByPatient));

  const remoteById = new Map<string, FollowUp>();
  for (const followUps of Object.values(remoteByPatient)) {
    for (const followUp of followUps) remoteById.set(followUp.id, followUp);
  }

  const kept: FollowUp[] = [];
  const matched = new Set<string>();

  for (const followUp of local) {
    // Revocation and deletion reach this device here, the same way they reach
    // documents: the record went, so everything filed under it goes with it.
    if (removed.has(followUp.parentId)) continue;

    const remote = remoteById.get(followUp.id);

    if (remote === undefined) {
      /**
       * The server did not return it.
       *
       * For a patient that was not pulled at all — the request failed, or this
       * device is offline — that says nothing, so the task stays. For a patient
       * that *was* pulled, the task has either been deleted by somebody else or
       * has never left this phone; a pending change is what tells the two
       * apart, and it is the only reason to keep one.
       */
      if (pulledPatientIds.has(followUp.parentId) && !held.has(followUp.id)) continue;

      kept.push(followUp);
      continue;
    }

    matched.add(followUp.id);

    /**
     * A queued change keeps this device's whole row.
     *
     * Nothing of the server's is taken in that case. A half-merge — the remote
     * title with the local status, say — produces a row nobody wrote and
     * neither side would recognise; the outbox will send what is here, and the
     * next pull settles it.
     */
    kept.push(held.has(followUp.id) ? followUp : takeRemote(followUp, remote));
  }

  for (const patientId of pulledPatientIds) {
    if (removed.has(patientId)) continue;
    for (const followUp of remoteByPatient[patientId] ?? []) {
      if (matched.has(followUp.id)) continue;
      /**
       * A task this device has deleted and not yet managed to say so.
       *
       * There is no local row to have matched — the screen removed it when the
       * person tapped delete — so without this the server's copy is added back
       * as though it were news, and the appointment they deleted returns.
       */
      if (deleting.has(followUp.id)) continue;
      kept.push(followUp);
    }
  }

  return kept;
};

/**
 * The server's version, with the one field it cannot be right about.
 *
 * `calendarEventId` names an event in *a* phone's calendar, and no other phone
 * can do anything with it: passing another device's id to this device's
 * calendar API deletes nothing, or worse, something else. So the local value
 * stands, including when the local value is "there is no event here" — falling
 * back to the remote id, which is what this used to do, put a "remove from your
 * calendar" button on a phone with nothing to remove.
 *
 * Which event belongs to which task on *this* device is `calendarMappings`,
 * stored on the device that made it.
 */
const takeRemote = (local: FollowUp, remote: FollowUp): FollowUp => ({
  ...remote,
  calendarEventId: local.calendarEventId,
});
