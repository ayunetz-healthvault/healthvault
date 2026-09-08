import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsentRecord } from '../../src/services/consent/policy.js';
import { createDocumentWorker, type WorkerEvent } from '../../src/services/worker/DocumentWorker.js';
import type { ObjectStore } from '../../src/services/objects/ObjectStore.js';
import type { JobQueue, ProcessingJob, ReceivedJob } from '../../src/services/queue/JobQueue.js';
import { ProcessingError, type DocumentProcessor } from '../../src/types/processing.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * The queue consumer.
 *
 * Everything the pipeline needs already existed; what was missing was anything
 * that took a message off the queue, so a document reached `queued` and stayed
 * there. These tests are mostly about the two things that make running it more
 * than once safe: a duplicate delivery must not produce a second summary, and a
 * grant withdrawn while the job waited must stop the result being written.
 */

const PATIENT = 'pat_1';
const DOCUMENT = 'doc_1';
const OWNER = 'acc_alice';

const job = (patch: Partial<ProcessingJob> = {}): ProcessingJob => ({
  patientId: PATIENT,
  documentId: DOCUMENT,
  pageCount: 1,
  attemptToken: `${DOCUMENT}#1`,
  ...patch,
});

let patients: ReturnType<typeof inMemoryPatientRepository>;
let access: ReturnType<typeof inMemoryAccessRepository>;
let events: WorkerEvent[];
let consent: ConsentRecord[];

/** AI processing agreed to, which is what most of these tests assume. */
const aiPermitted = (): ConsentRecord[] => [
  {
    patientId: PATIENT,
    purpose: 'ai_processing',
    granted: true,
    decidedBy: OWNER,
    decidedAt: '2026-09-01T00:00:00.000Z',
    noticeVersion: '2026-09-08.1',
    onBehalfOfPatient: false,
  },
];

const objects: ObjectStore = {
  keyFor: ({ patientId, documentId, page }) =>
    `patients/${patientId}/documents/${documentId}/pages/${String(page).padStart(3, '0')}`,
  presignUpload: async () => ({ key: 'k', url: 'u', expiresInSeconds: 900, headers: {} }),
  presignDownload: async () => 'https://objects.test.invalid/page',
  put: async () => undefined,
  get: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  exists: async () => true,
  delete: async () => undefined,
};

const succeedingProcessor = (): DocumentProcessor => ({
  process: vi.fn(async ({ documentId }) => ({
    documentId,
    processingStatus: 'ready' as const,
    summary: { overview: 'A blood test report.' },
    privacy: {
      redactionApplied: true,
      possiblePiiRemaining: false,
      redactedEntityCounts: {} as never,
      pipelineVersion: 'redaction-v1',
    },
  })),
});

const failingProcessor = (error: unknown): DocumentProcessor => ({
  process: vi.fn(async () => {
    throw error;
  }),
});

/** A queue that hands out exactly the jobs it is given. */
const queueOf = (jobs: ProcessingJob[]): JobQueue & { acknowledged: string[] } => {
  const pending: ReceivedJob[] = jobs.map((entry, index) => ({
    job: entry,
    receipt: `receipt-${index}`,
  }));
  const acknowledged: string[] = [];

  return {
    acknowledged,
    enqueue: async () => undefined,
    receive: async (max = 1) => pending.splice(0, max),
    acknowledge: async (receipt) => {
      acknowledged.push(receipt);
    },
  };
};

const buildWorker = (
  processor: DocumentProcessor,
  jobs: ProcessingJob[] = [job()],
  maxAttempts = 3,
): ReturnType<typeof createDocumentWorker> & { queue: ReturnType<typeof queueOf> } => {
  const queue = queueOf(jobs);
  const worker = createDocumentWorker({
    queue,
    patients,
    access,
    objects,
    processor,
    consentFor: async () => consent,
    maxAttempts,
    log: (event) => events.push(event),
  });
  return Object.assign(worker, { queue });
};

