import { pushChange } from './pushService';

import type { Observation } from '@/types/observations';
import type { DoseEvent, TreatmentSchedule } from '@/types/treatment';

/**
 * Queueing the three records daily care produces.
 *
 * One place that knows what each of them looks like on the wire, for the same
 * reason `mutationSender` exists: five screens building the payload themselves
 * is five chances for them to drift, and the field most likely to drift is the
 * one that decides whether a dose was recorded by the patient or by somebody
 * watching them.
 *
 * ## Queued, then sent — never the other way round
 *
 * Every one of these is written to the store first and queued second. A
 * caregiver in a hospital lift has still recorded the dose; the screen says
 * "saved on this phone", which is true, and the outbox says the rest.
 *
 * ## What is deliberately absent
 *
 * There is no `deleteTreatment` and no `updateDoseEvent`. A medicine somebody
 * was taking is part of the record — stopping it is `endTreatment` — and a
 * dose event is append-only, so undoing a tap is another append that names
 * what it supersedes. Neither omission is an oversight, and `mutationSender`
 * refuses both explicitly rather than retrying against an endpoint that does
 * not exist.
 */

/** A note, on its way to whoever reads the record next. */
export const pushObservation = async (observation: Observation): Promise<void> => {
  await pushChange({
    patientId: observation.patientId,
    entity: 'observation',
    entityId: observation.id,
    operation: 'create',
    payload: {
      text: observation.text,
      occurredAt: observation.occurredAt,
      impact: observation.impact,
      recordedBy: observation.recordedBy,
      recordedAt: observation.recordedAt,
    },
  });
};

/**
 * An edit, carrying the version it was made against.
 *
 * The server refuses one made against text somebody else has already replaced,
 * and that refusal is the point: without the version the last writer wins and
 * the other person's words disappear with nobody told.
 */
export const pushObservationEdit = async (
  observation: Observation,
  baseVersion: number,
): Promise<void> => {
  await pushChange({
    patientId: observation.patientId,
    entity: 'observation',
    entityId: observation.id,
    operation: 'update',
    payload: { text: observation.text, impact: observation.impact },
    baseVersion,
  });
};

export const pushObservationRemoval = async (observation: {
  id: string;
  patientId: string;
}): Promise<void> => {
  await pushChange({
    patientId: observation.patientId,
    entity: 'observation',
    entityId: observation.id,
    operation: 'delete',
    payload: null,
  });
};

/**
 * A medicine somebody has confirmed.
 *
 * `confirmedBy` and `confirmedAt` travel with it because the server requires
 * them: a schedule with no confirmation is a reading of a prescription, and
 * the one thing this system must never do is turn one into reminders to take
 * a drug.
 */
export const pushTreatment = async (schedule: TreatmentSchedule): Promise<void> => {
  await pushChange({
    patientId: schedule.patientId,
    entity: 'treatment',
    entityId: schedule.id,
    operation: 'create',
    payload: {
      name: schedule.name,
      dosage: schedule.dosage,
      times: schedule.times,
      timezone: schedule.timezone,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      provenance: schedule.provenance,
      sourceDocumentId: schedule.source?.documentId ?? null,
      confirmedBy: schedule.confirmedBy,
      confirmedAt: schedule.confirmedAt,
    },
  });
};

/** Stopping one. The only edit there is; the old times stay readable. */
export const pushTreatmentEnd = async (
  schedule: { id: string; patientId: string },
  supersededAt: string,
): Promise<void> => {
  await pushChange({
    patientId: schedule.patientId,
    entity: 'treatment',
    entityId: schedule.id,
    operation: 'update',
    payload: { supersededAt },
  });
};

/**
 * One dose, appended.
 *
 * `recordedBySelf` is sent for completeness and the server ignores it,
 * deriving it from the grant instead — "she told me she took it" and "I took
 * it" are different claims and a client must not be able to make the second on
 * somebody else's behalf.
 */
export const pushDoseEvent = async (event: DoseEvent | null): Promise<void> => {
  /**
   * Null is what `recordDose` returns when the tap would change nothing — the
   * same dose already in the same state. Ignored here exactly as
   * `appendDoseEvent` ignores it, so a double tap sends nothing rather than
   * queueing a change that says nothing.
   */
  if (event === null) return;

  await pushChange({
    patientId: event.patientId,
    entity: 'dose_event',
    entityId: event.id,
    operation: 'create',
    payload: {
      scheduleId: event.scheduleId,
      occurrenceKey: event.occurrenceKey,
      occurrenceAt: event.occurrenceAt,
      state: event.state,
      recordedAt: event.recordedAt,
      recordedBy: event.recordedBy,
      recordedBySelf: event.recordedBySelf,
      supersedesEventId: event.supersedesEventId,
      undo: event.undo,
    },
  });
};
