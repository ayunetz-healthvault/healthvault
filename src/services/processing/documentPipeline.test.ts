import { processDocumentOnBackend } from './devProcessingClient';
import { runDocumentPipeline, toAppStage } from './documentPipeline';
import { DocumentProcessingError, type ProcessDocumentResponse } from './types';

import { isBackendEnabled } from '@/config/env';
import { MOCK_DOCUMENTS } from '@/mocks/documents';
import { MOCK_PARENTS } from '@/mocks/parents';
import type { MedicalDocument, ParentProfile } from '@/types/domain';

jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  isBackendEnabled: jest.fn(() => false),
}));

jest.mock('./devProcessingClient', () => ({
  processDocumentOnBackend: jest.fn(),
}));

const backendEnabled = isBackendEnabled as jest.MockedFunction<typeof isBackendEnabled>;
const processOnBackend = processDocumentOnBackend as jest.MockedFunction<
  typeof processDocumentOnBackend
>;

/**
 * A single-page document.
 *
 * The mock path deliberately sleeps to imitate a real transfer, and that time
 * scales with page count — one page keeps these tests inside a sane timeout
 * while exercising exactly the same code.
 */
const document: MedicalDocument = {
  ...(MOCK_DOCUMENTS[0] as MedicalDocument),
  pages: [(MOCK_DOCUMENTS[0] as MedicalDocument).pages[0]!],
};

/** The mock upload and pipeline sleep; give them room. */
const MOCK_PATH_TIMEOUT_MS = 20_000;
const parent = MOCK_PARENTS[0] as ParentProfile;

const backendResponse: ProcessDocumentResponse = {
  documentId: 'doc_hashed',
  processingStatus: 'ready',
  summary: {
    overview: 'A two-page lab report.',
    plainLanguageSummary: 'Blood sugar is above target.',
    findings: [],
    medicines: [],
    instructions: [],
    recommendedDoctorCategory: 'endocrinologist',
    questionsForDoctor: [],
    confidence: 0.8,
    explicitFollowUps: [],
    uncertainties: [],
    pipelineVersion: 'processing-v1',
    generatedBy: 'mock/processing-v1',
    ocrConfidence: 70,
    unreadablePages: [],
  },
  privacy: {
    redactionApplied: true,
    possiblePiiRemaining: false,
    redactedEntityCounts: {},
    pipelineVersion: 'redaction-v1',
  },
};

describe('toAppStage', () => {
  it('collapses the backend stages onto the four the screen shows', () => {
    expect(toAppStage('validating')).toBe('queued');
    expect(toAppStage('normalising_text')).toBe('reading_pages');
    expect(toAppStage('redacting_pii')).toBe('extracting_values');
    expect(toAppStage('privacy_check')).toBe('extracting_values');
    expect(toAppStage('validating_summary')).toBe('writing_summary');
    expect(toAppStage('done')).toBe('done');
  });

  it('treats an unrecognised stage as a failure rather than guessing', () => {
    expect(toAppStage('teleporting')).toBe('failed');
  });
});

describe('runDocumentPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    backendEnabled.mockReturnValue(false);
  });

  describe('mock mode', () => {
    it(
      'is the default and produces a summary without any network call',
      async () => {
        const result = await runDocumentPipeline({ document, parent, userId: 'usr_local' });

        expect(result.fromBackend).toBe(false);
        expect(result.summary.documentId).toBe(document.id);
        expect(processOnBackend).not.toHaveBeenCalled();
      },
      MOCK_PATH_TIMEOUT_MS,
    );

    it(
      'reports upload progress and processing stages',
      async () => {
        const percents: number[] = [];
        const stages: string[] = [];

        await runDocumentPipeline({
          document,
          parent,
          userId: 'usr_local',
          onUploadProgress: (percent) => percents.push(percent),
          onStage: (stage) => stages.push(stage),
        });

        expect(percents.at(-1)).toBe(100);
        expect(stages).toContain('reading_pages');
        expect(stages.at(-1)).toBe('done');
      },
      MOCK_PATH_TIMEOUT_MS,
    );

    it(
      'works without a parent, because the mock path needs no redaction input',
      async () => {
        const result = await runDocumentPipeline({
          document,
          parent: undefined,
          userId: 'usr_local',
        });

        expect(result.summary).toBeDefined();
      },
      MOCK_PATH_TIMEOUT_MS,
    );
  });

  describe('backend mode', () => {
    beforeEach(() => {
      backendEnabled.mockReturnValue(true);
      processOnBackend.mockResolvedValue(backendResponse);
    });

    it('sends the document and parent to the backend and maps the reply', async () => {
      const result = await runDocumentPipeline({ document, parent, userId: 'usr_local' });

      expect(processOnBackend).toHaveBeenCalledTimes(1);
      expect(processOnBackend.mock.calls[0]?.[0]).toMatchObject({
        document,
        parent,
      });
      expect(result.fromBackend).toBe(true);
      expect(result.summary.documentId).toBe(document.id);
      expect(result.summary.privacy?.pipelineVersion).toBe('redaction-v1');
    });

    it('refuses to process a document with no parent profile', async () => {
      // Without a name there is no redaction ground truth, which is the
      // strongest layer the backend has.
      await expect(
        runDocumentPipeline({ document, parent: undefined, userId: 'usr_local' }),
      ).rejects.toMatchObject({ code: 'invalid_file' });

      expect(processOnBackend).not.toHaveBeenCalled();
    });

    it('reports the same stage sequence as the mock path', async () => {
      const stages: string[] = [];

      await runDocumentPipeline({
        document,
        parent,
        userId: 'usr_local',
        onStage: (stage) => stages.push(stage),
      });

      expect(stages).toEqual([
        'queued',
        'reading_pages',
        'extracting_values',
        'writing_summary',
        'done',
      ]);
    });

    it('lets a privacy stop through to the caller with its code intact', async () => {
      processOnBackend.mockRejectedValue(
        new DocumentProcessingError(
          'privacy_failed',
          'The document could not be processed safely.',
        ),
      );

      await expect(
        runDocumentPipeline({ document, parent, userId: 'usr_local' }),
      ).rejects.toMatchObject({ code: 'privacy_failed' });
    });
  });
});
