import type { DoseEvent, DoseOccurrence, DoseState, TreatmentSchedule } from '@/types/treatment';
import { createId } from '@/utils/id';

/**
 * Turning a schedule into the doses that are actually due, and recording what
 * happened to them.
 *
 * Pure. Every safety rule in KOO-10 is expressible as a property of these
 * functions, which is the point of keeping them out of a screen: a rule stated
 * in a component is a rule that holds until somebody writes a second component.
 */

/**
 * The identity of one dose.
 *
 * Schedule, calendar date and time of day. Deterministic, so two taps on "I've
 * taken it" produce the same key and the second is recognised as the same
 * tablet rather than a second one.
 *
 * The date is the *local* date in the patient's zone, not UTC: a 23:00 dose in
 * Kochi belongs to that evening, and keying it by the UTC date would move it to
 * the next day and split a night's doses across two.
 */
export const occurrenceKeyFor = (
  scheduleId: string,
  localDate: string,
  timeOfDay: string,
): string => `${scheduleId}#${localDate}#${timeOfDay}`;

/** Parts of a wall-clock time in a named zone. */
const partsIn = (instant: Date, timezone: string): { date: string; time: string } => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    // Some engines render midnight as 24; normalise it.
    time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
  };
};

/**
 * The instant a `HH:mm` on a given local date falls at, in a named zone.
 *
 * Done by correction rather than arithmetic because an offset is not a
 * constant: it depends on the date, and hard-coding +05:30 would be right for
 * India and wrong for the caregiver reading it from anywhere with daylight
 * saving.
 */
const instantFor = (localDate: string, timeOfDay: string, timezone: string): Date => {
  const wantedUtc = new Date(`${localDate}T${timeOfDay}:00Z`).getTime();

  // Two passes converge for every real zone, including half-hour offsets and
  // the hour either side of a daylight-saving change.
  let candidate = new Date(wantedUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const rendered = partsIn(candidate, timezone);
    const renderedUtc = new Date(`${rendered.date}T${rendered.time}:00Z`).getTime();
    candidate = new Date(candidate.getTime() + (wantedUtc - renderedUtc));
  }

  return candidate;
};

/** True while the schedule is in force on this local date. */
const activeOn = (schedule: TreatmentSchedule, localDate: string): boolean => {
  if (schedule.supersededAt !== null) return false;
  if (localDate < schedule.startDate) return false;
  if (schedule.endDate !== null && localDate > schedule.endDate) return false;
  return true;
};

/**
 * The doses due on one day, with what is known about each.
 *
 * `events` is every dose event for the patient; the newest event for an
 * occurrence wins, which is how undo works without deleting anything.
 */
export const occurrencesForDay = (
  schedules: TreatmentSchedule[],
  events: DoseEvent[],
  localDate: string,
): DoseOccurrence[] => {
  /**
   * Which events something later has replaced.
   *
   * This, rather than the clock, is what decides which event is current. An
   * event that supersedes another *is* the later one by construction, whatever
   * the two timestamps say — and the timestamps can say nothing useful: tapping
   * "taken" and then "undo" straight away puts both in the same millisecond,
   * and the tie-break was the id, whose suffix is random. Half the time the
   * undo lost, the dose stayed marked taken, and the person who had just
   * corrected it watched their correction disappear.
   */
  const superseded = new Set(
    events.flatMap((event) =>
      event.supersedesEventId === null ? [] : [event.supersedesEventId],
    ),
  );

  /**
   * Newest event per occurrence, among the ones nothing has replaced.
   *
   * `recordedAt` still orders what remains — an occurrence answered twice with
   * no chain between the answers is possible in an old record — and the id
   * still breaks a tie, because a comparison returning zero would leave the
   * result depending on array order, which is not a decision anybody made.
   */
  const latest = new Map<string, DoseEvent>();
  for (const event of [...events]
    .filter((event) => !superseded.has(event.id))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))) {
    latest.set(event.occurrenceKey, event);
  }

  /**
   * An undo returns the occurrence to "not recorded" rather than flipping it.
   *
   * The marker is on the event, not inferred from the states, so "taken, then
   * corrected to missed" and "taken, then undone" stay distinguishable.
   */
  const undoneKeys = new Set(
    [...latest.values()].filter((event) => event.undo).map((event) => event.occurrenceKey),
  );

  return schedules
    .filter((schedule) => activeOn(schedule, localDate))
    .flatMap((schedule) =>
      [...schedule.times].sort().map((timeOfDay) => {
        const occurrenceKey = occurrenceKeyFor(schedule.id, localDate, timeOfDay);
        const event = undoneKeys.has(occurrenceKey) ? undefined : latest.get(occurrenceKey);

        return {
          occurrenceKey,
          scheduleId: schedule.id,
          patientId: schedule.patientId,
          medicineName: schedule.name,
          dosage: schedule.dosage,
          dueAt: instantFor(localDate, timeOfDay, schedule.timezone).toISOString(),
          /**
           * Null when nothing has been recorded.
           *
           * Not `'missed'`. Silence is not evidence a tablet was skipped — the
           * person may have taken it and not opened the app, or be asleep, or
           * have no signal. Everything downstream depends on this staying null.
           */
          state: event?.state ?? null,
          recordedBy: event?.recordedBy ?? null,
          recordedBySelf: event?.recordedBySelf ?? null,
          recordedAt: event?.recordedAt ?? null,
          eventId: event?.id ?? null,
        } satisfies DoseOccurrence;
      }),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
};

