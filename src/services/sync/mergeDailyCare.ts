import type { PendingChange } from './mergeFollowUps';

import type { Observation } from '@/types/observations';
import type { DoseEvent, TreatmentSchedule } from '@/types/treatment';

/**
 * Putting the server's daily-care records next to this phone's.
 *
 * Three entities, three different rules, because the records mean different
 * things — copying the follow-up rules onto all of them would be tidy and
 * wrong.
 *
 * ## Notes: newest wins, unless this phone is still holding a change
 *
 * An observation is editable, so the version decides. A local row with a
 * queued change stays: the outbox has the only copy of what somebody just
 * wrote. Otherwise the server's copy wins, and a note the server no longer has
 * was deleted by somebody.
 *
 * ## Medicines: the same, and never silently un-stopped
 *
 * A schedule somebody stopped stays stopped. `supersededAt` is set once and
 * the server keeps it, so taking the remote row is enough — but a *local*
 * ending that has not been sent must not be overwritten by a remote row that
 * still looks live, which is what the pending check is for.
 *
 * ## Dose events: append-only, so this is a union
 *
 * Nothing is ever overwritten and nothing is ever removed by a pull. Two
 * phones each hold events the other has not seen; the answer is both sets, not
 * one of them. The absence of an event on the server means it has not arrived
 * yet — never that it was deleted, because nothing can delete one.
 *
 * That last rule is why dose events need no pending list: a union cannot lose
 * a local change.
 */

export interface MergeDailyCareInput<T> {
  readonly local: T[];
  readonly remoteByPatient: Record<string, T[]>;
  readonly removedPatientIds: readonly string[];
  readonly pending: readonly PendingChange[] | 'unknown';
}

/** Notes and medicines: the server wins unless this phone is mid-change. */
const mergeReplaceable = <T extends { id: string; patientId: string }>({
  local,
  remoteByPatient,
  removedPatientIds,
  pending,
}: MergeDailyCareInput<T>): T[] => {
  const removed = new Set(removedPatientIds);

  /**
   * An unreadable queue changes nothing but a record going away.
   *
   * The same rule as `mergeFollowUps`, and for the same reason: this device
   * cannot tell what it is still holding, and guessing "nothing" is how
   * somebody's unsent edit is silently replaced by the version it edited.
   */
  if (pending === 'unknown') {
    return local.filter((entry) => !removed.has(entry.patientId));
  }

  const held = new Set(pending.map((change) => change.entityId));
  const deleting = new Set(
    pending.filter((change) => change.operation === 'delete').map((change) => change.entityId),
  );
  const pulledPatientIds = new Set(Object.keys(remoteByPatient));

  const remoteById = new Map<string, T>();
  for (const entries of Object.values(remoteByPatient)) {
    for (const entry of entries) remoteById.set(entry.id, entry);
  }

  const kept: T[] = [];
  const matched = new Set<string>();

  for (const entry of local) {
    if (removed.has(entry.patientId)) continue;

    const remote = remoteById.get(entry.id);

    if (remote === undefined) {
      // A record that was not pulled says nothing about what the server holds.
      if (pulledPatientIds.has(entry.patientId) && !held.has(entry.id)) continue;
      kept.push(entry);
      continue;
    }

    matched.add(entry.id);
    kept.push(held.has(entry.id) ? entry : remote);
  }

  for (const patientId of pulledPatientIds) {
    if (removed.has(patientId)) continue;
    for (const entry of remoteByPatient[patientId] ?? []) {
      if (matched.has(entry.id)) continue;
      // Deleted here, not yet on the server: there is no local row to have
      // matched, so without this the pull puts it straight back.
      if (deleting.has(entry.id)) continue;
      kept.push(entry);
    }
  }

  return kept;
};

export const mergeObservations = (input: MergeDailyCareInput<Observation>): Observation[] =>
  mergeReplaceable(input);

export const mergeSchedules = (
  input: MergeDailyCareInput<TreatmentSchedule>,
): TreatmentSchedule[] => mergeReplaceable(input);

/**
 * Dose events: everything both sides have.
 *
 * A union, because the record is append-only. There is no rule here about who
 * wins, since nothing ever disagrees: an event is written once, under an id
 * generated where it happened, and it never changes afterwards. What looks
 * like a disagreement — this phone has an event the server does not — is one
 * that has not been sent yet, and dropping it would delete a dose somebody
 * recorded.
 *
 * The one thing a pull removes is the events of a record this account can no
 * longer reach, which is how revocation reaches a device that already holds
 * the data.
 */
export const mergeDoseEvents = ({
  local,
  remoteByPatient,
  removedPatientIds,
}: Omit<MergeDailyCareInput<DoseEvent>, 'pending'>): DoseEvent[] => {
  const removed = new Set(removedPatientIds);
  const byId = new Map<string, DoseEvent>();

  for (const event of local) {
    if (removed.has(event.patientId)) continue;
    byId.set(event.id, event);
  }

  for (const [patientId, events] of Object.entries(remoteByPatient)) {
    if (removed.has(patientId)) continue;
    for (const event of events) {
      /**
       * The local copy wins a collision, and it is not a real collision: the
       * same id means the same event, written once on the device where
       * somebody pressed the button. Keeping the local one avoids a pointless
       * object swap on every pull.
       */
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  }

  return [...byId.values()];
};
