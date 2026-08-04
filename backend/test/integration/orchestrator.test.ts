import os from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import { summarySchema } from '../../src/schemas/summary.js';
import { MockOcrProvider } from '../../src/services/ocr/MockOcrProvider.js';
import {
  DocumentProcessingOrchestrator,
  type ProcessingProgress,
} from '../../src/services/processing/DocumentProcessingOrchestrator.js';
import { MockSummaryProvider } from '../../src/services/summarisation/MockSummaryProvider.js';
import { ProcessingError } from '../../src/types/processing.js';
import {
  MUST_NOT_SURVIVE,
  SYNTHETIC_HEADER,
  SYNTHETIC_PATIENT,
  SYNTHETIC_REPORT,
} from '../fixtures/synthetic/report.js';

import type { StructuredSummary } from '../../src/schemas/summary.js';
import type { RedactedDocumentInput } from '../../src/services/summarisation/SummaryProvider.js';
import type { DocumentProcessingRequest, ProcessingStage } from '../../src/types/processing.js';

/**
 * The whole synthetic path — P1-09.
 *
 * The pipeline runs on `MockOcrProvider`, so the tests control exactly what
 * "came off the page". That is the point: these assert the *pipeline*, not
 * Tesseract's reading of a bitmap font. Real OCR is covered in
 * `tesseractOcr.test.ts`.
 */

const request = (pages = 2): DocumentProcessingRequest => ({
  documentId: 'doc_synthetic_1',
  parentId: 'par_synthetic_1',
  category: 'lab_report',
  patient: SYNTHETIC_PATIENT,
  workingDirectory: os.tmpdir(),
  pages: Array.from({ length: pages }, (_, index) => ({
    page: index + 1,
    path: `/nowhere/page-${index + 1}.png`,
    mimeType: 'image/png' as const,
    sizeBytes: 1024,
  })),
});

/** A summary that cites the pages the fixture text actually supports. */
const summaryCiting = (overrides: Partial<StructuredSummary> = {}): StructuredSummary =>
  summarySchema.parse({
    overview: 'A two-page lab report.',
    plainLanguageSummary: 'Blood sugar is above target. Kidney function is normal.',
    findings: [
      {
        label: 'HbA1c',
        value: '8.1 %',
        referenceRange: 'Below 7.0 %',
        severity: 'attention',
        plainLanguage: 'Average blood sugar is above target.',
        sources: [{ page: 2 }],
      },
    ],
    medicines: [],
    instructions: ['Repeat the HbA1c test in three months.'],
    recommendedDoctorCategory: 'endocrinologist',
    questionsForDoctor: ['Does the dose need changing?'],
    confidence: 0.8,
    explicitFollowUps: [],
    uncertainties: [],
    ...overrides,
  });

/** OCR that returns the synthetic report: header on page 1, clinical on page 2. */
const reportOcr = (): MockOcrProvider =>
  new MockOcrProvider({
    pages: {
      1: { text: SYNTHETIC_HEADER },
      2: { text: SYNTHETIC_REPORT.slice(SYNTHETIC_HEADER.length) },
    },
  });

const build = (
  summaryProvider: MockSummaryProvider,
  ocrProvider: MockOcrProvider = reportOcr(),
  timeoutMs?: number,
): DocumentProcessingOrchestrator =>
  new DocumentProcessingOrchestrator({
    ocrProvider,
    summaryProvider,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

describe('the complete synthetic path', () => {
  it('produces a ready document with privacy metadata', async () => {
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }));

    const result = await orchestrator.process(request());

    expect(result.processingStatus).toBe('ready');
    expect(result.documentId).toBe('doc_synthetic_1');
    expect(result.privacy.redactionApplied).toBe(true);
    expect(result.privacy.possiblePiiRemaining).toBe(false);
    expect(result.privacy.pipelineVersion).toBe('redaction-v2');
  });

  it('counts what the redactor removed', async () => {
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }));

    const { privacy } = await orchestrator.process(request());

    expect(privacy.redactedEntityCounts.patientName).toBeGreaterThan(0);
    expect(privacy.redactedEntityCounts.aadhaar).toBe(1);
    expect(privacy.redactedEntityCounts.email).toBe(1);
  });

  it('emits every stage, in order', async () => {
    const stages: ProcessingStage[] = [];
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }));

    await orchestrator.process(request(), {
      onProgress: (progress: ProcessingProgress) => stages.push(progress.stage),
    });

    expect(stages).toEqual([
      'queued',
      'validating',
      'reading_pages',
      'normalising_text',
      'redacting_pii',
      'privacy_check',
      'extracting_values',
      'writing_summary',
      'validating_summary',
      'done',
    ]);
  });

  it('reports progress that only ever increases', async () => {
    const values: number[] = [];
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }));

    await orchestrator.process(request(), {
      onProgress: (progress) => values.push(progress.progress),
    });

    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(100);
  });

  it('records which pages could not be read', async () => {
    const ocr = new MockOcrProvider({
      pages: { 1: { text: SYNTHETIC_REPORT } },
      defaultText: '',
    });
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              sources: [{ page: 1 }],
            },
          ],
        }),
      }),
      ocr,
    );

    const result = await orchestrator.process(request());
    const summary = result.summary as Record<string, unknown>;

    expect(summary.unreadablePages).toEqual([2]);
  });

  it('stamps the pipeline version and which provider produced it', async () => {
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }));

    const result = await orchestrator.process(request());
    const summary = result.summary as Record<string, unknown>;

    expect(summary.pipelineVersion).toBe('processing-v1');
    expect(summary.generatedBy).toBe('mock/processing-v1');
  });
});

