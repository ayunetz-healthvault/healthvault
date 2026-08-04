import {
  ProcessingError,
  type DocumentProcessingRequest,
  type DocumentProcessor,
  type ProcessDocumentResponse,
  type ProcessingStage,
} from '../../types/processing.js';
import { assertSafeToSend } from '../redaction/leakageCheck.js';
import { RedactionService } from '../redaction/RedactionService.js';
import { pseudonymousDocumentId } from '../summarisation/pseudonym.js';
import { SourceConsistencyValidator } from '../validation/SourceConsistencyValidator.js';

import { normalisePages } from './normaliseText.js';
import { PageExpander, type ReadablePage } from './pageExpander.js';

import type { StructuredSummary } from '../../schemas/summary.js';
import type { OcrPageResult, OcrProvider } from '../ocr/OcrProvider.js';
import type { OcrImageMimeType } from '../upload/FileValidator.js';
import type { SummaryProvider } from '../summarisation/SummaryProvider.js';

/**
 * The pipeline, in one place.
 *
 * ```text
 * validate -> OCR -> normalise -> redact -> privacy gate
 *   -> summarise -> validate schema -> verify sources -> respond
 * ```
 *
 * The order is not negotiable and the class exists to make that visible in one
 * file. Three properties in particular are structural rather than incidental:
 *
 * 1. **The gate sits between redaction and the provider, and it throws.** There
 *    is no branch in which `summaryProvider` is reached without
 *    `assertSafeToSend` having returned first.
 * 2. **The provider only ever sees redacted pages.** The object handed to it is
 *    built from the redaction output, never from the OCR output. The unredacted
 *    text is not in scope at that point in the function.
 * 3. **Nothing is `ready` until it has been validated against the source.** A
 *    structurally invalid summary raises rather than returning.
 *
 * Temporary-file cleanup is *not* here. It belongs to the route, in a `finally`
 * that wraps this whole call — see `routes/processDocument.ts`. Putting it here
 * would leave the files behind whenever this method throws before its own
 * cleanup line, which is exactly when it matters.
 */

export const PROCESSING_PIPELINE_VERSION = 'processing-v1';

/** Ten pages of OCR plus a model round trip, with room to spare. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Mirrors MAX_DOCUMENT_PAGES; the route passes the configured value. */
const DEFAULT_MAX_PAGES = 10;

/**
 * Below this, the text is legible enough to summarise but not to trust.
 *
 * A photographed handwritten prescription read at 57% confidence, well above
 * the "unreadable" floor of 30, so the pipeline accepted it — and the text it
 * accepted said `Tab Amlodipine dy`, `Teds Mozvastatin`, `lop Pontopragole ag`.
 * Real drug names, mangled doses, no warning anywhere. A summary built on that
 * reads as confidently as one built on a clean scan.
 *
 * The model cannot know its input was garbled; it only sees the text. The
 * pipeline knows, so the pipeline says so.
 */
const UNRELIABLE_OCR_CONFIDENCE = 75;

/** What a summary's confidence is capped at when the read was poor. */
const UNRELIABLE_OCR_CONFIDENCE_CAP = 0.4;

export interface ProcessingProgress {
  stage: ProcessingStage;
  /** 0–100, for the app's status screen. */
  progress: number;
}

export interface OrchestratorOptions {
  ocrProvider: OcrProvider;
  summaryProvider: SummaryProvider;
  redactionService?: RedactionService;
  sourceValidator?: SourceConsistencyValidator;
  pageExpander?: PageExpander;
  /** Must match the route's limit; a PDF can exceed it on its own. */
  maxPages?: number;
  timeoutMs?: number;
  onProgress?: (progress: ProcessingProgress) => void;
}

export interface ProcessOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ProcessingProgress) => void;
}

/** Stages in the order they are emitted, with the progress each represents. */
const STAGE_PROGRESS: [ProcessingStage, number][] = [
  ['queued', 0],
  ['validating', 5],
  ['reading_pages', 20],
  ['normalising_text', 45],
  ['redacting_pii', 55],
  ['privacy_check', 65],
  ['extracting_values', 70],
  ['writing_summary', 80],
  ['validating_summary', 95],
  ['done', 100],
];

