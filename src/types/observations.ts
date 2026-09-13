import type { IsoDateTime, SourceReference } from './domain';

/**
 * What a person noticed, in their own words, and what they want to ask about
 * it.
 *
 * ## What an observation is not
 *
 * It is not a symptom the app has classified, and it never becomes one. There
 * is no severity scale, no triage category and no "seek care now" flag,
 * because the moment this app assigns clinical weight to "Amma felt dizzy
 * after the new tablet" it is practising medicine on the strength of a text
 * box.
 *
 * `impact` is the closest thing here to a scale, and it is deliberately about
 * the person's *day* rather than their condition: "a little", "moderately", "a
 * lot" is something they can answer and nobody can mistake for a grading.
 */

/** How much this is affecting the person's day. Their answer, not a grading. */
export type ObservationImpact = 'a_little' | 'moderately' | 'a_lot';

export const IMPACT_LABELS: Record<ObservationImpact, string> = {
  a_little: 'A little',
  moderately: 'Moderately',
  a_lot: 'A lot',
};

export interface Observation {
  readonly id: string;
  readonly patientId: string;
  /**
   * Exactly what the person wrote.
   *
   * Never normalised, never mapped to a term, never rewritten. "A funny feeling
   * in my chest after climbing the stairs" is more useful to a doctor than
   * anything a parser would turn it into, and turning it into "dyspnoea on
   * exertion" would be this app writing a clinical note.
   */
  text: string;
  /** When it happened, which is not when it was written down. */
  occurredAt: IsoDateTime;
  impact: ObservationImpact;
  readonly recordedBy: string;
  /** True when the person who wrote it is the patient. */
  readonly recordedBySelf: boolean;
  readonly recordedAt: IsoDateTime;
  /** Bumped on each edit, so a concurrent change is a conflict not a race. */
  version: number;
  updatedAt: IsoDateTime;
}

export type QuestionOrigin =
  /** Written by a person. */
  | 'user'
  /**
   * Suggested by the summariser and then *accepted* by a person.
   *
   * Never present without that acceptance: an unaccepted suggestion is part of
   * the summary, not part of the visit. The origin is kept after acceptance so
   * the list can say where it came from rather than presenting a machine's
   * question as the family's own.
   */
  | 'accepted_suggestion';

export interface VisitQuestion {
  readonly id: string;
  readonly patientId: string;
  text: string;
  readonly origin: QuestionOrigin;
  /** The summary a suggestion came from, when it was one. */
  readonly source: SourceReference | null;
  readonly askedBy: string;
  readonly askedBySelf: boolean;
  readonly createdAt: IsoDateTime;
  /** Lower sorts first. The family's own ordering, not a priority. */
  order: number;
  version: number;
  updatedAt: IsoDateTime;
}

/**
 * Everything gathered for one appointment.
 *
 * Assembled for reading, and read by a person. Nothing here is sent anywhere:
 * preparing for a visit is an act of getting your notes together, and this app
 * does not message clinicians.
 */
export interface VisitPreparation {
  readonly patientId: string;
  readonly followUpId: string;
  readonly observations: Observation[];
  readonly questions: VisitQuestion[];
  /** Documents the family chose to bring, and whether anyone has checked them. */
  readonly documents: { documentId: string; title: string; reviewed: boolean }[];
  /** Confirmed medicines, by name only — the schedule is in the app. */
  readonly medicines: string[];
  /** Anything the summariser could not read confidently, carried forward. */
  readonly uncertainties: string[];
  /** When the underlying record was last known to be current. */
  readonly lastSyncedAt: IsoDateTime | null;
}
