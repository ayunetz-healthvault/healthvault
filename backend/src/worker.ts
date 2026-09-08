import { loadConfig, describeConfig } from './config/env.js';
import { loadStackConfig } from './config/stack.js';
import { createAccessRepository } from './services/access/AccessRepository.js';
import { createObjectStore } from './services/objects/ObjectStore.js';
import { TesseractOcrProvider } from './services/ocr/TesseractOcrProvider.js';
import { DocumentProcessingOrchestrator } from './services/processing/DocumentProcessingOrchestrator.js';
import { createJobQueue } from './services/queue/JobQueue.js';
import { createPatientRecordRepository } from './services/records/PatientRecordRepository.js';
import { createSummaryProvider } from './services/summarisation/providerFactory.js';
import { createDocumentWorker, type WorkerEvent } from './services/worker/DocumentWorker.js';

/**
 * The processing worker, as a process.
 *
 * A separate entry point from `server.ts` because they scale differently and
 * fail differently: the API answers a phone in milliseconds, this runs OCR and
 * an LLM call for tens of seconds. Sharing a process would let a backlog of
 * documents make sign-in slow.
 *
 *   npm run worker
 *
 * It uses the same ports as the API — same queue, same object store, same
 * repositories — so the local stack runs the real thing rather than a
 * simulation of it. See ADR-003.
 */

/**
 * Structured, and content-free.
 *
 * Identifiers, codes, counts and durations only. This is the record of what a
 * background process did to somebody's medical document, so ADR-001's logging
 * rule applies with more force here than to a request log, not less.
 */
const report = (event: WorkerEvent): void => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
};

const start = async (): Promise<void> => {
  const config = loadConfig();
  const stack = loadStackConfig();

  const worker = createDocumentWorker({
    queue: createJobQueue(stack),
    patients: createPatientRecordRepository(stack),
    access: createAccessRepository(stack),
    objects: createObjectStore(stack),
    /**
     * Where consent comes from.
     *
     * Wired explicitly rather than defaulted, because a default that returned
     * "allowed" would silently send every record to a provider. Until the
     * consent store lands this returns nothing, and nothing means not
     * permitted — so a worker run against a stack without consent records
     * stores documents and produces no summaries, which is the safe direction
     * to be wrong in.
     */
    consentFor: async () => [],
    processor: new DocumentProcessingOrchestrator({
      ocrProvider: new TesseractOcrProvider(),
      // Mock unless a key is explicitly configured — see providerFactory.
      summaryProvider: createSummaryProvider(config),
      maxPages: config.MAX_DOCUMENT_PAGES,
    }),
    log: report,
  });

  /**
   * Stop taking new work, and let the job in flight finish.
   *
   * Killing mid-document would leave the record in `processing` with nothing
   * running. The queue would redeliver it eventually — the worker is built for
   * that — but finishing cleanly is better than relying on it.
   */
  const shutdown = (signal: string): void => {
    process.stdout.write(
      `${JSON.stringify({ at: new Date().toISOString(), signal, stopping: true })}\n`,
    );
    worker.stop();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.stdout.write(
    `${JSON.stringify({ started: 'ayunetz-document-worker', ...describeConfig(config) })}\n`,
  );

  await worker.run();
};

start().catch((error: unknown) => {
  // The message only. A stack can name paths, and a config error must not echo
  // the offending value.
  const message = error instanceof Error ? error.message : 'unknown worker startup error';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