const PROGRESS_BY_STAGE = new Map(STAGE_PROGRESS);

export class DocumentProcessingOrchestrator implements DocumentProcessor {
  private readonly ocrProvider: OcrProvider;
  private readonly summaryProvider: SummaryProvider;
  private readonly redactionService: RedactionService;
  private readonly sourceValidator: SourceConsistencyValidator;
  private readonly pageExpander: PageExpander;
  private readonly maxPages: number;
  private readonly timeoutMs: number;
  private readonly onProgress: ((progress: ProcessingProgress) => void) | undefined;

  constructor(options: OrchestratorOptions) {
    this.ocrProvider = options.ocrProvider;
    this.summaryProvider = options.summaryProvider;
    this.redactionService = options.redactionService ?? new RedactionService();
    this.sourceValidator = options.sourceValidator ?? new SourceConsistencyValidator();
    this.pageExpander = options.pageExpander ?? new PageExpander();
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onProgress = options.onProgress;
  }

  async process(
    request: DocumentProcessingRequest,
    options: ProcessOptions = {},
  ): Promise<ProcessDocumentResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

    const report = (stage: ProcessingStage): void => {
      const progress: ProcessingProgress = {
        stage,
        progress: PROGRESS_BY_STAGE.get(stage) ?? 0,
      };
      this.onProgress?.(progress);
      options.onProgress?.(progress);
    };