/** A record, a document awaiting processing, and an owner who can see it. */
const seed = async (): Promise<void> => {
  const now = '2026-09-08T10:00:00.000Z';
  await patients.putPatient({
    patientId: PATIENT,
    fullName: 'Meera Nair',
    relationship: 'mother',
    createdByAccountId: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await patients.putDocument(PATIENT, {
    documentId: DOCUMENT,
    parentId: PATIENT,
    title: 'Blood test report',
    category: 'lab_report',
    documentDate: '2026-09-01',
    pageCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  await patients.putProcessing(PATIENT, {
    documentId: DOCUMENT,
    status: 'queued',
    attempts: 0,
    updatedAt: now,
  });
  await access.createSelfGrant(PATIENT, OWNER);
};

beforeEach(async () => {
  patients = inMemoryPatientRepository();
  access = inMemoryAccessRepository();
  events = [];
  consent = aiPermitted();
  await seed();
});

describe('a job that succeeds', () => {
  it('writes the summary and marks the document ready', async () => {
    await buildWorker(succeedingProcessor()).handle(job());

    expect(await patients.getSummary(PATIENT, DOCUMENT)).toMatchObject({
      pipelineVersion: 'redaction-v1',
    });
    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({ status: 'ready' });
  });

  it('takes the message off the queue', async () => {
    const worker = buildWorker(succeedingProcessor());
    await worker.poll();

    expect(worker.queue.acknowledged).toEqual(['receipt-0']);
  });

  it('reports timing and identifiers, and no document content', async () => {
    await buildWorker(succeedingProcessor()).handle(job());

    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain('blood test');
    expect(serialised).not.toContain('Meera');
    expect(events.some((event) => event.kind === 'succeeded')).toBe(true);
  });
});

describe('a message delivered twice', () => {
  /**
   * SQS delivers at least once — a worker that crashes after processing and
   * before acknowledging *will* see the job again. Re-running would summarise
   * the same document twice.
   */
  it('does not process an already-finished document again', async () => {
    const processor = succeedingProcessor();
    const worker = buildWorker(processor);

    await worker.handle(job());
    const second = await worker.handle(job());

    expect(processor.process).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ result: 'skipped', reason: 'already_done' });
  });

  it('does not overwrite the summary it already wrote', async () => {
    const worker = buildWorker(succeedingProcessor());
    await worker.handle(job());
    const first = await patients.getSummary(PATIENT, DOCUMENT);

    await worker.handle(job());

    expect(await patients.getSummary(PATIENT, DOCUMENT)).toEqual(first);
  });

  it('leaves a document awaiting manual review alone', async () => {
    await patients.putProcessing(PATIENT, {
      documentId: DOCUMENT,
      status: 'manual_review',
      attempts: 1,
      updatedAt: '2026-09-08T10:00:00.000Z',
    });
    const processor = succeedingProcessor();

    await buildWorker(processor).handle(job());

    expect(processor.process).not.toHaveBeenCalled();
  });
});

describe('the record changed while the job waited', () => {
  it('does nothing when the record is gone', async () => {
    await patients.deletePatient(PATIENT);
    const processor = succeedingProcessor();

    const outcome = await buildWorker(processor).handle(job());

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'record_missing' });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('does nothing when the document was deleted', async () => {
    await patients.deleteDocument(PATIENT, DOCUMENT);
    const processor = succeedingProcessor();

    const outcome = await buildWorker(processor).handle(job());

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'document_missing' });
    expect(processor.process).not.toHaveBeenCalled();
  });

  /**
   * Nobody can open the record, so there is nobody the result is for — and the
   * pages should not be sent to a provider on their behalf.
   */
  it('does not start work when every grant has been revoked', async () => {
    await access.revokeGrant(PATIENT, OWNER, OWNER);
    const processor = succeedingProcessor();

    const outcome = await buildWorker(processor).handle(job());

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'no_active_grant' });
    expect(processor.process).not.toHaveBeenCalled();
  });

  /**
   * The check that has to happen twice. A job can sit in the queue for minutes;
   * checking only at the start would write a summary into a record somebody had
   * revoked in between.
   */
  it('does not write a summary when access is withdrawn mid-run', async () => {
    const processor: DocumentProcessor = {
      process: async ({ documentId }) => {
        await access.revokeGrant(PATIENT, OWNER, OWNER);
        return {
          documentId,
          processingStatus: 'ready' as const,
          summary: { overview: 'x' },
          privacy: {
            redactionApplied: true,
            possiblePiiRemaining: false,
            redactedEntityCounts: {} as never,
            pipelineVersion: 'redaction-v1',
          },
        };
      },
    };

    const outcome = await buildWorker(processor).handle(job());

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'no_active_grant' });
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });

  /** Recreating a record somebody deleted is worse than losing the summary. */
  it('does not resurrect a document deleted mid-run', async () => {
    const processor: DocumentProcessor = {
      process: async ({ documentId }) => {
        await patients.deleteDocument(PATIENT, DOCUMENT);
        return {
          documentId,
          processingStatus: 'ready' as const,
          summary: { overview: 'x' },
          privacy: {
            redactionApplied: true,
            possiblePiiRemaining: false,
            redactedEntityCounts: {} as never,
            pipelineVersion: 'redaction-v1',
          },
        };
      },
    };

    await buildWorker(processor).handle(job());

    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });
});

