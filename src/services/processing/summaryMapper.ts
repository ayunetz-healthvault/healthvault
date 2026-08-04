import { DocumentProcessingError } from './types';

import type { BackendSourceReference, BackendSummary, ProcessDocumentResponse } from './types';
import type {
  DoctorCategory,
  DocumentSummary,
  FollowUpKind,
  MedicalDocument,
  RedactionCategory,
  SourceReference,
  SummaryUncertainty,
} from '@/types/domain';
import { nowIso } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Turns a backend response into the app's `DocumentSummary`.
 *
 * Two jobs beyond renaming fields:
 *
 * 1. **Identity.** The backend has no idea what this document is called in the
 *    vault — it was deliberately given a pseudonymous reference. Ids for the
 *    summary, its findings and its medicines are minted here, against the local
 *    document.
 * 2. **Validation.** The response is parsed rather than trusted. A dev backend
 *    on a laptop over an unauthenticated port is not a hardened source, and a
 *    malformed payload must fail cleanly rather than land half-populated in the
 *    vault where it would render as blank rows.
 */

const DOCTOR_CATEGORIES = new Set<DoctorCategory>([
  'general_physician',
  'cardiologist',
  'endocrinologist',
  'nephrologist',
  'orthopaedic',
  'ophthalmologist',
  'pulmonologist',
  'neurologist',
  'gastroenterologist',
  'dermatologist',
]);

const FOLLOW_UP_KINDS = new Set<FollowUpKind>([
  'doctor_visit',
  'lab_test',
  'medicine_refill',
  'vaccination',
  'physiotherapy',
  'other',
]);

const REDACTION_CATEGORIES: RedactionCategory[] = [
  'patientName',
  'personName',
  'address',
  'phone',
  'email',
  'dateOfBirth',
  'aadhaar',
  'pan',
  'passport',
  'patientId',
  'insuranceId',
  'other',
];

const invalid = (what: string): DocumentProcessingError =>
  // `validation_failed` rather than `unknown`: the request succeeded and the
  // reply was the wrong shape, which is a different problem to a crash.
  new DocumentProcessingError('validation_failed', `The summary reply was missing ${what}.`);

const requireString = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw invalid(what);
  return value;
};

const requireArray = <T>(value: unknown, what: string): T[] => {
  if (!Array.isArray(value)) throw invalid(what);
  return value as T[];
};

/** Clamped rather than rejected: a confidence is a hint, not a clinical value. */
const readConfidence = (value: unknown): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
};

const readDoctorCategory = (value: unknown): DoctorCategory =>
  DOCTOR_CATEGORIES.has(value as DoctorCategory)
    ? (value as DoctorCategory)
    : // A category the app cannot render is worse than a safe default; the
      // general physician is where an unclear referral goes anyway.
      'general_physician';

const readFollowUpKind = (value: unknown): FollowUpKind =>
  FOLLOW_UP_KINDS.has(value as FollowUpKind) ? (value as FollowUpKind) : 'other';

const toSources = (
  sources: BackendSourceReference[] | undefined,
  documentId: string,
): SourceReference[] =>
  (sources ?? [])
    .filter((source) => Number.isInteger(source.page) && source.page > 0)
    .map((source) => ({
      documentId,
      page: source.page,
      ...(source.textSnippet === undefined ? {} : { textSnippet: source.textSnippet }),
    }));

/**
 * Unreadable pages become uncertainties.
 *
 * They belong with everything else the pipeline could not do, and the summary
 * screen already has one place for that. A separate field would mean a second
 * thing to remember to render, and the one that gets forgotten is always the
 * one that says a page is missing.
 */
const unreadablePagesAsUncertainties = (pages: number[]): SummaryUncertainty[] =>
  pages.map((page) => ({
    message: `Page ${page} could not be read, so nothing from it is included below.`,
    sourcePage: page,
  }));