    try {
      return await this.run(request, signal, report);
    } catch (error) {
      report('failed');
      throw this.asProcessingError(error, options.signal);
    }
  }

  private async run(
    request: DocumentProcessingRequest,
    signal: AbortSignal,
    report: (stage: ProcessingStage) => void,
  ): Promise<ProcessDocumentResponse> {
    report('queued');

    report('validating');
    if (request.pages.length === 0) {
      throw new ProcessingError('invalid_file', 'No pages were included in the request.');
    }
    this.throwIfAborted(signal);

    // --- Read -------------------------------------------------------------
    report('reading_pages');

    // A PDF becomes several pages here, some of which carry their own text and
    // never need OCR at all.
    const readable = await this.pageExpander.expand(request.pages, {
      workingDirectory: request.workingDirectory,
      maxPages: this.maxPages,
    });
    this.throwIfAborted(signal);

    const needsOcr = readable.filter(
      (page): page is typeof page & { imagePath: string; mimeType: OcrImageMimeType } =>
        page.imagePath !== null && page.mimeType !== null,
    );

    const ocr =
      needsOcr.length === 0
        ? { pages: [], overallConfidence: null }
        : await this.ocrProvider.extractText(
            needsOcr.map((page) => ({
              page: page.page,
              path: page.imagePath,
              mimeType: page.mimeType,
            })),
          );
    this.throwIfAborted(signal);

    const pageText = this.mergeReadPages(readable, ocr.pages);

    report('normalising_text');
    const normalised = normalisePages(pageText);

    // --- Redact -----------------------------------------------------------
    report('redacting_pii');
    const redaction = this.redactionService.redact(normalised, request.patient);
    this.throwIfAborted(signal);

    // --- The gate ---------------------------------------------------------
    // Everything above this line may contain identifiers. Nothing below it is
    // allowed to unless this call has returned.
    report('privacy_check');
    assertSafeToSend(redaction.pages, request.patient);

    // --- Summarise --------------------------------------------------------
    report('extracting_values');
    report('writing_summary');
    const summary = await this.summaryProvider.createSummary(
      {
        // Built from the redaction output only. The OCR text and the patient
        // profile are both in scope here and neither is passed.
        documentId: pseudonymousDocumentId(request.documentId),
        category: request.category,
        pages: redaction.pages.map((page) => ({ page: page.page, text: page.text })),
      },
      { signal },
    );
    this.throwIfAborted(signal);

    // --- Check it against the document ------------------------------------
    report('validating_summary');
    const validated = this.sourceValidator.validate(summary, {
      pages: redaction.pages,
      patient: request.patient,
    });

    const hedged = this.hedgeForPoorOcr(validated.summary, ocr.overallConfidence);

    report('done');

    return {
      documentId: request.documentId,
      processingStatus: 'ready',
      summary: {
        ...hedged,
        pipelineVersion: PROCESSING_PIPELINE_VERSION,
        generatedBy: `${this.summaryProvider.name}/${PROCESSING_PIPELINE_VERSION}`,
        ocrConfidence: ocr.overallConfidence,
        unreadablePages: this.unreadablePages(readable, ocr.pages),
      },
      privacy: {
        redactionApplied: true,
        // False by construction: an unsafe document threw at the gate above and
        // never reached this line.
        possiblePiiRemaining: false,
        redactedEntityCounts: redaction.counts,
        pipelineVersion: redaction.pipelineVersion,
      },
    };
  }

  /**
   * Puts the two sources of text back into one ordered list.
   *
   * A page either had its text lifted from a PDF or was OCR'd; both end up
   * here, in page order, with the unreadable ones still present so the
   * numbering — and every source reference built from it — stays honest.
   */
  private mergeReadPages(
    readable: ReadablePage[],
    ocrPages: OcrPageResult[],
  ): { page: number; text: string }[] {
    const ocrByPage = new Map(ocrPages.map((page) => [page.page, page]));

    return readable.map((page) => ({
      page: page.page,
      text: page.text ?? ocrByPage.get(page.page)?.text ?? '',
    }));
  }

  /**
   * Marks a summary down when the text under it was badly read.
   *
   * Does not drop anything: a mangled prescription still lists something, and
   * the family has the original. What it does is stop the output presenting
   * itself as reliable — the confidence is capped and an uncertainty is added,
   * both of which the app already renders prominently.
   */
  private hedgeForPoorOcr(
    summary: StructuredSummary,
    ocrConfidence: number | null,
  ): StructuredSummary {
    if (ocrConfidence === null || ocrConfidence >= UNRELIABLE_OCR_CONFIDENCE) {
      return summary;
    }

    return {
      ...summary,
      confidence: Math.min(summary.confidence, UNRELIABLE_OCR_CONFIDENCE_CAP),
      uncertainties: [
        {
          message:
            'This document was hard to read — handwriting, or a photograph that was blurred or poorly lit. Test names, medicine names and doses below may be wrong. Check every one against the original before acting on it.',
          sourcePage: null,
        },
        ...summary.uncertainties,
      ],
    };
  }

  /** Pages that yielded nothing, whichever route they took. */
  private unreadablePages(readable: ReadablePage[], ocrPages: OcrPageResult[]): number[] {
    const ocrByPage = new Map(ocrPages.map((page) => [page.page, page]));

    return readable
      .filter((page) =>
        page.text === null ? (ocrByPage.get(page.page)?.unreadable ?? true) : false,
      )
      .map((page) => page.page);
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new ProcessingError('processing_timeout', 'Processing was cancelled.');
    }
  }

  /**
   * Maps anything unexpected onto the typed taxonomy.
   *
   * An already-typed `ProcessingError` passes through untouched. Everything
   * else becomes `unknown` with a fixed message — an error escaping from an
   * image library or an HTTP client can quote a file path or a fragment of the
   * document, and this is the last point before it reaches the route.
   */
  private asProcessingError(error: unknown, callerSignal?: AbortSignal): ProcessingError {
    if (error instanceof ProcessingError) {
      return error;
    }

    if (callerSignal?.aborted === true) {
      return new ProcessingError('processing_timeout', 'Processing was cancelled.', {
        cause: error,
      });
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      return new ProcessingError('processing_timeout', 'Processing took too long.', {
        retryable: true,
        cause: error,
      });
    }

    return new ProcessingError('unknown', 'The document could not be processed.', { cause: error });
  }
}
