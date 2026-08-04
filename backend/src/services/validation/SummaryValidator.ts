import { summarySchema, type StructuredSummary } from '../../schemas/summary.js';
import { ProcessingError } from '../../types/processing.js';

/**
 * Schema validation for a summary that did not come through a provider's own
 * parser — the mock path, and anything a future provider hands over raw.
 *
 * Kept separate from `SourceConsistencyValidator` because the two answer
 * different questions. This one asks "is this the right shape?". That one asks
 * "is any of this actually in the document?".
 */
export const validateSummaryShape = (candidate: unknown): StructuredSummary => {
  const result = summarySchema.safeParse(candidate);

  if (!result.success) {
    throw new ProcessingError('validation_failed', 'The summary did not match the schema.', {
      retryable: false,
      // Paths only. Zod's messages quote the offending value, and here that
      // value is the model's rendering of somebody's medical record.
      details: {
        fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
          .sort()
          .slice(0, 20),
      },
    });
  }

  return result.data;
};
