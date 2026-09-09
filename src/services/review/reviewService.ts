import { apiClient } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/errors';

/**
 * Checking what the app read against what the clinician actually wrote.
 *
 * ## The three things this keeps apart
 *
 * 1. **The original pages** — fetched as short-lived URLs, never altered.
 * 2. **The model's output** — written once, never edited.
 * 3. **What a person said instead** — appended as a correction, naming who,
 *    when, and which version they were looking at.
 *
 * Collapsing any two loses the ability to answer the question that matters
 * after a mistake: was the model wrong, or was the corrector?
 *
 * ## What "reviewed" is not
 *
 * A person confirming the app read a page correctly is not a clinician
 * validating the content. Nothing here says verified, approved or confirmed
 * correct, and no screen using it may either.
 */

export interface DocumentPageUrl {
  readonly page: number;
  readonly url: string;
  readonly expiresInSeconds: number;
}

export interface CorrectionDraft {
  readonly patientId: string;
  readonly documentId: string;
  /** Dotted path into the summary, e.g. `findings.0.value`. */
  readonly field: string;
  readonly previousValue: string;
  readonly correctedValue: string;
  /**
   * The version the corrector was looking at.
   *
   * Required and checked by the server. Without it a correction typed against
   * version 1 could land on a version 2 the person never saw — the classic lost
   * update, except the thing lost is a statement about somebody's medication.
   */
  readonly summaryVersion: number;
}

export type ReviewOutcome =
  | { readonly outcome: 'recorded' }
  /** The summary changed underneath them; they must look again. */
  | { readonly outcome: 'summary_changed' };

/**
 * A 409 here always means the same thing: the text being corrected or checked
 * is not the text on the server any more. It is an outcome to show, not a
 * failure to retry — retrying would apply a correction to words nobody read.
 */
const isStaleSummary = (error: unknown): boolean =>
  error instanceof ApiError && error.kind === 'conflict';

export const reviewService = {
  /**
   * URLs for the original pages.
   *
   * Minutes, not hours: a signed URL is a bearer token that outlives the
   * request, and reading is a glance rather than a transfer over a bad line.
   */
  async pages(patientId: string, documentId: string): Promise<DocumentPageUrl[]> {
    const { pages } = await apiClient.get<{ pages: DocumentPageUrl[] }>(
      endpoints.review.pages(patientId, documentId),
    );
    return pages;
  },

  /** Appends a correction. The model's output is never edited. */
  async correct(draft: CorrectionDraft): Promise<ReviewOutcome> {
    try {
      await apiClient.post(endpoints.review.corrections(draft.patientId, draft.documentId), {
        field: draft.field,
        previousValue: draft.previousValue,
        correctedValue: draft.correctedValue,
        summaryVersion: draft.summaryVersion,
      });
      return { outcome: 'recorded' };
    } catch (error) {
      if (isStaleSummary(error)) return { outcome: 'summary_changed' };
      throw error;
    }
  },

  /**
   * Records that a person has checked this version against the original.
   *
   * Takes the version, so a later re-run leaves the record visibly unchecked
   * rather than carrying a tick earned on different text.
   */
  async markReviewed(
    patientId: string,
    documentId: string,
    summaryVersion: number,
  ): Promise<ReviewOutcome> {
    try {
      await apiClient.post(endpoints.review.markReviewed(patientId, documentId), {
        summaryVersion,
      });
      return { outcome: 'recorded' };
    } catch (error) {
      if (isStaleSummary(error)) return { outcome: 'summary_changed' };
      throw error;
    }
  },
};
