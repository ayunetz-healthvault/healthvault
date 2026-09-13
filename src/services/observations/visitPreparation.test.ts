import { attributeObservation, attributeQuestion, buildVisitPreparation, isStale } from './visitPreparation';

import type { DocumentSummary, MedicalDocument } from '@/types/domain';
import type { Observation, VisitQuestion } from '@/types/observations';

/**
 * Getting a visit's notes together.
 *
 * The assertions worth having are about attribution and about what is carried
 * forward. A doctor reading the list has to be able to tell what the patient
 * reported from what a helper observed, and a value the pipeline could not read
 * confidently is exactly the thing worth asking about — so it is carried, not
 * quietly dropped for a cleaner-looking summary.
 */

const NOW = new Date('2026-09-08T10:00:00.000Z');

const observation = (patch: Partial<Observation> = {}): Observation => ({
  id: 'obs_1',
  patientId: 'pat_1',
  text: 'Felt dizzy after the new tablet',
  occurredAt: '2026-09-07T06:00:00.000Z',
  impact: 'moderately',
  recordedBy: 'acc_meera',
  recordedBySelf: true,
  recordedAt: '2026-09-07T06:30:00.000Z',
  version: 1,
  updatedAt: '2026-09-07T06:30:00.000Z',
  ...patch,
});

const question = (patch: Partial<VisitQuestion> = {}): VisitQuestion => ({
  id: 'qst_1',
  patientId: 'pat_1',
  text: 'Should I keep taking this if it makes me dizzy?',
  origin: 'user',
  source: null,
  askedBy: 'acc_meera',
  askedBySelf: true,
  createdAt: '2026-09-07T07:00:00.000Z',
  order: 0,
  version: 1,
  updatedAt: '2026-09-07T07:00:00.000Z',
  ...patch,
});

const document = (patch: Partial<MedicalDocument> = {}): MedicalDocument => ({
  id: 'doc_1',
  parentId: 'pat_1',
  title: 'Blood test report',
  category: 'lab_report',
  documentDate: '2026-09-01',
  pages: [],
  status: 'ready',
  uploadProgress: 100,
  summaryId: 'sum_1',
  failureReason: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...patch,
});

const summary = (patch: Partial<DocumentSummary> = {}): DocumentSummary =>
  ({
    id: 'sum_1',
    documentId: 'doc_1',
    parentId: 'pat_1',
    overview: 'A blood test.',
    plainLanguageSummary: '',
    findings: [],
    medicines: [],
    instructions: [],
    recommendedDoctorCategory: 'general_physician',
    questionsForDoctor: [],
    confidence: 0.8,
    generatedBy: 'mock',
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  }) as DocumentSummary;

const build = (overrides: Partial<Parameters<typeof buildVisitPreparation>[0]> = {}) =>
  buildVisitPreparation({
    patientId: 'pat_1',
    followUpId: 'fup_1',
    observations: [observation()],
    questions: [question()],
    documents: [document()],
    summaries: [summary()],
    confirmedMedicineNames: ['Metformin'],
    lastSyncedAt: '2026-09-08T09:55:00.000Z',
    since: '2026-08-01T00:00:00.000Z',
    ...overrides,
  });

