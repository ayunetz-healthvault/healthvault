import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import type { ObjectStore } from '../../services/objects/ObjectStore.js';
import type { JobQueue } from '../../services/queue/JobQueue.js';
import type { PatientRecordRepository } from '../../services/records/PatientRecordRepository.js';
import { permits } from '../../services/consent/policy.js';
import { beingDeleted, callerOf, notFound } from './shared.js';
import { requireAccess } from './requireAccess.js';

/**
 * Documents, and the upload protocol.
 *
 * The flow, and why it has three steps rather than one:
 *
 *   POST /v1/patients/:id/documents                  record first, so nothing
 *                                                    is uploaded with nowhere
 *                                                    to live
 *   POST .../documents/:documentId/uploads           short-lived presigned PUT
 *                                                    per page
 *   PUT  <presigned url>                             phone → object store
 *   POST .../documents/:documentId/uploads/complete  verify, then enqueue
 *
 * Document bytes never pass through this service. That removes a whole class of
 * accident — no scan of a prescription in a request log, a heap dump or a proxy
 * cache — and means the client never holds a credential that can write anywhere
 * but the keys it was given.
 *
 * ## Every route names the patient
 *
 * The patient id is in the path, not inferred from the document. That is what
 * makes authorisation structural: a handler cannot reach a document without
 * first having named whose record it is, and `requireAccess` has already
 * refused if the caller holds no grant on that record.
 *
 * The previous shape — `/v1/documents/:documentId`, scoped to the caller's own
 * partition — could not survive shared records. With more than one account able
 * to reach a document, "whose is it" stops being answerable from the token
 * alone. See ADR-005.
 */

export interface DocumentRoutesOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
  objects: ObjectStore;
  queue: JobQueue;
}

/** Matches what the pipeline can actually read. */
const CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

const patientParam = z.object({ patientId: z.string().min(1).max(128) });
const documentParam = patientParam.extend({ documentId: z.string().min(1).max(128) });

const documentDraft = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pageCount: z.number().int().positive().max(10),
});

const uploadRequest = z.object({
  pages: z
    .array(
      z.object({ page: z.number().int().positive().max(10), contentType: z.enum(CONTENT_TYPES) }),
    )
    .min(1)
    .max(10),
});

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

/**
 * The status for a record that is being erased.
 *
 * `410 Gone` rather than `409`: this is not two people editing the same thing,
 * and a client that treated it as a conflict would sit waiting for a state to
 * come back that never will. Gone is what it is, and the app maps it to the
 * same "this record is no longer available to you" as a 404.
 */
const RECORD_DELETING = 410;

