import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_NOTICE_VERSION } from '../../src/services/consent/policy.js';
import type { ObjectStore } from '../../src/services/objects/ObjectStore.js';
import type { JobQueue, ProcessingJob, ReceivedJob } from '../../src/services/queue/JobQueue.js';
import { createDocumentWorker, type WorkerEvent } from '../../src/services/worker/DocumentWorker.js';
import type { DocumentProcessor } from '../../src/types/processing.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * The worker reading consent from the store, rather than from a stub.
 *
 * `documentWorker.test.ts` covers the gate with an injected `consentFor`; it
 * proves the logic and cannot prove the wiring. This does the opposite, and it
 * exists because the wiring was the part that was missing: `worker.ts` passed
 * `async () => []`, which was fail-closed and therefore invisible — every
 * document was quietly stored and never summarised, and no test could tell
 * that apart from a system where consent worked.
 *
 * So the composition here is deliberately the same one line `worker.ts` uses:
 *
 *     consentFor: (patientId) => patients.listConsent(patientId)
 *
 * Everything below is synthetic. The "report" is a fixed processor result; no
 * real document, no provider, no key.
 */

const PATIENT = 'pat_1';
const DOCUMENT = 'doc_1';
const OWNER = 'acc_alice';
const NOW = '2026-09-08T10:00:00.000Z';

let patients: ReturnType<typeof inMemoryPatientRepository>;
let access: ReturnType<typeof inMemoryAccessRepository>;
let events: WorkerEvent[];

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

/** A synthetic lab report result. Nothing here came from a real document. */
const processor = (): DocumentProcessor => ({
  process: vi.fn(async ({ documentId }) => ({
    documentId,
    processingStatus: 'ready' as const,
    summary: {
      overview: 'Kidney function is stable compared with the previous report.',
      findings: [{ label: 'Creatinine', value: '1.1 mg/dL' }],
    },
    privacy: {
      redactionApplied: true,
      possiblePiiRemaining: false,
      redactedEntityCounts: {} as never,
      pipelineVersion: 'redaction-v1',
    },
  })),
});

const job = (): ProcessingJob => ({
  patientId: PATIENT,
  documentId: DOCUMENT,
  pageCount: 1,
  attemptToken: `${DOCUMENT}#1`,
});

const queueOf = (jobs: ProcessingJob[]): JobQueue => {
  const pending: ReceivedJob[] = jobs.map((entry, index) => ({
    job: entry,
    receipt: `receipt-${index}`,
  }));
  return {
    enqueue: async () => undefined,
    receive: async (max = 1) => pending.splice(0, max),
    acknowledge: async () => undefined,
  };
};

/** Composed exactly as `worker.ts` composes it. */
const buildWorker = (documentProcessor: DocumentProcessor = processor()) =>
  createDocumentWorker({
    queue: queueOf([job()]),
    patients,
    access,
    objects,
    processor: documentProcessor,
    consentFor: (patientId) => patients.listConsent(patientId),
    log: (event) => events.push(event),
  });

const decide = async (granted: boolean, decidedAt: string): Promise<void> => {
  await patients.appendConsent({
    patientId: PATIENT,
    purpose: 'ai_processing',
    granted,
    decidedBy: OWNER,
    decidedAt,
    noticeVersion: CURRENT_NOTICE_VERSION,
    onBehalfOfPatient: false,
  });
};

const queueDocument = async (): Promise<void> => {
  await patients.putProcessing(PATIENT, {
    documentId: DOCUMENT,
    status: 'queued',
    attempts: 0,
    updatedAt: NOW,
  });
};