describe('building a visit summary', () => {
  it('gathers this record’s observations and questions', () => {
    const preparation = build();

    expect(preparation.observations).toHaveLength(1);
    expect(preparation.questions).toHaveLength(1);
  });

  it('leaves another record’s notes out entirely', () => {
    const preparation = build({
      observations: [observation(), observation({ id: 'obs_2', patientId: 'pat_2' })],
      questions: [question(), question({ id: 'qst_2', patientId: 'pat_2' })],
    });

    expect(preparation.observations.map((entry) => entry.patientId)).toEqual(['pat_1']);
    expect(preparation.questions.map((entry) => entry.patientId)).toEqual(['pat_1']);
  });

  it('drops observations older than the window', () => {
    const preparation = build({
      observations: [observation(), observation({ id: 'obs_old', occurredAt: '2025-01-01T00:00:00.000Z' })],
    });

    expect(preparation.observations.map((entry) => entry.id)).toEqual(['obs_1']);
  });

  it('puts the most recent observation first', () => {
    const preparation = build({
      observations: [
        observation({ id: 'obs_old', occurredAt: '2026-08-02T00:00:00.000Z' }),
        observation({ id: 'obs_new', occurredAt: '2026-09-07T00:00:00.000Z' }),
      ],
    });

    expect(preparation.observations.map((entry) => entry.id)).toEqual(['obs_new', 'obs_old']);
  });

  it('keeps the family’s own ordering of questions', () => {
    const preparation = build({
      questions: [question({ id: 'q2', order: 1 }), question({ id: 'q1', order: 0 })],
    });

    expect(preparation.questions.map((entry) => entry.id)).toEqual(['q1', 'q2']);
  });

  /**
   * A value nobody could read confidently is exactly the thing worth asking
   * about. Dropping it would present a cleaner picture than the record supports.
   */
  it('carries forward what the summariser could not read', () => {
    const preparation = build({
      summaries: [
        summary({
          uncertainties: [{ message: 'The creatinine value was not legible.', sourcePage: 2 }],
        }),
      ],
    });

    expect(preparation.uncertainties).toEqual(['The creatinine value was not legible.']);
  });

  it('does not repeat the same uncertainty from two summaries', () => {
    const repeated = { message: 'Page 2 was blurred.', sourcePage: 2 };
    const preparation = build({
      summaries: [
        summary({ uncertainties: [repeated] }),
        summary({ id: 'sum_2', documentId: 'doc_2', uncertainties: [repeated] }),
      ],
    });

    expect(preparation.uncertainties).toHaveLength(1);
  });

  /** An unchecked summary is a reason to bring the original, not to leave it. */
  it('says which documents nobody has checked yet', () => {
    const preparation = build({
      documents: [document(), document({ id: 'doc_2', reviewedAt: '2026-09-02T00:00:00.000Z' })],
    });

    expect(preparation.documents).toEqual([
      expect.objectContaining({ documentId: 'doc_1', reviewed: false }),
      expect.objectContaining({ documentId: 'doc_2', reviewed: true }),
    ]);
  });

  /** Confirmed medicines only. An AI's reading of a prescription is not one. */
  it('lists only medicines from a confirmed schedule', () => {
    const preparation = build({ confirmedMedicineNames: [] });

    expect(preparation.medicines).toEqual([]);
  });
});

describe('whether the notes are current', () => {
  it('is stale when the record has never synced', () => {
    expect(isStale(build({ lastSyncedAt: null }), NOW)).toBe(true);
  });

  it('is current shortly after a sync', () => {
    expect(isStale(build(), NOW)).toBe(false);
  });

  /** A week-old record may be missing whatever a sibling added since. */
  it('is stale once the record is well out of date', () => {
    expect(isStale(build({ lastSyncedAt: '2026-09-01T00:00:00.000Z' }), NOW)).toBe(true);
  });
});

describe('attribution', () => {
  /**
   * What a helper observed is a different claim from what the patient reported
   * about themselves, and a doctor reading the list needs to know which.
   */
  it('distinguishes the patient’s own note from a helper’s', () => {
    expect(attributeObservation(observation({ recordedBySelf: true }))).toBe('Noted by them');
    expect(attributeObservation(observation({ recordedBySelf: false }))).toBe('Noted by a helper');
  });

  /**
   * An accepted suggestion is still a machine's question that somebody agreed
   * with. Presenting it as the family's own overstates the thought behind it.
   */
  it('says when a question came from the app', () => {
    expect(attributeQuestion(question({ origin: 'accepted_suggestion' }))).toMatch(
      /suggested by the app/i,
    );
    expect(attributeQuestion(question({ origin: 'user', askedBySelf: true }))).toBe('Asked by them');
    expect(attributeQuestion(question({ origin: 'user', askedBySelf: false }))).toBe(
      'Asked by a helper',
    );
  });
});