export const documentRoutes: FastifyPluginAsync<DocumentRoutesOptions> = async (
  app,
  { access, patients, objects, queue },
) => {
  app.post(
    '/v1/patients/:patientId/documents',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      const body = documentDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the document details.'));
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'upload_document',
      );
      if (grant === null) return reply;

      /**
       * Nothing new goes into a record that is being erased.
       *
       * Checked after the grant, because a caller with no access must not learn
       * that a record exists at all — and before anything is written, because
       * the deletion sweep may already have passed this key.
       */
      if ((await patients.getDeletion(params.data.patientId)) !== null) {
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      const now = new Date().toISOString();
      const document = {
        documentId: `doc_${crypto.randomUUID()}`,
        parentId: params.data.patientId,
        ...body.data,
        createdAt: now,
        updatedAt: now,
      };

      await patients.putDocument(params.data.patientId, document);
      await patients.putProcessing(params.data.patientId, {
        documentId: document.documentId,
        status: 'awaiting_upload',
        attempts: 0,
        updatedAt: now,
      });
      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: params.data.patientId,
        actorAccountId: grant.accountId,
        action: 'create',
        entity: 'document',
        entityId: document.documentId,
        at: now,
      });

      return reply.code(201).send({ document });
    },
  );

  app.get(
    '/v1/patients/:patientId/documents',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'read_record',
      );
      if (grant === null) return reply;

      /**
       * Documents with what is actually happening to each.
       *
       * The list used to return the document rows alone, which left a client no
       * way to tell a queued document from a finished one — and the mobile
       * client filled that gap by assuming every pulled document was ready.
       * That made an unfinished or failed report look complete on a second
       * device, which is worse than showing nothing.
       *
       * Three queries for the whole record rather than one per document: a
       * per-document call is an N+1 walk that gets slower exactly as a record
       * gets more useful.
       */
      const [documents, processing, summaryIds] = await Promise.all([
        patients.listDocuments(params.data.patientId),
        patients.listProcessing(params.data.patientId),
        patients.listSummaryIds(params.data.patientId),
      ]);

      const stateFor = new Map(processing.map((record) => [record.documentId, record]));
      const hasSummary = new Set(summaryIds);

      return reply.send({
        documents: documents.map((document) => ({
          ...document,
          /**
           * Absent when the pipeline has never written a state for this
           * document. Deliberately not defaulted to anything: "we do not know"
           * is a real answer, and the client renders it as such rather than
           * guessing.
           */
          processing: stateFor.get(document.documentId) ?? null,
          hasSummary: hasSummary.has(document.documentId),
        })),
      });
    },
  );

  app.get(
    '/v1/patients/:patientId/documents/:documentId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'read_record',
      );
      if (grant === null) return reply;

      const document = await patients.getDocument(params.data.patientId, params.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      return reply.send({ document });
    },
  );

  app.post(
    '/v1/patients/:patientId/documents/:documentId/uploads',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      const body = uploadRequest.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Provide the pages to upload.'));
      }

      /**
       * The grant is checked before a URL is signed, not after.
       *
       * A presigned URL outlives the request that issued it, so signing one for
       * a caller who turns out to have no grant hands them a credential that
       * keeps working after the refusal.
       */
      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'upload_document',
      );
      if (grant === null) return reply;

      const document = await patients.getDocument(params.data.patientId, params.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      if (body.data.pages.length !== document.pageCount) {
        return reply.code(400).send(invalid(`This document has ${document.pageCount} page(s).`));
      }

      const uploads = await Promise.all(
        body.data.pages.map(async ({ page, contentType }) => ({
          page,
          ...(await objects.presignUpload(
            // The patient comes from a path the caller proved access to, so a
            // signed URL can only ever point inside that record's prefix.
            { patientId: params.data.patientId, documentId: document.documentId, page },
            contentType,
          )),
        })),
      );

      return reply.send({ uploads });
    },
  );

  app.post(
    '/v1/patients/:patientId/documents/:documentId/uploads/complete',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'upload_document',
      );
      if (grant === null) return reply;

      const document = await patients.getDocument(params.data.patientId, params.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      /**
       * Every page must actually be there.
       *
       * A client that says "done" after uploading two of three pages would
       * otherwise queue a job that reads an incomplete document and produces a
       * summary missing whatever was on the third page — a silent wrong answer
       * about somebody's medical record, which is worse than a failed upload.
       */
      const pages = Array.from({ length: document.pageCount }, (_, index) => index + 1);
      const present = await Promise.all(
        pages.map((page) =>
          objects.exists(
            objects.keyFor({
              patientId: params.data.patientId,
              documentId: document.documentId,
              page,
            }),
          ),
        ),
      );
      const missing = pages.filter((_, index) => present[index] !== true);

      if (missing.length > 0) {
        return reply.code(409).send({
          code: 'upload_incomplete',
          message: 'Some pages have not finished uploading.',
          retryable: true,
          details: { missingPages: missing },
        });
      }

      /**
       * A late upload, landing during an erasure.
       *
       * The pages were written straight to the object store with a URL signed
       * before the deletion began, so refusing here is what stops the record
       * being rebuilt around them — and the deletion's own object sweep removes
       * the bytes.
       */
      if ((await patients.getDeletion(params.data.patientId)) !== null) {
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      const existing = await patients.getProcessing(
        params.data.patientId,
        document.documentId,
      );

      /**
       * A phone on a train retries.
       *
       * The state itself is the idempotency marker: once processing has left
       * `awaiting_upload`, a second completion is told the job is already in
       * flight rather than queuing a duplicate — which would summarise the same
       * document twice and create the same follow-up twice.
       */
      if (existing !== null && existing.status !== 'awaiting_upload') {
        return reply.code(200).send({ processing: existing, alreadyQueued: true });
      }

      const now = new Date().toISOString();
      await patients.putProcessing(params.data.patientId, {
        documentId: document.documentId,
        status: 'queued',
        attempts: 0,
        updatedAt: now,
      });

      await queue.enqueue({
        patientId: params.data.patientId,
        documentId: document.documentId,
        pageCount: document.pageCount,
        attemptToken: `${document.documentId}#1`,
      });

      return reply.code(202).send({
        processing: await patients.getProcessing(params.data.patientId, document.documentId),
        alreadyQueued: false,
      });
    },
  );

  app.get(
    '/v1/patients/:patientId/documents/:documentId/processing',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'read_record',
      );
      if (grant === null) return reply;

      const processing = await patients.getProcessing(
        params.data.patientId,
        params.data.documentId,
      );
      if (processing === null) return reply.code(404).send(notFound('document'));

      return reply.send({ processing });
    },
  );

  /**
   * Ask again for a document nobody was allowed to read.
   *
   * A document that reached the worker without AI-processing consent — or whose
   * consent was withdrawn while it ran — ends at `manual_review` with
   * `ai_not_permitted`. That is a terminal state on purpose: the worker will not
   * pick it up again, because "no summary yet" and "no summary, by decision"
   * must not look the same on a screen.
   *
   * Consent is not a one-way door, though, and somebody who declines and later
   * agrees would otherwise have to delete and re-upload the report to get the
   * summary they have now asked for. This is the way back, and it is deliberately
   * explicit: a person asks for it, having answered the consent question, rather
   * than a background job noticing the answer changed and quietly sending pages
   * to a provider.
   *
   * `manage_consent`, not `upload_document`. The action being authorised is
   * sending this person's document to a summarisation provider, which is the
   * consent decision itself — a contributor who may add documents does not get
   * to make it.
   */
  app.post(
    '/v1/patients/:patientId/documents/:documentId/processing/resume',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'manage_consent',
      );
      if (grant === null) return reply;

      if ((await patients.getDeletion(params.data.patientId)) !== null) {
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      const document = await patients.getDocument(params.data.patientId, params.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      const processing = await patients.getProcessing(
        params.data.patientId,
        params.data.documentId,
      );

      /**
       * Only the no-consent case resumes here — and the retry of one.
       *
       * A document that failed OCR is not waiting for permission, and re-queuing
       * it would spend another OCR run and another provider call to reach the
       * same conclusion. A document already `ready` has its summary. Both are
       * told what state they are actually in rather than being silently ignored.
       *
       * `queued` is accepted because of what a resume does: it moves the record
       * out of `ai_not_permitted` and then enqueues. A caller that lost the
       * response — or a process that died between those two steps — would
       * otherwise find the state it needs to retry already spent, and a report
       * could sit at `queued` with no job in the queue and no way to ask again.
       * Re-enqueuing is safe: the queue is at-least-once by design, and the
       * worker refuses a document it has already finished.
       */
      const resumable =
        processing !== null &&
        (processing.failureCode === 'ai_not_permitted' || processing.status === 'queued');

      if (!resumable) {
        return reply.code(409).send({
          code: 'not_waiting_on_consent' as const,
          message: 'This document is not waiting on a consent decision.',
          retryable: false,
          details: { status: processing?.status ?? 'none' },
        });
      }

      /**
       * The consent question, asked before the job is queued rather than only
       * by the worker.
       *
       * The worker checks again — it has to, because minutes pass — but a resume
       * that queued a job which the worker was always going to refuse would tell
       * the person their report was being read when nothing of the sort was
       * happening.
       */
      if (!permits(await patients.listConsent(params.data.patientId), 'ai_processing')) {
        return reply.code(409).send({
          code: 'ai_not_permitted' as const,
          message:
            'Summarising this record is not permitted. Agree to AI processing first, then ask again.',
          retryable: false,
        });
      }

      const now = new Date().toISOString();
      await patients.putProcessing(params.data.patientId, {
        documentId: document.documentId,
        status: 'queued',
        // Counted from zero: this is a new decision, not another attempt at a
        // job that kept failing, and the attempt budget exists for the latter.
        attempts: 0,
        updatedAt: now,
      });

      /**
       * If the queue refuses the job, the record goes back as it was.
       *
       * Otherwise the document is left saying `queued` with nothing queued, and
       * the state a resume needs — `ai_not_permitted` — has been spent: the next
       * attempt would be refused as "not waiting on a consent decision", and the
       * report would sit waiting for a job that does not exist. Restoring it
       * makes the failure exactly as retryable as it looks.
       */
      try {
        await queue.enqueue({
          patientId: params.data.patientId,
          documentId: document.documentId,
          pageCount: document.pageCount,
          attemptToken: `${document.documentId}#resume-${now}`,
        });
      } catch {
        await patients.putProcessing(params.data.patientId, processing);
        return reply.code(503).send({
          code: 'queue_unavailable' as const,
          message: 'The document could not be queued just now. Nothing has changed; try again.',
          retryable: true,
        });
      }

      await patients.appendAudit({
        eventId: `${now}-processing-resumed`,
        patientId: params.data.patientId,
        actorAccountId: grant.accountId,
        action: 'processing_resumed',
        entity: 'document',
        entityId: document.documentId,
        at: now,
      });

      return reply.code(202).send({
        processing: await patients.getProcessing(params.data.patientId, document.documentId),
        /** True when this call re-queued a document a previous one had queued. */
        requeued: processing.status === 'queued',
      });
    },
  );

  app.get(
    '/v1/patients/:patientId/documents/:documentId/summary',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'read_record',
      );
      if (grant === null) return reply;

      const summary = await patients.getSummary(params.data.patientId, params.data.documentId);
      if (summary === null) return reply.code(404).send(notFound('summary'));

      return reply.send({ summary });
    },
  );

  app.delete(
    '/v1/patients/:patientId/documents/:documentId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      // Deleting is not contributing: a helper who may add documents may not
      // remove them. See `policy.ts`.
      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'delete_document',
      );
      if (grant === null) return reply;

      const document = await patients.getDocument(params.data.patientId, params.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      // Pages first. A record with no pages is a fixable inconsistency; pages
      // with no record are orphans nothing will ever clean up, because the
      // thing that knew their keys is gone.
      await Promise.all(
        Array.from({ length: document.pageCount }, (_, index) =>
          objects.delete(
            objects.keyFor({
              patientId: params.data.patientId,
              documentId: document.documentId,
              page: index + 1,
            }),
          ),
        ),
      );

      await patients.deleteDocument(params.data.patientId, document.documentId);
      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: params.data.patientId,
        actorAccountId: callerOf(request).ownerId,
        action: 'delete',
        entity: 'document',
        entityId: document.documentId,
        at: new Date().toISOString(),
      });

      return reply.code(204).send();
    },
  );
};