beforeEach(async () => {
  patients = inMemoryPatientRepository();
  access = inMemoryAccessRepository();
  events = [];

  await patients.putPatient({
    patientId: PATIENT,
    fullName: 'Meera Nair',
    relationship: 'mother',
    createdByAccountId: OWNER,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await patients.putDocument(PATIENT, {
    documentId: DOCUMENT,
    parentId: PATIENT,
    title: 'Kidney panel',
    category: 'lab_report',
    documentDate: '2026-09-01',
    pageCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await queueDocument();
  await access.createSelfGrant(PATIENT, OWNER);
});

describe('a synthetic report with consent recorded', () => {
  it('produces a summary that is actually persisted', async () => {
    await decide(true, '2026-09-08T09:00:00.000Z');

    await buildWorker().handle(job());

    const summary = await patients.getSummary(PATIENT, DOCUMENT);
    expect(summary).toMatchObject({ pipelineVersion: 'redaction-v1' });
    expect((summary?.summary as { overview: string }).overview).toContain('Kidney function');
  });

  it('marks the document ready so the app can offer it', async () => {
    await decide(true, '2026-09-08T09:00:00.000Z');

    await buildWorker().handle(job());

    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({ status: 'ready' });
  });

  /** The caveat is stored with the summary, not recomputed by whoever reads it. */
  it('keeps the redaction result for that run', async () => {
    await decide(true, '2026-09-08T09:00:00.000Z');

    await buildWorker().handle(job());

    expect((await patients.getSummary(PATIENT, DOCUMENT))?.privacy).toMatchObject({
      redactionApplied: true,
      possiblePiiRemaining: false,
    });
  });
});

describe('a record nobody has answered for', () => {
  /**
   * The case the stub made indistinguishable from a working system: no consent
   * row at all. The document is stored — that was never in question — and no
   * text goes to a provider.
   */
  it('writes no summary', async () => {
    await buildWorker().handle(job());

    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });

  it('says why, without calling it a failure', async () => {
    await buildWorker().handle(job());

    expect(await patients.getProcessing(PATIENT, DOCUMENT)).toMatchObject({
      status: 'manual_review',
      failureCode: 'ai_not_permitted',
    });
  });

  it('never calls the processor at all', async () => {
    const documentProcessor = processor();

    await buildWorker(documentProcessor).handle(job());

    expect(documentProcessor.process).not.toHaveBeenCalled();
  });
});

describe('consent withdrawn before the job runs', () => {
  it('does not process, even though it was permitted yesterday', async () => {
    await decide(true, '2026-09-01T00:00:00.000Z');
    await decide(false, '2026-09-07T00:00:00.000Z');

    const documentProcessor = processor();
    await buildWorker(documentProcessor).handle(job());

    expect(documentProcessor.process).not.toHaveBeenCalled();
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });
});

describe('consent withdrawn while the job is running', () => {
  /**
   * The expensive case, and the one worth getting right. The pipeline has
   * already read the pages by the time the withdrawal lands. What must not
   * happen is the summary being written anyway — the worker re-reads consent
   * immediately before persisting for exactly this.
   */
  it('discards the result rather than storing it', async () => {
    await decide(true, '2026-09-01T00:00:00.000Z');

    const withdrawMidRun: DocumentProcessor = {
      process: vi.fn(async ({ documentId }) => {
        await decide(false, '2026-09-08T10:30:00.000Z');
        return {
          documentId,
          processingStatus: 'ready' as const,
          summary: { overview: 'Kidney function is stable.' },
          privacy: {
            redactionApplied: true,
            possiblePiiRemaining: false,
            redactedEntityCounts: {} as never,
            pipelineVersion: 'redaction-v1',
          },
        };
      }),
    };

    await buildWorker(withdrawMidRun).handle(job());

    expect(withdrawMidRun.process).toHaveBeenCalled();
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();
  });
});

describe('re-queuing after the answer changes', () => {
  /**
   * Consent is not a one-way door. Somebody who declines and later agrees gets
   * the summary they then asked for, and the same document processed twice
   * leaves one summary rather than two.
   */
  it('summarises on a later run once consent is given', async () => {
    await buildWorker().handle(job());
    expect(await patients.getSummary(PATIENT, DOCUMENT)).toBeNull();

    await decide(true, '2026-09-08T11:00:00.000Z');
    await queueDocument();
    await buildWorker().handle(job());

    expect(await patients.getSummary(PATIENT, DOCUMENT)).not.toBeNull();
  });

  it('is safe to deliver the same job twice', async () => {
    await decide(true, '2026-09-08T09:00:00.000Z');

    await buildWorker().handle(job());
    const first = await patients.getSummary(PATIENT, DOCUMENT);

    await buildWorker().handle(job());
    const second = await patients.getSummary(PATIENT, DOCUMENT);

    expect(second).toEqual(first);
  });
});
