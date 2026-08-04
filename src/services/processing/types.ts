import { ApiError } from '../api/errors';

/**
 * The Phase 1 development backend's contract, mirrored on the client.
 *
 * Written from docs/architecture/phase-1.md § "API contract" rather than
 * imported: the backend is a separate package with no shared dependency tree,
 * deliberately (see backend/README.md). This file and the backend's
 * `src/types/processing.ts` are kept in step by that written contract.
 */

/** Matches the backend's `ProcessingFailureCode`. */
export type ProcessingFailureCode =
  | 'invalid_file'
  | 'upload_failed'
  | 'ocr_failed'
  | 'privacy_failed'
  | 'ai_failed'
  | 'validation_failed'
  | 'processing_timeout'
  | 'manual_review_required'
  | 'unknown';

export interface ProcessingErrorBody {
  code: ProcessingFailureCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * A pipeline failure, carrying the backend's typed code.
 *
 * Extends `ApiError` so every existing call site — and the error taxonomy the
 * screens already branch on — keeps working unchanged.
 */
export class DocumentProcessingError extends ApiError {
  readonly code: ProcessingFailureCode;
  readonly retryable: boolean;

  constructor(
    code: ProcessingFailureCode,
    message: string,
    options: { retryable?: boolean; status?: number | null; cause?: unknown } = {},
  ) {
    super(KIND_BY_CODE[code], message, {
      status: options.status ?? null,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'DocumentProcessingError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }

  /**
   * Copy shown to the caregiver.
   *
   * The privacy case is the one that matters. It says the document could not be
   * processed safely and stops there — naming what was found would put the
   * identifier back on screen, and a screenshot of an error message is exactly
   * how that ends up in a WhatsApp thread.
   */
  override get userMessage(): string {
    switch (this.code) {
      case 'privacy_failed':
        return 'This document could not be processed safely, so nothing was sent for summarising. It may still contain personal details we could not remove. You can still open the original in the document view.';
      case 'ocr_failed':
        return 'We could not read any text from these pages. Try photographing them again in better light, with the whole page in frame.';
      case 'invalid_file':
        return 'These pages could not be accepted. Check that each one is a JPG or PNG photograph under the size limit.';
      case 'manual_review_required':
        return 'This document needs a closer look before it can be summarised.';
      case 'processing_timeout':
        return 'Reading this document took too long. Please try again.';
      case 'ai_failed':
      case 'validation_failed':
        return 'The summary could not be produced. Your pages are safe — please try again in a moment.';
      case 'upload_failed':
      case 'unknown':
      default:
        return super.userMessage;
    }
  }
}

/** How a pipeline code lands in the app's existing error taxonomy. */
const KIND_BY_CODE: Record<ProcessingFailureCode, ApiError['kind']> = {
  invalid_file: 'too_large',
  upload_failed: 'network',
  ocr_failed: 'unknown',
  privacy_failed: 'unknown',
  ai_failed: 'server',
  validation_failed: 'server',
  processing_timeout: 'timeout',
  manual_review_required: 'unknown',
  unknown: 'unknown',
};

// --- Success payload --------------------------------------------------------

export interface BackendSourceReference {
  page: number;
  textSnippet?: string;
}

export interface BackendFinding {
  label: string;
  value: string;
  unit?: string | null;
  referenceRange: string | null;
  severity: 'normal' | 'watch' | 'attention';
  plainLanguage: string;
  sources: BackendSourceReference[];
}

export interface BackendMedicine {
  name: string;
  dosage: string;
  frequency: string;
  purpose: string;
  duration?: string | null;
  sources: BackendSourceReference[];
}

export interface BackendExplicitFollowUp {
  title: string;
  date: string | null;
  kind: string;
  source: BackendSourceReference;
  confidence: number;
}

export interface BackendUncertainty {
  message: string;
  sourcePage: number | null;
}

export interface BackendSummary {
  overview: string;
  plainLanguageSummary: string;
  findings: BackendFinding[];
  medicines: BackendMedicine[];
  instructions: string[];
  recommendedDoctorCategory: string;
  questionsForDoctor: string[];
  confidence: number;
  detectedDocumentDate?: string | null;
  explicitFollowUps: BackendExplicitFollowUp[];
  uncertainties: BackendUncertainty[];
  pipelineVersion: string;
  generatedBy: string;
  ocrConfidence: number | null;
  unreadablePages: number[];
}

export interface BackendPrivacyResult {
  redactionApplied: boolean;
  possiblePiiRemaining: boolean;
  redactedEntityCounts: Record<string, number>;
  pipelineVersion: string;
}

export interface ProcessDocumentResponse {
  documentId: string;
  processingStatus: 'ready';
  summary: BackendSummary;
  privacy: BackendPrivacyResult;
}