describe('optional AI processing', () => {
  /**
   * The document is stored either way — that is the storage purpose, and it is
   * not in question. What this decides is whether its text may be sent to a
   * summarisation provider, which somebody can decline while keeping the app.
   */
  it('does not send anything to the provider when it was not agreed to', async () => {
    consent = [];
    const processor = succeedingProcessor();

    const outcome = await buildWorker(processor).handle(job());

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'ai_not_permitted' });
    expect(processor.process).not.toHaveBeenCalled();
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });

  /** A record created before consent was asked for must not be processed. */
  it('treats a missing answer as not permitted, never as allowed', async () => {
    consent = [];

    await buildWorker(succeedingProcessor()).handle(job());

    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({
      failureCode: 'ai_not_permitted',
    });
  });

  it('does not call it a failure — nothing went wrong', async () => {
    consent = [];

    await buildWorker(succeedingProcessor()).handle(job());

    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({
      status: 'manual_review',
    });
  });

  it('does not process again after consent is withdrawn', async () => {
    consent = [
      ...aiPermitted(),
      {
        patientId: PATIENT,
        purpose: 'ai_processing' as const,
        granted: false,
        decidedBy: OWNER,
        decidedAt: '2026-09-08T09:00:00.000Z',
        noticeVersion: '2026-09-08.1',
        onBehalfOfPatient: false,
      },
    ];
    const processor = succeedingProcessor();

    await buildWorker(processor).handle(job());

    expect(processor.process).not.toHaveBeenCalled();
  });

  /**
   * Cannot undo the provider call that already happened — that limit is stated
   * rather than hidden — but "stop processing my documents" reasonably means
   * the result does not get persisted and shown.
   */
  it('does not write a summary when consent is withdrawn mid-run', async () => {
    const processor: DocumentProcessor = {
      process: async ({ documentId }) => {
        consent = [];
        return {
          documentId,
          processingStatus: 'ready' as const,
          summary: { overview: 'x' },
          privacy: {
            redactionApplied: true,
            possiblePiiRemaining: false,
            redactedEntityCounts: {} as never,
            pipelineVersion: 'redaction-v1',
          },
        };
      },
    };

    const outcome = await buildWorker(processor).handle(job());

    expect(outcome).toMatchObject({ result: 'skipped', reason: 'ai_not_permitted' });
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });
});