const toRedactionCounts = (counts: Record<string, number>): Record<RedactionCategory, number> =>
  Object.fromEntries(
    REDACTION_CATEGORIES.map((category) => [
      category,
      Math.max(0, Math.trunc(counts[category] ?? 0)),
    ]),
  ) as Record<RedactionCategory, number>;

export const toDocumentSummary = (
  response: ProcessDocumentResponse,
  document: MedicalDocument,
): DocumentSummary => {
  const summary: BackendSummary | undefined = response.summary;

  if (summary === null || typeof summary !== 'object') {
    throw invalid('a summary');
  }

  const documentId = document.id;

  const uncertainties: SummaryUncertainty[] = [
    ...unreadablePagesAsUncertainties(
      Array.isArray(summary.unreadablePages) ? summary.unreadablePages : [],
    ),
    ...requireArray<{ message?: unknown; sourcePage?: unknown }>(
      summary.uncertainties ?? [],
      'uncertainties',
    )
      .filter((item) => typeof item.message === 'string' && item.message.length > 0)
      .map((item) => ({
        message: item.message as string,
        sourcePage: typeof item.sourcePage === 'number' ? item.sourcePage : null,
      })),
  ];

  return {
    id: createId('sum'),
    documentId,
    parentId: document.parentId,
    overview: requireString(summary.overview, 'an overview'),
    plainLanguageSummary: requireString(summary.plainLanguageSummary, 'a plain-language summary'),

    findings: requireArray<BackendSummary['findings'][number]>(summary.findings, 'findings').map(
      (finding) => ({
        id: createId('fnd'),
        label: requireString(finding.label, 'a finding label'),
        value: requireString(finding.value, 'a finding value'),
        referenceRange: finding.referenceRange ?? null,
        severity: finding.severity,
        plainLanguage: finding.plainLanguage,
        ...(finding.unit === undefined ? {} : { unit: finding.unit }),
        sources: toSources(finding.sources, documentId),
      }),
    ),

    medicines: requireArray<BackendSummary['medicines'][number]>(
      summary.medicines,
      'medicines',
    ).map((medicine) => ({
      id: createId('med'),
      name: requireString(medicine.name, 'a medicine name'),
      dosage: medicine.dosage,
      frequency: medicine.frequency,
      purpose: medicine.purpose,
      ...(medicine.duration === undefined ? {} : { duration: medicine.duration }),
      sources: toSources(medicine.sources, documentId),
    })),

    instructions: requireArray<string>(summary.instructions, 'instructions').filter(
      (instruction) => typeof instruction === 'string' && instruction.length > 0,
    ),

    recommendedDoctorCategory: readDoctorCategory(summary.recommendedDoctorCategory),

    questionsForDoctor: requireArray<string>(
      summary.questionsForDoctor,
      'questions for the doctor',
    ).filter((question) => typeof question === 'string' && question.length > 0),

    confidence: readConfidence(summary.confidence),

    explicitFollowUps: requireArray<BackendSummary['explicitFollowUps'][number]>(
      summary.explicitFollowUps ?? [],
      'follow-ups',
    ).map((followUp) => ({
      title: followUp.title,
      date: followUp.date,
      kind: readFollowUpKind(followUp.kind),
      source: toSources([followUp.source], documentId)[0] ?? { documentId, page: 1 },
      confidence: readConfidence(followUp.confidence),
    })),

    uncertainties,

    privacy: {
      redactionApplied: response.privacy?.redactionApplied ?? false,
      possiblePiiRemaining: response.privacy?.possiblePiiRemaining ?? false,
      redactedEntityCounts: toRedactionCounts(response.privacy?.redactedEntityCounts ?? {}),
      pipelineVersion: response.privacy?.pipelineVersion ?? 'unknown',
    },

    ...(summary.detectedDocumentDate === undefined
      ? {}
      : { detectedDocumentDate: summary.detectedDocumentDate }),
    pipelineVersion: summary.pipelineVersion,
    generatedBy: summary.generatedBy,
    generatedAt: nowIso(),
  };
};
