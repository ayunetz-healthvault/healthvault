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
 * The third rule is the one that needs care, and `pendingIds` is what makes it
 * safe: a task created on this device and not yet accepted is absent from the
 * server for a completely different reason.
 */

export interface MergeFollowUpsInput {
  /** Every follow-up currently on this device, across all patients. */
  readonly local: FollowUp[];
  /** What the server returned, keyed by patient. */
  readonly remoteByPatient: Record<string, FollowUp[]>;
  /** Patients this account can no longer reach. Their tasks go with them. */
  readonly removedPatientIds: readonly string[];
  /**
   * Follow-ups with a change still waiting in the outbox.
   *
   * Passed in rather than read from the queue, so this stays a function about
   * merging and can be argued with in a test that has no storage.
   */
  readonly pendingIds: readonly string[];
}

export const mergeFollowUps = ({
  local,
  remoteByPatient,
  removedPatientIds,
  pendingIds,
}: MergeFollowUpsInput): FollowUp[] => {
  const removed = new Set(removedPatientIds);
  const pending = new Set(pendingIds);
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
      if (pulledPatientIds.has(followUp.parentId) && !pending.has(followUp.id)) continue;

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
    kept.push(pending.has(followUp.id) ? followUp : takeRemote(followUp, remote));
  }

  for (const patientId of pulledPatientIds) {
    if (removed.has(patientId)) continue;
    for (const followUp of remoteByPatient[patientId] ?? []) {
      if (!matched.has(followUp.id)) kept.push(followUp);
    }
  }

  return kept;
};

/**
 * The server's version, with the one field it cannot be right about.
 *
 * `calendarEventId` names an event in *a* phone's calendar, and this phone can
 * only delete an event in its own. So a local link is never replaced by a
 * remote one: another device's id here would put a "remove from your calendar"
 * button on a screen where there is nothing to remove.
 */
const takeRemote = (local: FollowUp, remote: FollowUp): FollowUp => ({
  ...remote,
  calendarEventId: local.calendarEventId ?? remote.calendarEventId,
});
