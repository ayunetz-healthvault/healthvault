/**
 * Processing pipeline vocabulary.
 *
 * Mirrors docs/architecture/README.md § "processing states" and phase-1.md
 * § "API contract". The mobile app has its own copy of the equivalent domain
 * types; the written contract, not a shared import, is what keeps them in step.
 * See backend/README.md for why the packages do not share a dependency tree.
 */

/** Fine-grained stage, reported so the app can say what is happening. */
export type ProcessingStage =
  | 'queued'
  | 'validating'
  | 'reading_pages'
  | 'normalising_text'
  | 'redacting_pii'
  | 'privacy_check'
  | 'extracting_values'
  | 'writing_summary'
  | 'validating_summary'
  | 'done'
  | 'failed'
  | 'manual_review_required';

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

/** HTTP status per failure class. Privacy failures are a client-visible 422. */
const STATUS_BY_CODE: Record<ProcessingFailureCode, number> = {
  invalid_file: 400,
  upload_failed: 400,
  ocr_failed: 422,
  privacy_failed: 422,
  ai_failed: 502,
  validation_failed: 502,
  processing_timeout: 504,
  manual_review_required: 422,
  unknown: 500,
};

export interface ProcessingErrorBody {
  code: ProcessingFailureCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * A failure that is safe to send to the client.
 *
 * `message` and `details` are written at the throw site and are the *whole*
 * payload — nothing is added from the underlying cause. That is deliberate: an
 * OCR library's error message can quote the text it was reading, and a file
 * error can quote a path or an original filename. Causes are kept for the
 * stack, never serialised.
 */
export class ProcessingError extends Error {
  readonly code: ProcessingFailureCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ProcessingFailureCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProcessingError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }

  toBody(): ProcessingErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/** Categories the redactor counts. Mirrors ADR-002's typed placeholders. */
export type RedactionCategory =
  | 'patientName'
  | 'personName'
  | 'address'
  | 'phone'
  | 'email'
  | 'dateOfBirth'
  | 'aadhaar'
  | 'pan'
  | 'passport'
  | 'patientId'
  | 'insuranceId'
  | 'other';

export const REDACTION_CATEGORIES: readonly RedactionCategory[] = [
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
] as const;

export type RedactionCounts = Record<RedactionCategory, number>;

export const emptyRedactionCounts = (): RedactionCounts =>
  Object.fromEntries(REDACTION_CATEGORIES.map((category) => [category, 0])) as RedactionCounts;

/** Counts only — never the values that were removed. */
export interface PrivacyProcessingResult {
  redactionApplied: boolean;
  possiblePiiRemaining: boolean;
  redactedEntityCounts: RedactionCounts;
  pipelineVersion: string;
}

/** What the app told us about the patient, used as redaction ground truth. */
export interface PatientRedactionProfile {
  fullName: string;
  aliases: string[];
  dateOfBirth?: string;
  phone?: string;
  city?: string;
  knownPatientIds: string[];
}

/** A page that exists on disk right now and will not in a moment. */
export interface TemporaryPage {
  /** 1-based, matching the order the client sent. */
  page: number;
  /** Random path. Never derived from the uploaded filename. */
  path: string;
  mimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  sizeBytes: number;
}

export interface DocumentProcessingRequest {
  documentId: string;
  parentId: string;
  category: string;
  documentDate?: string;
  patient: PatientRedactionProfile;
  pages: TemporaryPage[];
  /**
   * Scratch space for this request. A PDF's pages are rendered here before
   * being read. Owned and deleted by the route — see routes/processDocument.ts.
   */
  workingDirectory: string;
}

export interface ProcessDocumentResponse {
  documentId: string;
  processingStatus: 'ready';
  summary: unknown;
  privacy: PrivacyProcessingResult;
}

/**
 * The pipeline, from the route's point of view.
 *
 * Injected so the route can be tested for validation and cleanup behaviour
 * without an OCR engine or an AI provider existing. P1-09 supplies the real
 * orchestrator.
 */
export interface DocumentProcessor {
  process(request: DocumentProcessingRequest): Promise<ProcessDocumentResponse>;
}
