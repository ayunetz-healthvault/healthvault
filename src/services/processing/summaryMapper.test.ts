import { REDACTION_CATEGORIES, toDocumentSummary } from './summaryMapper';
import { DocumentProcessingError, type ProcessDocumentResponse } from './types';

import { MOCK_DOCUMENTS } from '@/mocks/documents';
import type { MedicalDocument } from '@/types/domain';

const document = MOCK_DOCUMENTS[0] as MedicalDocument;

const response = (overrides: Partial<ProcessDocumentResponse['summary']> = {}) =>
  ({
    documentId: 'doc_9f2a1b3c4d5e6f70',
    processingStatus: 'ready',
    summary: {
      overview: 'A two-page lab report.',
      plainLanguageSummary: 'Blood sugar is above the target range.',
      findings: [
        {
          label: 'HbA1c',
          value: '8.1 %',
          unit: '%',
          referenceRange: 'Below 7.0 %',
          severity: 'attention',
          plainLanguage: 'Above target.',
          sources: [{ page: 1, textSnippet: 'HbA1c 8.1 %' }],
        },
      ],
      medicines: [
        {
          name: 'Metformin',
          dosage: '1000 mg',
          frequency: 'Twice a day',
          purpose: 'Controls blood sugar',
          duration: 'Continuing',
          sources: [{ page: 2 }],
        },
      ],
      instructions: ['Repeat the HbA1c test in three months.'],
      recommendedDoctorCategory: 'endocrinologist',
      questionsForDoctor: ['Does the dose need changing?'],
      confidence: 0.82,
      detectedDocumentDate: '2026-07-12',
      explicitFollowUps: [
        {
          title: 'Repeat HbA1c',
          date: '2026-10-12',
          kind: 'lab_test',
          source: { page: 2 },
          confidence: 0.9,
        },
      ],
      uncertainties: [{ message: 'The thyroid panel was cut off.', sourcePage: 2 }],
      pipelineVersion: 'processing-v1',
      generatedBy: 'mock/processing-v1',
      ocrConfidence: 71,
      unreadablePages: [],
      ...overrides,
    },
    privacy: {
      redactionApplied: true,
      possiblePiiRemaining: false,
      redactedEntityCounts: { patientName: 2, aadhaar: 1 },
      pipelineVersion: 'redaction-v1',
    },
  }) as ProcessDocumentResponse;

describe('toDocumentSummary', () => {
  it('links the summary to the local document, not the pseudonymous reference', () => {
    const summary = toDocumentSummary(response(), document);

    // The backend was given a hash; the vault stores the real ids.
    expect(summary.documentId).toBe(document.id);
    expect(summary.parentId).toBe(document.parentId);
    expect(summary.id).not.toBe('doc_9f2a1b3c4d5e6f70');
    expect(summary.id.startsWith('sum_')).toBe(true);
  });

  it('mints ids for findings and medicines, which the backend does not send', () => {
    const summary = toDocumentSummary(response(), document);

    expect(summary.findings[0]?.id.startsWith('fnd_')).toBe(true);
    expect(summary.medicines[0]?.id.startsWith('med_')).toBe(true);
  });

  it('carries page sources across, scoped to this document', () => {
    const summary = toDocumentSummary(response(), document);

    expect(summary.findings[0]?.sources).toEqual([
      { documentId: document.id, page: 1, textSnippet: 'HbA1c 8.1 %' },
    ]);
    expect(summary.medicines[0]?.sources).toEqual([{ documentId: document.id, page: 2 }]);
    expect(summary.explicitFollowUps?.[0]?.source.documentId).toBe(document.id);
  });

  it('keeps units, durations and the detected document date', () => {
    const summary = toDocumentSummary(response(), document);

    expect(summary.findings[0]?.unit).toBe('%');
    expect(summary.medicines[0]?.duration).toBe('Continuing');
    expect(summary.detectedDocumentDate).toBe('2026-07-12');
  });

  it('turns unreadable pages into uncertainties the UI already renders', () => {
    const summary = toDocumentSummary(response({ unreadablePages: [2, 3] }), document);

    expect(summary.uncertainties).toHaveLength(3);
    expect(summary.uncertainties?.[0]?.message).toContain('Page 2 could not be read');
    expect(summary.uncertainties?.[0]?.sourcePage).toBe(2);
    // The model's own uncertainties survive alongside them.
    expect(summary.uncertainties?.[2]?.message).toContain('thyroid panel');
  });

  it('carries privacy counts over for every category, defaulting to zero', () => {
    const summary = toDocumentSummary(response(), document);

    expect(summary.privacy?.redactedEntityCounts.patientName).toBe(2);
    expect(summary.privacy?.redactedEntityCounts.aadhaar).toBe(1);
    expect(summary.privacy?.redactedEntityCounts.passport).toBe(0);
    expect(summary.privacy?.possiblePiiRemaining).toBe(false);
    expect(summary.privacy?.pipelineVersion).toBe('redaction-v1');
  });

  it('records which pipeline produced it', () => {
    const summary = toDocumentSummary(response(), document);

    expect(summary.pipelineVersion).toBe('processing-v1');
    expect(summary.generatedBy).toBe('mock/processing-v1');
    expect(summary.generatedAt.length).toBeGreaterThan(0);
  });

  describe('defensive parsing', () => {
    it('rejects a reply with no summary', () => {
      const broken = { ...response(), summary: undefined } as unknown as ProcessDocumentResponse;

      expect(() => toDocumentSummary(broken, document)).toThrow(DocumentProcessingError);
    });

    it('rejects a reply missing the plain-language summary', () => {
      expect(() => toDocumentSummary(response({ plainLanguageSummary: '' }), document)).toThrow(
        /plain-language/,
      );
    });

    it('rejects findings that are not a list', () => {
      const broken = response({ findings: 'lots' as never });

      expect(() => toDocumentSummary(broken, document)).toThrow(DocumentProcessingError);
    });

    it('falls back rather than crashing on a doctor category it cannot render', () => {
      const summary = toDocumentSummary(
        response({ recommendedDoctorCategory: 'witch_doctor' as never }),
        document,
      );

      expect(summary.recommendedDoctorCategory).toBe('general_physician');
    });

    it('falls back on a follow-up kind it does not know', () => {
      const summary = toDocumentSummary(
        response({
          explicitFollowUps: [
            {
              title: 'Something',
              date: null,
              kind: 'seance' as never,
              source: { page: 1 },
              confidence: 0.5,
            },
          ],
        }),
        document,
      );

      expect(summary.explicitFollowUps?.[0]?.kind).toBe('other');
    });

    it('clamps a confidence outside 0–1 instead of displaying nonsense', () => {
      expect(toDocumentSummary(response({ confidence: 7 }), document).confidence).toBe(1);
      expect(toDocumentSummary(response({ confidence: -2 }), document).confidence).toBe(0);
    });

    it('drops a source citing a page number that makes no sense', () => {
      const summary = toDocumentSummary(
        response({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              sources: [{ page: 0 }, { page: -1 }, { page: 2 }],
            },
          ],
        }),
        document,
      );

      expect(summary.findings[0]?.sources).toEqual([{ documentId: document.id, page: 2 }]);
    });
  });
});

