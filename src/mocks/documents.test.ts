import { MOCK_DOCUMENTS, MOCK_SUMMARIES } from './documents';
import { MOCK_PARENTS } from './parents';

import type { DocumentSummary, RedactionCategory, SourceReference } from '@/types/domain';
import { isValidIsoDate } from '@/utils/date';

/**
 * Seed-data integrity.
 *
 * The demo vault is the only summary data that exists until the Phase 1
 * pipeline is built, so it doubles as the reference example of the domain
 * model. These tests hold two lines: the source references must actually
 * resolve to a real page, and the seeds must not quietly become the thing the
 * privacy architecture forbids — an identifier riding along in a snippet.
 */

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
  'facility',
  'other',
];

/** Every source reference in a summary, wherever it hangs off. */
const allSourcesOf = (summary: DocumentSummary): SourceReference[] => [
  ...summary.findings.flatMap((finding) => finding.sources ?? []),
  ...summary.medicines.flatMap((medicine) => medicine.sources ?? []),
  ...(summary.explicitFollowUps ?? []).map((followUp) => followUp.source),
];

describe('seeded documents and summaries', () => {
  it('links every summary to a document and the same parent', () => {
    MOCK_SUMMARIES.forEach((summary) => {
      const document = MOCK_DOCUMENTS.find((candidate) => candidate.id === summary.documentId);
      expect(document).toBeDefined();
      expect(summary.parentId).toBe(document?.parentId);
    });
  });

  it('points every document at its own summary', () => {
    MOCK_DOCUMENTS.forEach((document) => {
      const summary = MOCK_SUMMARIES.find((candidate) => candidate.id === document.summaryId);
      expect(summary?.documentId).toBe(document.id);
    });
  });
});

describe('source traceability', () => {
  it('resolves every source reference to a real page of its own document', () => {
    MOCK_SUMMARIES.forEach((summary) => {
      allSourcesOf(summary).forEach((source) => {
        expect(source.documentId).toBe(summary.documentId);

        const document = MOCK_DOCUMENTS.find((candidate) => candidate.id === source.documentId);
        expect(source.page).toBeGreaterThanOrEqual(1);
        expect(source.page).toBeLessThanOrEqual(document?.pages.length ?? 0);
      });
    });
  });

  it('gives every abnormal finding a page the family can check', () => {
    MOCK_SUMMARIES.flatMap((summary) => summary.findings)
      .filter((finding) => finding.severity !== 'normal' && finding.sources !== undefined)
      .forEach((finding) => {
        expect(finding.sources?.length).toBeGreaterThan(0);
      });
  });

  it('keeps uncertainty page references inside the document', () => {
    MOCK_SUMMARIES.forEach((summary) => {
      const document = MOCK_DOCUMENTS.find((candidate) => candidate.id === summary.documentId);

      (summary.uncertainties ?? []).forEach((uncertainty) => {
        expect(uncertainty.message.length).toBeGreaterThan(0);
        if (uncertainty.sourcePage !== null) {
          expect(uncertainty.sourcePage).toBeGreaterThanOrEqual(1);
          expect(uncertainty.sourcePage).toBeLessThanOrEqual(document?.pages.length ?? 0);
        }
      });
    });
  });
});

describe('explicit follow-ups', () => {
  it('carries a resolvable date or an honest null', () => {
    MOCK_SUMMARIES.flatMap((summary) => summary.explicitFollowUps ?? []).forEach((followUp) => {
      expect(followUp.title.length).toBeGreaterThan(0);
      expect(followUp.confidence).toBeGreaterThan(0);
      expect(followUp.confidence).toBeLessThanOrEqual(1);
      if (followUp.date !== null) {
        expect(isValidIsoDate(followUp.date)).toBe(true);
      }
    });
  });
});

describe('privacy metadata', () => {
  it('records counts for every redaction category without exposing values', () => {
    MOCK_SUMMARIES.map((summary) => summary.privacy)
      .filter((privacy) => privacy !== undefined)
      .forEach((privacy) => {
        expect(privacy.redactionApplied).toBe(true);
        expect(privacy.possiblePiiRemaining).toBe(false);
        expect(privacy.pipelineVersion).toMatch(/^redaction-v\d+$/);

        REDACTION_CATEGORIES.forEach((category) => {
          const count = privacy.redactedEntityCounts[category];
          expect(Number.isInteger(count)).toBe(true);
          expect(count).toBeGreaterThanOrEqual(0);
        });
      });
  });

  it('never lets a patient name or phone number reach a source snippet', () => {
    const snippets = MOCK_SUMMARIES.flatMap((summary) =>
      allSourcesOf(summary)
        .map((source) => source.textSnippet)
        .filter((snippet): snippet is string => snippet !== undefined),
    );

    // There is at least one snippet, otherwise this test passes vacuously.
    expect(snippets.length).toBeGreaterThan(0);

    const forbidden = MOCK_PARENTS.flatMap((parent) => [
      ...parent.fullName.split(' '),
      parent.phone,
      parent.city,
    ]);

    snippets.forEach((snippet) => {
      forbidden.forEach((value) => {
        expect(snippet.toLowerCase()).not.toContain(value.toLowerCase());
      });
    });
  });
});

describe('backwards compatibility', () => {
  it('still accepts a summary written before the pipeline fields existed', () => {
    const withoutNewFields = MOCK_SUMMARIES.filter(
      (summary) =>
        summary.privacy === undefined &&
        summary.explicitFollowUps === undefined &&
        summary.uncertainties === undefined &&
        summary.pipelineVersion === undefined &&
        summary.detectedDocumentDate === undefined,
    );

    // Guards the "all additions are optional" rule in docs/architecture/phase-1.md.
    expect(withoutNewFields.length).toBeGreaterThan(0);
    withoutNewFields.forEach((summary) => {
      expect(summary.findings.every((finding) => finding.sources === undefined)).toBe(true);
    });
  });
});
