import type { IsoDate, IsoDateTime, SourceReference } from './domain';

/**
 * A medicine somebody has actually agreed to take, and the record of whether
 * they took it.
 *
 * ## The distinction this file exists to hold
 *
 * A {@link MedicineMention} is what a model read on a prescription. A
 * {@link TreatmentSchedule} is a statement that somebody is taking this, at
 * these times, starting now. They are not the same thing and one never becomes
 * the other by itself:
 *
 * - a mention has no times, because "twice a day" is not a clock;
 * - a mention has no start date, because a prescription found in a drawer may
 *   be two years old;
 * - a mention was never confirmed by a person.
 *
 * Generating a schedule from a mention would produce reminders to take a drug
 * on the strength of an OCR pass over a photograph. `confirmedBy` and
 * `confirmedAt` are required for exactly that reason.
 */

export type TreatmentProvenance =
  /** Read from a document, then confirmed by a person against the original. */
  | 'from_document'
  /** Typed in by a person, with no document behind it. */
  | 'manual';

export interface TreatmentSchedule {
  readonly id: string;
  readonly patientId: string;
  /** As written on the prescription, or as the person typed it. */
  name: string;
  /** e.g. "500 mg". Free text, because prescriptions are. */
  dosage: string;
  /**
   * Times of day, `HH:mm`, in {@link timezone}.
   *
   * A list rather than a frequency string. "Twice a day" cannot be turned into
   * a reminder without deciding *when*, and that decision belongs to the person
   * taking the medicine, not to a parser.
   */
  times: string[];
  /**
   * The zone the times are in — the patient's, not the device's.
   *
   * A daughter in Berlin opening her mother's record must see 8:00 IST, not
   * 4:30 in her own morning. Storing the zone rather than an offset survives
   * daylight saving, which India does not have but Berlin does.
   */
  timezone: string;
  readonly startDate: IsoDate;
  /** Null for "until somebody says otherwise". */
  endDate: IsoDate | null;
  readonly provenance: TreatmentProvenance;
  /** The document this was read from, when there was one. */
  source: SourceReference | null;
  /**
   * Who confirmed this is being taken, and when.
   *
   * Required. A schedule with no confirmation is a reading of a document, and
   * this app must never turn one into reminders on its own.
   */
  readonly confirmedBy: string;
  readonly confirmedAt: IsoDateTime;
  /** Set when a newer schedule replaces this one. Never deleted. */
  supersededAt: IsoDateTime | null;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type DoseState = 'taken' | 'missed';

/**
 * Something that happened to one dose, at one moment.
 *
 * Append-only. Undo does not delete an event, it adds one — see
 * {@link DoseEvent.supersedesEventId} — because "did my mother take her tablet
 * this morning" is a question about the record, and a record you can quietly
 * erase cannot answer it.
 */
export interface DoseEvent {
  readonly id: string;
  readonly patientId: string;
  readonly scheduleId: string;
  /**
   * The occurrence this is about: schedule, date and time of day, together.
   *
   * The identity of a dose, and what makes recording idempotent. Two taps on
   * "I've taken it" produce the same occurrence key, so the second is
   * recognised rather than creating a second event for one tablet.
   */
  readonly occurrenceKey: string;
  /** When the dose was due, as an absolute instant. */
  readonly occurrenceAt: IsoDateTime;
  readonly state: DoseState;
  /** When somebody pressed the button, which is not when the dose was due. */
  readonly recordedAt: IsoDateTime;
  readonly recordedBy: string;
  /**
   * Whether the person who recorded it is the patient.
   *
   * The screen says "recorded by a helper" rather than "confirmed by" for the
   * other case, because a helper marking a dose taken is reporting what they
   * believe, and the difference matters to whoever reads it next.
   */
  readonly recordedBySelf: boolean;
  /** The event this replaces, when this is an undo or a correction. */
  readonly supersedesEventId: string | null;
  /**
   * True when this event undoes the one it supersedes.
   *
   * Marked rather than inferred from the states, so "taken, then corrected to
   * missed" and "taken, then undone" stay distinguishable. They mean different
   * things to whoever reads the record next, and one of them is a much stronger
   * claim than the other.
   */
  readonly undo: boolean;
  readonly createdAt: IsoDateTime;
}

/**
 * A dose that is due, with whatever is known about it.
 *
 * `state` is deliberately `null` rather than `'missed'` when nothing has been
 * recorded. **A dose with no confirmation is not a missed dose.** Nobody may
 * infer from silence that a tablet was not taken — the person may have taken it
 * and not opened the app, or be asleep, or have no signal. The screen says
 * "not recorded", and so does this type.
 */
export interface DoseOccurrence {
  readonly occurrenceKey: string;
  readonly scheduleId: string;
  readonly patientId: string;
  readonly medicineName: string;
  readonly dosage: string;
  readonly dueAt: IsoDateTime;
  /** Null means not recorded, which is not the same as missed. */
  readonly state: DoseState | null;
  readonly recordedBy: string | null;
  readonly recordedBySelf: boolean | null;
  readonly recordedAt: IsoDateTime | null;
  /** The event to supersede if this is undone. */
  readonly eventId: string | null;
}
