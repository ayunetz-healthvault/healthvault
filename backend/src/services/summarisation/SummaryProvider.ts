import { ProcessingError } from '../../types/processing.js';

import type { StructuredSummary } from '../../schemas/summary.js';

/**
 * The external-summary boundary.
 *
 * ## The allowlist is the type
 *
 * `RedactedDocumentInput` is the *only* thing a provider is given, and it
 * contains exactly what docs/architecture/README.md § "data permitted in an
 * external AI request" permits: redacted text, a pseudonymous document id, a
 * category, page boundaries and a language hint.
 *
 * Nothing else is reachable from here — no patient profile, no Cognito subject,
 * no S3 key, no original file, no caregiver identity. That is deliberate. A
 * provider implementation cannot leak what it was never handed, so the
 * narrowness of this type is doing real work, not documentation.
 */

export interface RedactedDocumentPage {
  /** 1-based. */
  page: number;
  /** Redacted text only. Never the original OCR output. */
  text: string;
}

export interface RedactedDocumentInput {
  /**
   * A pseudonymous reference for this request.
   *
   * Not the vault's document id: that value is stored against a real user, and
   * a provider's request logs are outside our control. See
   * `pseudonymousDocumentId`.
   */
  documentId: string;
  category: string;
  languageHint?: string;
  pages: RedactedDocumentPage[];
}

export interface CreateSummaryOptions {
  signal?: AbortSignal;
}

export interface SummaryProvider {
  readonly name: string;
  createSummary(
    input: RedactedDocumentInput,
    options?: CreateSummaryOptions,
  ): Promise<StructuredSummary>;
}

/**
 * A last-line assertion that nothing but redacted pages is about to go out.
 *
 * The type system already prevents this, so in normal operation it never
 * fires. It exists because "the type says so" stops being true the moment
 * someone widens the interface, and this is the one boundary where that
 * mistake is expensive.
 */
export const assertOnlyRedactedInput = (input: RedactedDocumentInput): void => {
  const allowed = new Set(['documentId', 'category', 'languageHint', 'pages']);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));

  if (unexpected.length > 0) {
    throw new ProcessingError(
      'ai_failed',
      'The request to the summary provider was rejected before it was sent.',
      // Field names only — never their values.
      { details: { unexpectedFields: unexpected.sort() } },
    );
  }

  for (const page of input.pages) {
    const unexpectedPageKeys = Object.keys(page).filter((key) => key !== 'page' && key !== 'text');

    if (unexpectedPageKeys.length > 0) {
      throw new ProcessingError(
        'ai_failed',
        'The request to the summary provider was rejected before it was sent.',
        { details: { unexpectedFields: unexpectedPageKeys.sort() } },
      );
    }
  }
};
