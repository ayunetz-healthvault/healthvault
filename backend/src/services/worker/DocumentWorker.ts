import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AccessRepository } from '../access/AccessRepository.js';
import type { ObjectStore } from '../objects/ObjectStore.js';
import type { JobQueue, ProcessingJob } from '../queue/JobQueue.js';
import { permits, type ConsentRecord } from '../consent/policy.js';
import type { PatientRecordRepository } from '../records/PatientRecordRepository.js';
import { ProcessingError, type DocumentProcessor, type TemporaryPage } from '../../types/processing.js';

/**
 * The queue consumer.
 *
 * Everything it needs already existed — the queue adapter, the orchestrator,
 * OCR, redaction, the leakage gate, validation. What was missing was anything
 * that took a message off the queue, so a document reached `queued` and stayed
 * there forever. This is that, and the parts that make it safe to run more than
 * once.
 *
 * ## Why a message may arrive twice
 *
 * SQS delivers at least once. That is its contract, not a defect: a worker that
 * crashes after processing and before acknowledging *will* see the job again.
 * So the check is not "have I been given this before" — it is "is this document
 * already done", asked of the record, which is the only thing that survives a
 * crash.
 *
 * ## Why the grant is checked twice
 *
 * Once before the work starts, and again before the summary is written. A job
 * can sit in the queue for minutes; access can be withdrawn, or the record
 * deleted, in between. Checking only at the start would write a summary of
 * somebody's blood test into a record they had just revoked — and the LLM call
 * would already have happened.
 *
 * The second check cannot undo the provider call. That is a real limitation and
 * it is disclosed rather than hidden: what it prevents is the result being
 * *persisted* and visible.
 */

export interface DocumentWorkerOptions {
  queue: JobQueue;
  patients: PatientRecordRepository;
  access: AccessRepository;
  objects: ObjectStore;
  processor: DocumentProcessor;
  /**
   * The consent records for a patient.
   *
   * Injected rather than read from a repository so the worker cannot be built
   * without somebody deciding where consent comes from. A default that returned
   * "allowed" would be the single worst line in this file.
   */
  consentFor: (patientId: string) => Promise<ConsentRecord[]>;
  /**
   * Attempts before a job is dead-lettered.
   *
   * Bounded because a poisoned message — a page the pipeline can never read —
   * would otherwise be redelivered forever, and each attempt costs an OCR run
   * and possibly a paid provider call.
   */
  maxAttempts?: number;
  /** Content-free progress reporting. Never the document's text. */
  log?: (event: WorkerEvent) => void;
}

/**
 * What the worker reports.
 *
 * Identifiers, codes, counts and durations. No page text, no summary content,
 * no filenames — ADR-001's rule, which matters more here than in a request log
 * because this is the record of what a background process did to somebody's
 * medical document.
 */
export type WorkerEvent =
  | { readonly kind: 'started'; readonly documentId: string; readonly attempt: number }
  | { readonly kind: 'succeeded'; readonly documentId: string; readonly durationMs: number }
  | {
      readonly kind: 'failed';
      readonly documentId: string;
      readonly code: string;
      readonly retryable: boolean;
      readonly attempt: number;
    }
  | { readonly kind: 'dead_lettered'; readonly documentId: string; readonly code: string }
  | { readonly kind: 'skipped'; readonly documentId: string; readonly reason: SkipReason };

export type SkipReason =
  /** Already processed. A duplicate delivery, which is normal. */
  | 'already_done'
  /** The record is gone. Nothing to write a summary into. */
  | 'record_missing'
  /** The document was deleted while the job waited. */
  | 'document_missing'
  /** Nobody holds an active grant, so there is nobody this result is for. */
  | 'no_active_grant'
  /** Optional AI processing is not permitted for this record. */
  | 'ai_not_permitted';

export interface JobOutcome {
  readonly job: ProcessingJob;
  readonly result: 'succeeded' | 'failed' | 'dead_lettered' | 'skipped';
  readonly reason?: SkipReason | string;
}

const DEFAULT_MAX_ATTEMPTS = 3;

const mimeForPage = (key: string): TemporaryPage['mimeType'] =>
  key.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

export interface DocumentWorker {
  /** Handles one job. Exposed so tests can drive a single delivery. */
  handle(job: ProcessingJob): Promise<JobOutcome>;
  /** Receives and handles a batch. Returns what it did. */
  poll(max?: number): Promise<JobOutcome[]>;
  /** Polls until stopped. */
  run(): Promise<void>;
  stop(): void;
}

