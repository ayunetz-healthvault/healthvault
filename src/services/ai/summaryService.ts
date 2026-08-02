import { apiClient } from '../api/client';
import { endpoints } from '../api/endpoints';

import { isBackendEnabled } from '@/config/env';
import { MOCK_SUMMARIES } from '@/mocks/documents';
import type {
  DoctorCategory,
  DocumentCategory,
  DocumentSummary,
  MedicalDocument,
  ProcessingStatus,
} from '@/types/domain';
import { nowIso } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Document understanding.
 *
 * ## Why the client never calls an LLM
 * The mobile app has no model API key and never will. Shipping one inside an
 * APK is equivalent to publishing it. The production path is:
 *
 *   S3 ObjectCreated -> SQS -> Lambda worker
 *     -> Textract (OCR)                         : pull text out of the scan/PDF
 *     -> Comprehend Medical (optional)          : entity extraction, in-region
 *     -> Bedrock / OpenAI via Secrets Manager   : plain-language summary
 *     -> DynamoDB (summary item, KMS-encrypted)
 *
 * The phone only ever polls `GET /v1/documents/{id}/processing` and then reads
 * the finished summary. The prompt, the key and the raw report text all stay
 * inside the VPC.
 *
 * Everything below is a deterministic stand-in with the same interface.
 */

export interface ProcessingState {
  documentId: string;
  status: ProcessingStatus;
  /** 0–100 through the OCR → extract → summarise pipeline. */
  progress: number;
  /** Which pipeline stage is running, for the status screen. */
  stage: ProcessingStage;
  summaryId: string | null;
  failureReason: string | null;
}

export type ProcessingStage =
  | 'queued'
  | 'reading_pages' // Textract OCR
  | 'extracting_values' // structured findings
  | 'writing_summary' // LLM
  | 'done'
  | 'failed';

export const PROCESSING_STAGE_LABELS: Record<ProcessingStage, string> = {
  queued: 'Waiting in the queue',
  reading_pages: 'Reading the pages',
  extracting_values: 'Picking out test results and medicines',
  writing_summary: 'Writing a plain-language summary',
  done: 'Done',
  failed: 'Could not finish',
};

/** What the status screen shows while it waits. Order matters. */
export const PROCESSING_STAGES: ProcessingStage[] = [
  'queued',
  'reading_pages',
  'extracting_values',
  'writing_summary',
  'done',
];

/** Sensible specialist per document type, used when generating a fresh summary. */
const DEFAULT_DOCTOR_BY_CATEGORY: Record<DocumentCategory, DoctorCategory> = {
  lab_report: 'general_physician',
  prescription: 'general_physician',
  discharge_summary: 'general_physician',
  imaging: 'orthopaedic',
  consultation_note: 'general_physician',
  insurance: 'general_physician',
  other: 'general_physician',
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Builds a plausible summary for a newly captured document.
 *
 * Deliberately conservative: it describes what was captured and prompts the
 * family to check with a doctor, rather than inventing clinical values. The
 * seeded demo documents carry richer, hand-written summaries instead.
 */
const buildGeneratedSummary = (document: MedicalDocument): DocumentSummary => {
  const pageCount = document.pages.length;
  const pageWord = pageCount === 1 ? 'page' : 'pages';

  return {
    id: createId('sum'),
    documentId: document.id,
    parentId: document.parentId,
    overview: `A ${pageCount}-${pageWord} ${document.category.replace(/_/g, ' ')} dated ${document.documentDate}, added from this phone.`,
    plainLanguageSummary:
      'This is a demonstration summary. In the released app, the uploaded pages are read by the document pipeline in AWS and turned into a plain-language explanation here — what the document says, which numbers are outside the normal range, and what the doctor asked for next. Nothing in this preview has been read from your actual document.',
    findings: [
      {
        id: createId('fnd'),
        label: 'Pages captured',
        value: `${pageCount}`,
        referenceRange: null,
        severity: 'normal',
        plainLanguage: `${pageCount} ${pageWord} were captured and stored against this parent's record.`,
      },
    ],
    medicines: [],
    instructions: [
      'Keep the original paper copy — this app stores a photograph, not a certified record.',
      'Take this document to the next consultation.',
    ],
    recommendedDoctorCategory: DEFAULT_DOCTOR_BY_CATEGORY[document.category],
    questionsForDoctor: [
      'Could you walk me through what this document means?',
      'Does anything here change the current medicines?',
      'When should we repeat this test or review?',
    ],
    // Low on purpose: the UI hedges harder below 0.7.
    confidence: 0.55,
    generatedBy: 'ayunetz-mock-summariser/0.1',
    generatedAt: nowIso(),
  };
};

export const summaryService = {
  /**
   * Walks the pipeline stages, reporting progress. In production this is a poll
   * loop against `endpoints.processing.status`; the callback signature is
   * identical so the screen does not change.
   */
  async processDocument(
    document: MedicalDocument,
    onStateChange?: (state: ProcessingState) => void,
    signal?: AbortSignal,
  ): Promise<DocumentSummary> {
    if (isBackendEnabled()) {
      // TODO(backend): poll `endpoints.processing.status(document.id)` with
      // exponential backoff until status is `ready` or `failed`, then GET the
      // summary. The SQS worker typically finishes in 8–20 seconds.
      const state = await apiClient.get<ProcessingState>(endpoints.processing.status(document.id));
      onStateChange?.(state);
      return apiClient.get<DocumentSummary>(endpoints.summaries.getForDocument(document.id));
    }

    const stages: ProcessingStage[] = [
      'queued',
      'reading_pages',
      'extracting_values',
      'writing_summary',
    ];
    // Reading scales with page count, which keeps the progress bar honest.
    const perStageMs = 900 + document.pages.length * 200;

    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index] ?? 'queued';
      onStateChange?.({
        documentId: document.id,
        status: index === 0 ? 'uploaded' : 'processing',
        progress: Math.round((index / stages.length) * 100),
        stage,
        summaryId: null,
        failureReason: null,
      });
      await sleep(perStageMs);
      if (signal?.aborted) {
        throw new Error('Processing cancelled.');
      }
    }

    const summary = summaryService.summaryForDocument(document);

    onStateChange?.({
      documentId: document.id,
      status: 'ready',
      progress: 100,
      stage: 'done',
      summaryId: summary.id,
      failureReason: null,
    });

    return summary;
  },

  /** Returns the hand-written demo summary when there is one, else generates. */
  summaryForDocument(document: MedicalDocument): DocumentSummary {
    const seeded = MOCK_SUMMARIES.find((summary) => summary.documentId === document.id);
    return seeded ?? buildGeneratedSummary(document);
  },

  async fetchSummary(documentId: string): Promise<DocumentSummary | null> {
    if (isBackendEnabled()) {
      return apiClient.get<DocumentSummary>(endpoints.summaries.getForDocument(documentId));
    }
    return MOCK_SUMMARIES.find((summary) => summary.documentId === documentId) ?? null;
  },
};

/** Copy shown wherever a summary appears. Non-negotiable — see README. */
export const AI_SUMMARY_DISCLAIMER =
  'This summary is generated automatically and may be incomplete or wrong. It is not medical advice. Always check the original document and speak to a qualified doctor before making any decision about treatment.';