/**
 * The next dose worth showing on the Today screen.
 *
 * The earliest unrecorded one, or nothing when today's are all recorded.
 * Deliberately does **not** fall back to an earlier day's unrecorded doses: a
 * screen asking "did you take Monday's tablet?" on Wednesday invites a guess,
 * and a guessed answer in a medication record is worse than no answer.
 */
export const nextDueDose = (occurrences: DoseOccurrence[]): DoseOccurrence | null =>
  occurrences.find((occurrence) => occurrence.state === null) ?? null;

export interface RecordDoseInput {
  occurrence: DoseOccurrence;
  state: DoseState;
  recordedBy: string;
  /** True when the person recording is the patient themselves. */
  recordedBySelf: boolean;
  now?: Date;
}

/**
 * Builds the event for a dose, or returns null if it would change nothing.
 *
 * Returning null for a repeat is what makes a double tap harmless: the same
 * occurrence in the same state produces no second event, so the record does not
 * grow a duplicate for one tablet.
 */
export const recordDose = ({
  occurrence,
  state,
  recordedBy,
  recordedBySelf,
  now = new Date(),
}: RecordDoseInput): DoseEvent | null => {
  if (occurrence.state === state) return null;

  return {
    id: createId('dse'),
    patientId: occurrence.patientId,
    scheduleId: occurrence.scheduleId,
    occurrenceKey: occurrence.occurrenceKey,
    occurrenceAt: occurrence.dueAt,
    state,
    // Not the same as `occurrenceAt`. Somebody recording at 9:40 a dose due at
    // 8:00 is telling you two different facts, and both are kept.
    recordedAt: now.toISOString(),
    recordedBy,
    recordedBySelf,
    supersedesEventId: occurrence.eventId,
    undo: false,
    createdAt: now.toISOString(),
  };
};

/**
 * Undoes whatever was recorded for a dose.
 *
 * Appends an event that supersedes the last one and returns the occurrence to
 * "not recorded". It does **not** delete anything: "did my mother take her
 * tablet this morning" is a question about the record, and a record that can be
 * quietly erased cannot answer it.
 *
 * It also does not touch the schedule. Undoing a tap is a statement about one
 * dose, never about the prescription.
 */
export const undoDose = (
  occurrence: DoseOccurrence,
  undoneBy: string,
  undoneBySelf: boolean,
  now: Date = new Date(),
): DoseEvent | null => {
  if (occurrence.eventId === null || occurrence.state === null) return null;

  return {
    id: createId('dse'),
    patientId: occurrence.patientId,
    scheduleId: occurrence.scheduleId,
    occurrenceKey: occurrence.occurrenceKey,
    occurrenceAt: occurrence.dueAt,
    // Carries the state it is undoing, so the trail reads "taken, then that was
    // undone" rather than "taken, then missed" — which would be a different and
    // much stronger claim.
    state: occurrence.state,
    recordedAt: now.toISOString(),
    recordedBy: undoneBy,
    recordedBySelf: undoneBySelf,
    supersedesEventId: occurrence.eventId,
    undo: true,
    createdAt: now.toISOString(),
  };
};

/**
 * How a dose should be described, in the words the screen uses.
 *
 * Centralised because the wording *is* the safety property. "Missed" must only
 * appear when a person said so, and a helper's entry must never read as the
 * patient's own confirmation.
 */
export const describeDose = (occurrence: DoseOccurrence): string => {
  if (occurrence.state === null) return 'Not recorded';
  if (occurrence.state === 'taken') {
    return occurrence.recordedBySelf === true ? 'Taken' : 'Recorded as taken by a helper';
  }
  return occurrence.recordedBySelf === true ? 'Marked as missed' : 'Recorded as missed by a helper';
};