describe('failures', () => {
  it('leaves a retryable failure on the queue for redelivery', async () => {
    const worker = buildWorker(
      failingProcessor(new ProcessingError('ai_failed', 'provider down', { retryable: true })),
    );

    const [outcome] = await worker.poll();

    expect(outcome).toMatchObject({ result: 'failed' });
    expect(worker.queue.acknowledged).toEqual([]);
    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({ status: 'queued' });
  });

  it('gives up after the attempt limit and takes the message off', async () => {
    const error = new ProcessingError('ai_failed', 'provider down', { retryable: true });
    const worker = buildWorker(failingProcessor(error), [job(), job()], 2);

    await worker.poll();
    const [second] = await worker.poll();

    expect(second).toMatchObject({ result: 'dead_lettered' });
    expect(worker.queue.acknowledged).toEqual(['receipt-1']);
    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({ status: 'failed' });
  });

  /**
   * Re-running OCR over the same bytes produces the same nothing, at the cost
   * of another OCR run and possibly a paid provider call.
   */
  it('sends an unreadable page to review rather than retrying it', async () => {
    const worker = buildWorker(
      failingProcessor(new ProcessingError('ocr_failed', 'nothing legible', { retryable: false })),
    );

    const [outcome] = await worker.poll();

    expect(outcome).toMatchObject({ result: 'dead_lettered' });
    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({
      status: 'manual_review',
      failureCode: 'ocr_failed',
    });
  });

  it('records the failure code and never the message', async () => {
    await buildWorker(
      failingProcessor(
        new ProcessingError('privacy_failed', 'leaked "Meera Nair" into the prompt', {
          retryable: false,
        }),
      ),
    ).handle(job());

    const processing = await patients.getProcessing(PATIENT, DOCUMENT);
    expect(processing?.failureCode).toBe('privacy_failed');
    expect(JSON.stringify(processing)).not.toContain('Meera');
    expect(JSON.stringify(events)).not.toContain('Meera');
  });

  it('treats an unexpected error as retryable rather than losing the document', async () => {
    const worker = buildWorker(failingProcessor(new Error('something odd')));

    const [outcome] = await worker.poll();

    expect(outcome).toMatchObject({ result: 'failed' });
    expect(worker.queue.acknowledged).toEqual([]);
  });

  it('counts attempts across deliveries rather than restarting each time', async () => {
    const error = new ProcessingError('ai_failed', 'down', { retryable: true });
    const worker = buildWorker(failingProcessor(error), [job(), job(), job()], 3);

    await worker.poll();
    await worker.poll();

    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({ attempts: 2 });
  });
});

describe('temporary files', () => {
  /**
   * Leaving them behind would accumulate decrypted medical documents on the
   * worker's disk — the exact thing short-lived object URLs exist to avoid.
   */
  it('cleans up its scratch directory even when processing fails', async () => {
    let workingDirectory = '';
    const processor: DocumentProcessor = {
      process: async (request) => {
        workingDirectory = request.workingDirectory;
        throw new ProcessingError('ai_failed', 'down', { retryable: false });
      },
    };

    await buildWorker(processor).handle(job());

    const { existsSync } = await import('node:fs');
    expect(workingDirectory).not.toBe('');
    expect(existsSync(workingDirectory)).toBe(false);
  });

  it('cleans up after a success too', async () => {
    let workingDirectory = '';
    const processor: DocumentProcessor = {
      process: async (request) => {
        workingDirectory = request.workingDirectory;
        return {
          documentId: request.documentId,
          processingStatus: 'ready' as const,
          summary: {},
          privacy: {
            redactionApplied: true,
            possiblePiiRemaining: false,
            redactedEntityCounts: {} as never,
            pipelineVersion: 'redaction-v1',
          },
        };
      },
    };

    await buildWorker(processor).handle(job());

    const { existsSync } = await import('node:fs');
    expect(existsSync(workingDirectory)).toBe(false);
  });
});
