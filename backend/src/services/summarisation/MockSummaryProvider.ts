import { summarySchema, type StructuredSummary } from '../../schemas/summary.js';
import { ProcessingError } from '../../types/processing.js';

import { assertOnlyRedactedInput } from './SummaryProvider.js';

import type {
  CreateSummaryOptions,
  RedactedDocumentInput,
  SummaryProvider,
} from './SummaryProvider.js';

/**
 * The summary provider used when no model is configured.
 *
 * It is conservative on purpose. It describes what was received and prompts the
 * family to check with a doctor; it never invents a test result, a medicine or
 * a date. A mock that produced plausible-looking clinical values would be worse
 * than useless — it would be indistinguishable from a real summary in a demo,
 * and someone would eventually act on it.
 *
 * This mirrors `buildGeneratedSummary` in the app's `summaryService.ts`, which
 * made the same call for the same reason.
 */

const DOCTOR_BY_CATEGORY: Record<string, StructuredSummary['recommendedDoctorCategory']> = {
  lab_report: 'general_physician',
  prescription: 'general_physician',
  discharge_summary: 'general_physician',
  imaging: 'orthopaedic',
  consultation_note: 'general_physician',
  insurance: 'general_physician',
  other: 'general_physician',
};

export interface MockSummaryProviderOptions {
  /** Return this instead of the generated stand-in. For pipeline tests. */
  summary?: StructuredSummary;
  /** Fail instead, to exercise error paths. */
  failWith?: ProcessingError;
  /** Record what the pipeline handed over, for assertions. */
  onCall?: (input: RedactedDocumentInput) => void;
}

export class MockSummaryProvider implements SummaryProvider {
  readonly name = 'mock';

  private readonly options: MockSummaryProviderOptions;

  constructor(options: MockSummaryProviderOptions = {}) {
    this.options = options;
  }

  // `async` so every failure is a rejection. A Promise-returning method that
  // sometimes throws synchronously is a trap for callers, and the real provider
  // rejects — the two must behave identically or the mock stops being useful.
  async createSummary(
    input: RedactedDocumentInput,
    options: CreateSummaryOptions = {},
  ): Promise<StructuredSummary> {
    // The mock enforces the same input contract as the real provider, so a
    // pipeline bug that would leak on Sarvam also fails in mock mode.
    assertOnlyRedactedInput(input);
    this.options.onCall?.(input);

    if (this.options.failWith !== undefined) {
      throw this.options.failWith;
    }

    if (options.signal?.aborted === true) {
      throw new ProcessingError('processing_timeout', 'Processing was cancelled.');
    }

    if (this.options.summary !== undefined) {
      return this.options.summary;
    }

    const pageCount = input.pages.length;
    const pageWord = pageCount === 1 ? 'page' : 'pages';

    return summarySchema.parse({
      overview: `A ${pageCount}-${pageWord} ${input.category.replace(/_/g, ' ')}.`,
      plainLanguageSummary:
        'No summary model is configured, so this document has not been read. The pages were received and processed through the privacy pipeline, but nothing here describes their contents. Read the original document and speak to a doctor.',
      findings: [],
      medicines: [],
      instructions: [],
      recommendedDoctorCategory: DOCTOR_BY_CATEGORY[input.category] ?? 'general_physician',
      questionsForDoctor: [
        'Could you walk me through what this document means?',
        'Does anything here change the current medicines?',
        'When should we repeat this test or review?',
      ],
      // Low, and honestly so: nothing was read.
      confidence: 0.1,
      explicitFollowUps: [],
      uncertainties: [
        {
          message: 'No summary model was configured, so the document text was not interpreted.',
          sourcePage: null,
        },
      ],
    });
  }
}