describe('what reaches the summary provider', () => {
  it('receives redacted text and nothing else', async () => {
    let seen: RedactedDocumentInput | undefined;
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting(),
        onCall: (input) => {
          seen = input;
        },
      }),
    );

    await orchestrator.process(request());

    const serialised = JSON.stringify(seen);

    for (const value of MUST_NOT_SURVIVE) {
      expect(serialised).not.toContain(value);
    }
    expect(serialised).toContain('[PATIENT_NAME]');
    expect(Object.keys(seen ?? {}).sort()).toEqual(['category', 'documentId', 'pages']);
  });

  it('receives a pseudonymous reference, not the vault document id', async () => {
    let seen: RedactedDocumentInput | undefined;
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting(),
        onCall: (input) => {
          seen = input;
        },
      }),
    );

    await orchestrator.process(request());

    expect(seen?.documentId).not.toBe('doc_synthetic_1');
    expect(seen?.documentId).toMatch(/^doc_[0-9a-f]{16}$/);
  });

  it('never receives the patient profile', async () => {
    let seen: RedactedDocumentInput | undefined;
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting(),
        onCall: (input) => {
          seen = input;
        },
      }),
    );

    await orchestrator.process(request());

    expect(seen).not.toHaveProperty('patient');
    expect(JSON.stringify(seen)).not.toContain(SYNTHETIC_PATIENT.fullName);
  });
});

describe('the privacy gate stops the pipeline', () => {
  /** OCR text with an identifier the redactor is not configured to remove. */
  const leakyOcr = (): MockOcrProvider =>
    new MockOcrProvider({
      pages: { 1: { text: 'DL No TN0120110012345 enclosed\nHbA1c 8.1 %' } },
    });

  it('never calls the summary provider when the gate objects', async () => {
    const onCall = vi.fn();
    const orchestrator = build(
      new MockSummaryProvider({ summary: summaryCiting(), onCall }),
      leakyOcr(),
    );

    await expect(orchestrator.process(request(1))).rejects.toMatchObject({
      code: 'privacy_failed',
    });
    // The assertion this whole architecture exists for.
    expect(onCall).not.toHaveBeenCalled();
  });

  it('reports categories without the suspected text', async () => {
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }), leakyOcr());

    try {
      await orchestrator.process(request(1));
      expect.unreachable('the gate should have refused');
    } catch (error) {
      const body = JSON.stringify((error as ProcessingError).toBody());

      expect(body).toContain('possible_identifier');
      expect(body).not.toContain('TN0120110012345');
      expect((error as ProcessingError).statusCode).toBe(422);
    }
  });

  it('reports a failed stage', async () => {
    const stages: ProcessingStage[] = [];
    const orchestrator = build(new MockSummaryProvider({ summary: summaryCiting() }), leakyOcr());

    await expect(
      orchestrator.process(request(1), { onProgress: (p) => stages.push(p.stage) }),
    ).rejects.toThrow();

    expect(stages).toContain('privacy_check');
    expect(stages.at(-1)).toBe('failed');
    expect(stages).not.toContain('writing_summary');
  });
});

