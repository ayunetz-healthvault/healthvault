import {
  AI_SUMMARY_DISCLAIMER,
  PROCESSING_STAGES,
  type ProcessingStage,
  summaryService,
} from './summaryService';

import { MOCK_DOCUMENTS } from '@/mocks/documents';
import type { MedicalDocument } from '@/types/domain';

const freshDocument = (overrides: Partial<MedicalDocument> = {}): MedicalDocument => ({
  id: 'doc_new',
  parentId: 'par_demo_amma',
  title: 'New lab report',
  category: 'lab_report',
  documentDate: '2026-07-30',
  pages: [
    {
      id: 'pag_new_1',
      uri: 'file:///cache/page.jpg',
      kind: 'image',
      source: 'scan',
      fileName: 'page.jpg',
      sizeBytes: 100_000,
      width: 1000,
      height: 1400,
      capturedAt: '2026-07-30T10:00:00.000Z',
    },
  ],
  status: 'uploaded',
  uploadProgress: 100,
  summaryId: null,
  failureReason: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
  ...overrides,
});

describe('summaryForDocument', () => {
  it('returns the hand-written summary for a seeded demo document', () => {
    const seeded = MOCK_DOCUMENTS[0]!;
    const summary = summaryService.summaryForDocument(seeded);

    expect(summary.documentId).toBe(seeded.id);
    expect(summary.findings.length).toBeGreaterThan(0);
    expect(summary.medicines.length).toBeGreaterThan(0);
    expect(summary.questionsForDoctor.length).toBeGreaterThan(0);
  });

  it('generates a hedged, low-confidence summary for an unseen document', () => {
    const summary = summaryService.summaryForDocument(freshDocument());

    expect(summary.documentId).toBe('doc_new');
    expect(summary.confidence).toBeLessThan(0.7);
    // Nothing clinical should be invented for a document nobody has read.
    expect(summary.medicines).toEqual([]);
    expect(summary.plainLanguageSummary).toContain('demonstration');
  });

  it('populates every section the summary screen renders', () => {
    const summary = summaryService.summaryForDocument(MOCK_DOCUMENTS[0]!);

    expect(summary.overview).not.toHaveLength(0);
    expect(summary.plainLanguageSummary).not.toHaveLength(0);
    expect(summary.instructions.length).toBeGreaterThan(0);
    expect(summary.recommendedDoctorCategory).toBeDefined();
    expect(summary.generatedBy).toContain('ayunetz');
  });
});

describe('fetchSummary', () => {
  it('finds a seeded summary by document id', async () => {
    await expect(summaryService.fetchSummary('doc_demo_hba1c')).resolves.toMatchObject({
      id: 'sum_demo_hba1c',
    });
  });

  it('returns null when there is no summary', async () => {
    await expect(summaryService.fetchSummary('doc_unknown')).resolves.toBeNull();
  });
});

describe('processDocument', () => {
  it('walks every pipeline stage in order and ends ready', async () => {
    const stages: ProcessingStage[] = [];

    const summary = await summaryService.processDocument(freshDocument(), (state) =>
      stages.push(state.stage),
    );

    expect(stages).toEqual([
      'queued',
      'reading_pages',
      'extracting_values',
      'writing_summary',
      'done',
    ]);
    expect(stages.at(-1)).toBe('done');
    expect(summary.documentId).toBe('doc_new');
  }, 15_000);

  it('reports 100% progress on the final state', async () => {
    const progress: number[] = [];

    await summaryService.processDocument(freshDocument(), (state) => progress.push(state.progress));

    expect(progress.at(-1)).toBe(100);
  }, 15_000);

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const promise = summaryService.processDocument(freshDocument(), undefined, controller.signal);

    controller.abort();

    await expect(promise).rejects.toThrow('Processing cancelled.');
  }, 15_000);
});

describe('PROCESSING_STAGES', () => {
  it('ends with done so the status screen can compare indices', () => {
    expect(PROCESSING_STAGES.at(-1)).toBe('done');
  });
});

describe('AI_SUMMARY_DISCLAIMER', () => {
  it('states plainly that it is not medical advice', () => {
    expect(AI_SUMMARY_DISCLAIMER).toContain('not medical advice');
    expect(AI_SUMMARY_DISCLAIMER).toContain('qualified doctor');
  });
});