/**
 * A reply captured verbatim from a real run of the Phase 1 backend
 * (`npm run backend:dev`, mock summary provider, one synthetic page).
 *
 * It is here so the two packages cannot drift apart silently. They share no
 * code by design — see backend/README.md — so the only thing keeping the app's
 * mapper honest is a real payload it has to keep accepting.
 */
const CAPTURED_BACKEND_REPLY = {
  documentId: 'doc_demo_hba1c',
  processingStatus: 'ready',
  summary: {
    overview: 'A 1-page lab report.',
    plainLanguageSummary:
      'No summary model is configured, so this document has not been read. The pages were received and processed through the privacy pipeline, but nothing here describes their contents. Read the original document and speak to a doctor.',
    findings: [],
    medicines: [],
    instructions: [],
    recommendedDoctorCategory: 'general_physician',
    questionsForDoctor: [
      'Could you walk me through what this document means?',
      'Does anything here change the current medicines?',
      'When should we repeat this test or review?',
    ],
    confidence: 0.1,
    explicitFollowUps: [],
    uncertainties: [
      {
        message: 'No summary model was configured, so the document text was not interpreted.',
        sourcePage: null,
      },
    ],
    pipelineVersion: 'processing-v1',
    generatedBy: 'mock/processing-v1',
    ocrConfidence: 64,
    unreadablePages: [],
  },
  privacy: {
    redactionApplied: true,
    possiblePiiRemaining: false,
    redactedEntityCounts: {
      patientName: 0,
      personName: 0,
      address: 0,
      phone: 0,
      email: 0,
      dateOfBirth: 0,
      aadhaar: 0,
      pan: 0,
      passport: 0,
      patientId: 0,
      insuranceId: 0,
      other: 0,
    },
    pipelineVersion: 'redaction-v1',
  },
} as unknown as ProcessDocumentResponse;

describe('the real backend contract', () => {
  it('accepts a reply captured from a live backend run', () => {
    const summary = toDocumentSummary(CAPTURED_BACKEND_REPLY, document);

    expect(summary.documentId).toBe(document.id);
    expect(summary.overview.length).toBeGreaterThan(0);
    expect(summary.pipelineVersion).toBe('processing-v1');
    expect(summary.privacy?.redactionApplied).toBe(true);
    expect(summary.privacy?.possiblePiiRemaining).toBe(false);
    // Every category present, even the ones that counted zero. Asserted
    // against the union rather than a literal, so adding a category is a
    // one-line change here instead of a puzzle.
    expect(Object.keys(summary.privacy?.redactedEntityCounts ?? {}).sort()).toEqual(
      [...REDACTION_CATEGORIES].sort(),
    );
  });

  it('produces a summary the app can render without optional chaining tricks', () => {
    const summary = toDocumentSummary(CAPTURED_BACKEND_REPLY, document);

    expect(Array.isArray(summary.findings)).toBe(true);
    expect(Array.isArray(summary.medicines)).toBe(true);
    expect(Array.isArray(summary.instructions)).toBe(true);
    expect(Array.isArray(summary.questionsForDoctor)).toBe(true);
    expect(typeof summary.confidence).toBe('number');
  });
});