describe('an invalid summary is never returned as ready', () => {
  it('rejects a citation to a page that does not exist', async () => {
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              sources: [{ page: 7 }],
            },
          ],
        }),
      }),
    );

    await expect(orchestrator.process(request())).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('rejects a finding with no source at all', async () => {
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              sources: [],
            },
          ],
        }),
      }),
    );

    await expect(orchestrator.process(request())).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('drops a value that is not on the page it cites, and says so', async () => {
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              sources: [{ page: 2 }],
            },
            {
              // Never appears anywhere in the fixture.
              label: 'Troponin',
              value: '99.7 ng/mL',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Invented by the model.',
              sources: [{ page: 2 }],
            },
          ],
        }),
      }),
    );

    const result = await orchestrator.process(request());
    const summary = result.summary as StructuredSummary;

    expect(summary.findings).toHaveLength(1);
    expect(summary.findings[0]?.label).toBe('HbA1c');
    expect(JSON.stringify(summary)).not.toContain('99.7');
    expect(summary.uncertainties.some((u) => /could not be found/i.test(u.message))).toBe(true);
  });

  it('strips a snippet that would reintroduce an identifier', async () => {
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              // The model has quoted a region the redactor missed.
              sources: [{ page: 2, textSnippet: 'Reported for Lakshmi Iyer, HbA1c 8.1 %' }],
            },
          ],
        }),
      }),
    );

    const result = await orchestrator.process(request());
    const summary = result.summary as StructuredSummary;

    expect(JSON.stringify(summary)).not.toContain('Lakshmi');
    // The page reference survives, which is what the family needs.
    expect(summary.findings[0]?.sources[0]?.page).toBe(2);
    expect(summary.findings[0]?.sources[0]?.textSnippet).toBeUndefined();
  });

  it('keeps a snippet that is genuinely clean', async () => {
    const orchestrator = build(
      new MockSummaryProvider({
        summary: summaryCiting({
          findings: [
            {
              label: 'HbA1c',
              value: '8.1 %',
              referenceRange: null,
              severity: 'attention',
              plainLanguage: 'Above target.',
              sources: [{ page: 2, textSnippet: 'HbA1c 8.1 % Below 7.0 %' }],
            },
          ],
        }),
      }),
    );

    const result = await orchestrator.process(request());
    const summary = result.summary as StructuredSummary;

    expect(summary.findings[0]?.sources[0]?.textSnippet).toBe('HbA1c 8.1 % Below 7.0 %');
  });
});

describe('failure and cancellation', () => {
  it('maps an OCR failure to its typed code', async () => {
    const orchestrator = build(
      new MockSummaryProvider({ summary: summaryCiting() }),
      new MockOcrProvider({ defaultText: '' }),
    );

    await expect(orchestrator.process(request())).rejects.toMatchObject({ code: 'ocr_failed' });
  });

  it('maps a provider failure to its typed code', async () => {
    const orchestrator = build(
      new MockSummaryProvider({
        failWith: new ProcessingError('ai_failed', 'The summary service rejected the request.'),
      }),
    );

    await expect(orchestrator.process(request())).rejects.toMatchObject({ code: 'ai_failed' });
  });

  it('turns an unexpected crash into a safe unknown error', async () => {
    const exploding = {
      name: 'exploding',
      extractText: () => {
        throw new Error('libpng error reading /tmp/scans/lakshmi-iyer-uhid-4471.png');
      },
    };

    const orchestrator = new DocumentProcessingOrchestrator({
      ocrProvider: exploding,
      summaryProvider: new MockSummaryProvider({ summary: summaryCiting() }),
    });

    try {
      await orchestrator.process(request());
      expect.unreachable('should have thrown');
    } catch (error) {
      const processingError = error as ProcessingError;

      expect(processingError.code).toBe('unknown');
      expect(JSON.stringify(processingError.toBody())).not.toContain('lakshmi-iyer');
      expect(processingError.message).toBe('The document could not be processed.');
    }
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const onCall = vi.fn();
    const orchestrator = build(
      new MockSummaryProvider({ summary: summaryCiting(), onCall }),
      new MockOcrProvider({
        pages: { 1: { text: SYNTHETIC_HEADER } },
        defaultText: 'HbA1c 8.1 %',
      }),
    );

    controller.abort();

    await expect(
      orchestrator.process(request(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'processing_timeout' });
    expect(onCall).not.toHaveBeenCalled();
  });

  it('gives up when processing takes too long', async () => {
    const slowOcr = {
      name: 'slow',
      extractText: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          pages: [{ page: 1, text: 'HbA1c 8.1 %', confidence: 90, unreadable: false }],
          overallConfidence: 90,
        };
      },
    };

    const orchestrator = new DocumentProcessingOrchestrator({
      ocrProvider: slowOcr,
      summaryProvider: new MockSummaryProvider({ summary: summaryCiting() }),
      timeoutMs: 10,
    });

    await expect(orchestrator.process(request(1))).rejects.toMatchObject({
      code: 'processing_timeout',
    });
  });

  it('reports a failed stage whatever went wrong', async () => {
    const stages: ProcessingStage[] = [];
    const orchestrator = build(
      new MockSummaryProvider({
        failWith: new ProcessingError('ai_failed', 'nope'),
      }),
    );

    await expect(
      orchestrator.process(request(), { onProgress: (p) => stages.push(p.stage) }),
    ).rejects.toThrow();

    expect(stages.at(-1)).toBe('failed');
    expect(stages).not.toContain('done');
  });
});
