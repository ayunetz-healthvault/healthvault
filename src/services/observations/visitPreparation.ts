import type { Observation, VisitPreparation, VisitQuestion } from '@/types/observations';
import type { DocumentSummary, MedicalDocument } from '@/types/domain';

/**
 * Putting a visit's notes together.
 *
 * Pure, and read-only over the record. The one thing worth stating about this
 * module is what it does *not* do: it sends nothing, notifies nobody and makes
 * no clinical judgement. Preparing for a visit is getting your own notes in
 * order, and every attempt to make it more than that turns an app for families
 * into an app that talks to doctors on their behalf.
 */

export interface BuildVisitInput {
  patientId: string;
  followUpId: string;
  observations: Observation[];
  questions: VisitQuestion[];
  documents: MedicalDocument[];
  summaries: DocumentSummary[];
  /** Names of medicines on a confirmed schedule. Never AI mentions. */
  confirmedMedicineNames: string[];
  lastSyncedAt: string | null;
  /** How far back to gather observations. */
  since?: string;
}

/**
 * Observations near enough to the visit to be worth mentioning.
 *
 * Default six weeks. Long enough to cover the gap between appointments, short
 * enough that a doctor is not handed a year of notes — a list nobody reads is
 * the same as no list.
 */
const DEFAULT_WINDOW_DAYS = 42;

export const buildVisitPreparation = ({
  patientId,
  followUpId,
  observations,
  questions,
  documents,
  summaries,
  confirmedMedicineNames,
  lastSyncedAt,
  since,
}: BuildVisitInput): VisitPreparation => {
  const cutoff =
    since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const relevant = observations
    .filter((observation) => observation.patientId === patientId && observation.occurredAt >= cutoff)
    // Newest first: the doctor asks "how has it been lately", not "since when".
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const patientDocuments = documents.filter((document) => document.parentId === patientId);

  /**
   * Uncertainties are carried forward rather than dropped.
   *
   * A value the pipeline could not read confidently is exactly the thing worth
   * asking about, and a visit summary that quietly omitted them would present
   * a cleaner picture than the record supports.
   */
  const uncertainties = summaries
    .filter((summary) => summary.parentId === patientId)
    .flatMap((summary) => summary.uncertainties ?? [])
    .map((uncertainty) => uncertainty.message);

  return {
    patientId,
    followUpId,
    observations: relevant,
    questions: [...questions]
      .filter((question) => question.patientId === patientId)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)),
    documents: patientDocuments.map((document) => ({
      documentId: document.id,
      title: document.title,
      // Shown so the family knows which summaries nobody has checked. An
      // unchecked summary is not a reason to leave the document behind — it is
      // a reason to bring the original.
      reviewed: document.reviewedAt !== null && document.reviewedAt !== undefined,
    })),
    medicines: confirmedMedicineNames,
    uncertainties: [...new Set(uncertainties)],
    lastSyncedAt,
  };
};

/**
 * Whether this preparation is safe to rely on as current.
 *
 * A visit summary assembled from a record that last synced a week ago may be
 * missing whatever a sibling added since. Saying so is the difference between a
 * useful list and a misleading one.
 */
export const isStale = (
  preparation: VisitPreparation,
  now: Date = new Date(),
  maxAgeMinutes = 60,
): boolean => {
  if (preparation.lastSyncedAt === null) return true;
  return now.getTime() - new Date(preparation.lastSyncedAt).getTime() > maxAgeMinutes * 60_000;
};

/**
 * How an observation should be attributed on screen.
 *
 * A helper's note is what the helper observed, which is a different claim from
 * what the patient reported about themselves. A doctor reading the list needs
 * to know which is which.
 */
export const attributeObservation = (observation: Observation): string =>
  observation.recordedBySelf ? 'Noted by them' : 'Noted by a helper';

/**
 * How a question should be attributed.
 *
 * An accepted suggestion is still a machine's question that a person agreed
 * with. Presenting it as the family's own would overstate how much thought went
 * into it.
 */
export const attributeQuestion = (question: VisitQuestion): string =>
  question.origin === 'accepted_suggestion'
    ? 'Suggested by the app, kept by the family'
    : question.askedBySelf
      ? 'Asked by them'
      : 'Asked by a helper';