export const createDocumentWorker = ({
  queue,
  patients,
  access,
  objects,
  processor,
  consentFor,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  log = () => undefined,
}: DocumentWorkerOptions): DocumentWorker => {
  let running = false;

  /**
   * True when at least one account can still reach this record.
   *
   * Not "the uploader can" — they may have been revoked, and the document is
   * still the patient's. What matters is whether the result has anyone it is
   * for. A record nobody can open is one where processing should stop rather
   * than send its pages to a provider.
   */
  const someoneCanStillSee = async (patientId: string): Promise<boolean> =>
    (await access.listGrantsForPatient(patientId)).some((grant) => grant.status === 'active');

  const handle = async (job: ProcessingJob): Promise<JobOutcome> => {
    const startedAt = Date.now();
    const { patientId, documentId } = job;

    const processing = await patients.getProcessing(patientId, documentId);

    /**
     * Already finished. A duplicate delivery, and the correct response is to
     * acknowledge it and do nothing — re-running would summarise the same
     * document twice and, once follow-up extraction lands, propose the same
     * reminder twice.
     */
    if (processing !== null && (processing.status === 'ready' || processing.status === 'manual_review')) {
      log({ kind: 'skipped', documentId, reason: 'already_done' });
      return { job, result: 'skipped', reason: 'already_done' };
    }

    const attempt = (processing?.attempts ?? 0) + 1;

    const patient = await patients.getPatient(patientId);
    if (patient === null) {
      log({ kind: 'skipped', documentId, reason: 'record_missing' });
      return { job, result: 'skipped', reason: 'record_missing' };
    }

    const document = await patients.getDocument(patientId, documentId);
    if (document === null) {
      log({ kind: 'skipped', documentId, reason: 'document_missing' });
      return { job, result: 'skipped', reason: 'document_missing' };
    }

    if (!(await someoneCanStillSee(patientId))) {
      log({ kind: 'skipped', documentId, reason: 'no_active_grant' });
      return { job, result: 'skipped', reason: 'no_active_grant' };
    }

    /**
     * Optional AI processing, checked before the work starts.
     *
     * The document is already stored — that is the `storage` purpose, and it is
     * not in question here. What this decides is whether its text may be sent
     * to a summarisation provider, which is a separate agreement somebody can
     * decline while keeping the app.
     *
     * Absent consent is *not* permission. A record created before consent was
     * asked for must not be processed on the strength of a missing row.
     */
    if (!permits(await consentFor(patientId), 'ai_processing')) {
      log({ kind: 'skipped', documentId, reason: 'ai_not_permitted' });
      await patients.putProcessing(patientId, {
        documentId,
        // Not a failure. Nothing went wrong, and the document is stored exactly
        // as the user asked; there is simply no summary, and the screen says so.
        status: 'manual_review',
        attempts: attempt,
        failureCode: 'ai_not_permitted',
        updatedAt: new Date().toISOString(),
      });
      return { job, result: 'skipped', reason: 'ai_not_permitted' };
    }

    log({ kind: 'started', documentId, attempt });
    await patients.putProcessing(patientId, {
      documentId,
      status: 'processing',
      attempts: attempt,
      updatedAt: new Date().toISOString(),
    });

    /**
     * Scratch space, deleted in `finally` whatever happens.
     *
     * The pages are written here to be read by OCR and a PDF renderer, both of
     * which want a path. Leaving them behind would accumulate decrypted medical
     * documents on the worker's disk — the exact thing the object store's
     * short-lived URLs exist to avoid.
     */
    const workingDirectory = await mkdtemp(join(tmpdir(), 'ayunetz-job-'));

    try {
      const pages: TemporaryPage[] = [];

      for (let page = 1; page <= job.pageCount; page += 1) {
        const key = objects.keyFor({ patientId, documentId, page });
        const bytes = await objects.get(key);
        const path = join(workingDirectory, `page-${String(page).padStart(3, '0')}`);
        await writeFile(path, bytes);
        pages.push({
          page,
          path,
          mimeType: mimeForPage(key),
          sizeBytes: bytes.byteLength,
        });
      }

      const response = await processor.process({
        documentId,
        parentId: patientId,
        category: document.category,
        ...(document.documentDate === undefined ? {} : { documentDate: document.documentDate }),
        patient: {
          fullName: patient.fullName,
          aliases: [],
          ...(patient.dateOfBirth === undefined ? {} : { dateOfBirth: patient.dateOfBirth }),
          ...(patient.city === undefined ? {} : { city: patient.city }),
          knownPatientIds: [patientId],
        },
        pages,
        workingDirectory,
      });

      /**
       * The second check, immediately before the write.
       *
       * The job may have been queued for minutes. If the record was deleted or
       * every grant revoked while the pipeline ran, the summary has nowhere
       * legitimate to go, and writing it would recreate a record somebody
       * deleted.
       */
      if ((await patients.getDocument(patientId, documentId)) === null) {
        log({ kind: 'skipped', documentId, reason: 'document_missing' });
        return { job, result: 'skipped', reason: 'document_missing' };
      }
      if (!(await someoneCanStillSee(patientId))) {
        log({ kind: 'skipped', documentId, reason: 'no_active_grant' });
        return { job, result: 'skipped', reason: 'no_active_grant' };
      }

      /**
       * Consent, checked again before the result is written.
       *
       * Somebody can withdraw AI processing while a job is running. This cannot
       * undo the provider call that already happened — that limit is stated in
       * `describeWithdrawal` rather than hidden — but it stops the result being
       * persisted and shown, which is what "stop processing my documents"
       * reasonably means to the person who asked.
       */
      if (!permits(await consentFor(patientId), 'ai_processing')) {
        log({ kind: 'skipped', documentId, reason: 'ai_not_permitted' });
        return { job, result: 'skipped', reason: 'ai_not_permitted' };
      }

      await patients.putSummary(patientId, {
        documentId,
        summary: response.summary,
        pipelineVersion: response.privacy.pipelineVersion,
        createdAt: new Date().toISOString(),
      });

      /**
       * `ready` means a summary exists, not that it is right.
       *
       * A person still has to check it against the original — that is KOO-08,
       * and `reviewedAt` on the document is where that lands. Nothing here
       * calls the output verified.
       */
      await patients.putProcessing(patientId, {
        documentId,
        status: 'ready',
        attempts: attempt,
        updatedAt: new Date().toISOString(),
      });

      log({ kind: 'succeeded', documentId, durationMs: Date.now() - startedAt });
      return { job, result: 'succeeded' };
    } catch (error) {
      const failure =
        error instanceof ProcessingError
          ? error
          : new ProcessingError('unknown', 'Processing failed.', { retryable: true });

      log({
        kind: 'failed',
        documentId,
        code: failure.code,
        retryable: failure.retryable,
        attempt,
      });

      /**
       * A page that cannot be read is not a transient failure.
       *
       * `manual_review` rather than `failed`: the document is still there, the
       * user can open the original, and re-running OCR on the same bytes will
       * produce the same nothing. Retrying it would spend an OCR run and a
       * provider call to reach the same conclusion.
       */
      const terminal = !failure.retryable || attempt >= maxAttempts;
      const status =
        failure.code === 'ocr_failed' || failure.code === 'manual_review_required'
          ? 'manual_review'
          : 'failed';

      await patients.putProcessing(patientId, {
        documentId,
        status: terminal ? status : 'queued',
        attempts: attempt,
        // The code, never the message: a pipeline error can quote the text it
        // was reading. ADR-001.
        failureCode: failure.code,
        updatedAt: new Date().toISOString(),
      });

      if (terminal) {
        log({ kind: 'dead_lettered', documentId, code: failure.code });
        return { job, result: 'dead_lettered', reason: failure.code };
      }

      return { job, result: 'failed', reason: failure.code };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  };

  return {
    handle,

    async poll(max = 1) {
      const received = await queue.receive(max);
      const outcomes: JobOutcome[] = [];

      for (const { job, receipt } of received) {
        const outcome = await handle(job);
        outcomes.push(outcome);

        /**
         * Acknowledge everything except a failure that is worth retrying.
         *
         * Leaving a retryable failure un-acknowledged lets the queue's own
         * visibility timeout redeliver it, which is what the queue is for.
         * Acknowledging a dead-lettered job stops the redelivery loop; the
         * record carries the failure, so nothing is lost by taking it off.
         */
        if (outcome.result !== 'failed') await queue.acknowledge(receipt);
      }

      return outcomes;
    },

    async run() {
      running = true;
      while (running) {
        await this.poll(1);
      }
    },

    stop() {
      running = false;
    },
  };
};
