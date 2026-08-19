import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { ObjectStore } from '../../services/objects/ObjectStore.js';
import type { JobQueue } from '../../services/queue/JobQueue.js';
import type { RecordRepository } from '../../services/records/RecordRepository.js';
import { callerOf, notFound } from './shared.js';

/**
 * Documents, and the upload protocol.
 *
 * The flow, and why it has three steps rather than one:
 *
 *   POST /v1/documents                       record first, so nothing is
 *                                            uploaded that has nowhere to live
 *   POST /v1/documents/:id/uploads           short-lived presigned PUT per page
 *   PUT  <presigned url>                     phone → object store, directly
 *   POST /v1/documents/:id/uploads/complete  verify, then enqueue
 *
 * Document bytes never pass through this service. That removes a whole class of
 * accident — no scan of a prescription in a request log, a heap dump or a proxy
 * cache — and means the client never holds a credential that can write anywhere
 * but the keys it was given.
 */

export interface DocumentRoutesOptions {
  repository: RecordRepository;
  objects: ObjectStore;
  queue: JobQueue;
}

/** Matches what the pipeline can actually read. */
const CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

const documentDraft = z.object({
  parentId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pageCount: z.number().int().positive().max(10),
});

const documentId = z.object({ documentId: z.string().min(1).max(128) });
const parentIdParam = z.object({ parentId: z.string().min(1).max(128) });

const uploadRequest = z.object({
  pages: z
    .array(z.object({ page: z.number().int().positive().max(10), contentType: z.enum(CONTENT_TYPES) }))
    .min(1)
    .max(10),
});

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

export const documentRoutes: FastifyPluginAsync<DocumentRoutesOptions> = async (
  app,
  { repository, objects, queue },
) => {
  app.post('/v1/documents', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = documentDraft.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalid('Check the document details.'));

    const ownerId = callerOf(request).ownerId;

    // The parent must be the caller's. Without this a client could file a
    // document against an id belonging to somebody else's account — it would
    // land in the caller's own partition, but the record would carry a foreign
    // parent id and the index would be nonsense.
    const parent = await repository.getParent(ownerId, parsed.data.parentId);
    if (parent === null) return reply.code(404).send(notFound('parent'));

    const now = new Date().toISOString();
    const document = {
      documentId: `doc_${crypto.randomUUID()}`,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    };

    await repository.putDocument(ownerId, document);
    await repository.putProcessing(ownerId, {
      documentId: document.documentId,
      status: 'awaiting_upload',
      attempts: 0,
      updatedAt: now,
    });

    return reply.code(201).send({ document });
  });

  app.get('/v1/documents/:documentId', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = documentId.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(invalid('Provide a document id.'));

    const document = await repository.getDocument(
      callerOf(request).ownerId,
      parsed.data.documentId,
    );
    if (document === null) return reply.code(404).send(notFound('document'));

    return reply.send({ document });
  });

  app.get(
    '/v1/parents/:parentId/documents',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = parentIdParam.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide a parent id.'));

      return reply.send({
        documents: await repository.listDocumentsForParent(
          callerOf(request).ownerId,
          parsed.data.parentId,
        ),
      });
    },
  );

  app.post(
    '/v1/documents/:documentId/uploads',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentId.safeParse(request.params);
      const body = uploadRequest.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Provide the pages to upload.'));
      }

      const ownerId = callerOf(request).ownerId;
      const document = await repository.getDocument(ownerId, params.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      if (body.data.pages.length !== document.pageCount) {
        return reply.code(400).send(
          invalid(`This document has ${document.pageCount} page(s).`),
        );
      }

      const uploads = await Promise.all(
        body.data.pages.map(async ({ page, contentType }) => ({
          page,
          ...(await objects.presignUpload(
            // The owner comes from the token, so a signed URL can only ever
            // point inside the caller's own prefix.
            { ownerId, documentId: document.documentId, page },
            contentType,
          )),
        })),
      );

      return reply.send({ uploads });
    },
  );

  app.post(
    '/v1/documents/:documentId/uploads/complete',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentId.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a document id.'));

      const ownerId = callerOf(request).ownerId;
      const document = await repository.getDocument(ownerId, params.data.documentId);
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
          objects.exists(objects.keyFor({ ownerId, documentId: document.documentId, page })),
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
       * A phone on a train retries. Claiming the key before enqueuing means the
       * second attempt is told the job is already running rather than queuing a
       * duplicate — which would summarise the same document twice and, once
       * follow-up extraction lands, create the same reminder twice.
       */
      const claimed = await repository.claimIdempotencyKey(
        ownerId,
        'complete_upload',
        document.documentId,
      );

      if (!claimed) {
        return reply.code(200).send({
          processing: await repository.getProcessing(ownerId, document.documentId),
          alreadyQueued: true,
        });
      }

      const now = new Date().toISOString();
      await repository.putProcessing(ownerId, {
        documentId: document.documentId,
        status: 'queued',
        attempts: 0,
        updatedAt: now,
      });

      await queue.enqueue({
        ownerId,
        documentId: document.documentId,
        pageCount: document.pageCount,
        attemptToken: `${document.documentId}#1`,
      });

      return reply.code(202).send({
        processing: await repository.getProcessing(ownerId, document.documentId),
        alreadyQueued: false,
      });
    },
  );

  app.get(
    '/v1/documents/:documentId/processing',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = documentId.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide a document id.'));

      const processing = await repository.getProcessing(
        callerOf(request).ownerId,
        parsed.data.documentId,
      );
      if (processing === null) return reply.code(404).send(notFound('document'));

      return reply.send({ processing });
    },
  );

  app.get(
    '/v1/documents/:documentId/summary',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = documentId.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide a document id.'));

      const summary = await repository.getSummary(
        callerOf(request).ownerId,
        parsed.data.documentId,
      );
      if (summary === null) return reply.code(404).send(notFound('summary'));

      return reply.send({ summary });
    },
  );

  app.delete(
    '/v1/documents/:documentId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = documentId.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide a document id.'));

      const ownerId = callerOf(request).ownerId;
      const document = await repository.getDocument(ownerId, parsed.data.documentId);
      if (document === null) return reply.code(404).send(notFound('document'));

      // Pages first. A record with no pages is a fixable inconsistency; pages
      // with no record are orphans nothing will ever clean up, because the
      // thing that knew their keys is gone.
      await Promise.all(
        Array.from({ length: document.pageCount }, (_, index) =>
          objects.delete(
            objects.keyFor({ ownerId, documentId: document.documentId, page: index + 1 }),
          ),
        ),
      );

      await repository.deleteDocument(ownerId, document.documentId);
      return reply.code(204).send();
    },
  );
};
