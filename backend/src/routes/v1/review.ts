import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import type { ObjectStore } from '../../services/objects/ObjectStore.js';
import type { PatientRecordRepository } from '../../services/records/PatientRecordRepository.js';
import type { SummaryCorrection } from '../../services/records/RecordRepository.js';
import { requireAccess } from './requireAccess.js';
import { notFound } from './shared.js';

/**
 * Checking a summary against the original, and correcting it.
 *
 * ## The three things this keeps apart
 *
 * 1. **What the clinician wrote** — the original pages, unchanged, always
 *    reachable. Nothing here can alter them.
 * 2. **What the model read** — `summary`, written once by the pipeline and
 *    never edited afterwards.
 * 3. **What a person said instead** — `corrections`, append-only, each naming
 *    who, when, and which version they were looking at.
 *
 * Collapsing any two of these loses the ability to answer the question that
 * matters after a mistake: was the model wrong, or was the corrector?
 *
 * ## What review is not
 *
 * A person confirming the app read a page correctly is **not** a clinician
 * validating the content. No response here says "verified", "approved" or
 * "confirmed correct", and the field is `reviewedBy` rather than anything that
 * could be read as sign-off.
 */

export interface ReviewRoutesOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
  objects: ObjectStore;
  /** How long a page-viewing URL lasts. Short, because it is a bearer token. */
  pageUrlTtlSeconds?: number;
}

const DEFAULT_PAGE_URL_TTL_SECONDS = 300;

const documentParam = z.object({
  patientId: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
});

const correctionDraft = z.object({
  field: z.string().min(1).max(200),
  previousValue: z.string().max(2000),
  correctedValue: z.string().max(2000),
  /**
   * The version the corrector was looking at.
   *
   * Required, and checked. Without it a correction typed against version 1
   * could land on a version 2 the user never saw — the classic lost update,
   * except the thing being lost is a statement about somebody's medication.
   */
  summaryVersion: z.number().int().nonnegative(),
});

const reviewDraft = z.object({ summaryVersion: z.number().int().nonnegative() });

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

/** Version 1 for a summary written before versions existed. */
const versionOf = (version: number | undefined): number => version ?? 1;

export const reviewRoutes: FastifyPluginAsync<ReviewRoutesOptions> = async (
  app,
  { access, patients, objects, pageUrlTtlSeconds = DEFAULT_PAGE_URL_TTL_SECONDS },
) => {
  /**
   * Short-lived URLs for the original pages.
   *
   * The whole point of review is comparing the summary with what the clinician
   * actually wrote, so the original has to be reachable — but a signed URL is a
   * bearer token that outlives the request, so it is minutes rather than the
   * fifteen an upload gets. Reading is a glance; uploading is a transfer over a
   * bad connection.
   */
  app.get(
    '/v1/patients/:patientId/documents/:documentId/pages',
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

      const pages = await Promise.all(
        Array.from({ length: document.pageCount }, async (_, index) => {
          const page = index + 1;
          return {
            page,
            url: await objects.presignDownload(
              { patientId: params.data.patientId, documentId: document.documentId, page },
              pageUrlTtlSeconds,
            ),
            expiresInSeconds: pageUrlTtlSeconds,
          };
        }),
      );

      return reply.send({ pages });
    },
  );

  /**
   * Records a correction.
   *
   * Appends. The model's output is never edited, and neither is an earlier
   * correction — changing your mind produces another entry, because an audit
   * trail that can be rewritten answers nothing.
   */
  app.post(
    '/v1/patients/:patientId/documents/:documentId/corrections',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      const body = correctionDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the correction.'));
      }

      // Correcting a record is writing to it. A read-only helper may not.
      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'write_record',
      );
      if (grant === null) return reply;

      const summary = await patients.getSummary(params.data.patientId, params.data.documentId);
      if (summary === null) return reply.code(404).send(notFound('summary'));

      /**
       * The version check.
       *
       * A correction typed against version 1 must not land on a version 2 the
       * corrector never saw — the pipeline may have re-read the page and
       * produced entirely different text.
       */
      if (body.data.summaryVersion !== versionOf(summary.version)) {
        return reply.code(409).send({
          code: 'summary_changed',
          message: 'This summary has been updated since you opened it. Check it again.',
          retryable: false,
          details: { currentVersion: versionOf(summary.version) },
        });
      }

      const correction: SummaryCorrection = {
        correctionId: crypto.randomUUID(),
        field: body.data.field,
        previousValue: body.data.previousValue,
        correctedValue: body.data.correctedValue,
        correctedBy: grant.accountId,
        correctedAt: new Date().toISOString(),
        summaryVersion: body.data.summaryVersion,
      };

      await patients.putSummary(params.data.patientId, {
        ...summary,
        corrections: [...(summary.corrections ?? []), correction],
      });

      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: params.data.patientId,
        actorAccountId: grant.accountId,
        action: 'correct',
        entity: 'summary',
        // The field name, never the value. A corrected value is clinical text.
        entityId: body.data.field,
        at: correction.correctedAt,
      });

      return reply.code(201).send({ correction });
    },
  );

  /**
   * Marks that a person has checked this summary against the original.
   *
   * Takes the version being reviewed, so a later re-run leaves the record
   * visibly unreviewed rather than carrying a tick earned on different text.
   */
  app.post(
    '/v1/patients/:patientId/documents/:documentId/review',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = documentParam.safeParse(request.params);
      const body = reviewDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Say which version you checked.'));
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'write_record',
      );
      if (grant === null) return reply;

      const summary = await patients.getSummary(params.data.patientId, params.data.documentId);
      if (summary === null) return reply.code(404).send(notFound('summary'));

      if (body.data.summaryVersion !== versionOf(summary.version)) {
        return reply.code(409).send({
          code: 'summary_changed',
          message: 'This summary has been updated since you opened it. Check it again.',
          retryable: false,
          details: { currentVersion: versionOf(summary.version) },
        });
      }

      const reviewedAt = new Date().toISOString();
      await patients.putSummary(params.data.patientId, {
        ...summary,
        reviewedAt,
        reviewedBy: grant.accountId,
        reviewedVersion: body.data.summaryVersion,
      });

      const document = await patients.getDocument(params.data.patientId, params.data.documentId);
      if (document !== null) {
        await patients.putDocument(params.data.patientId, {
          ...document,
          updatedAt: reviewedAt,
        });
      }

      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: params.data.patientId,
        actorAccountId: grant.accountId,
        action: 'review',
        entity: 'summary',
        entityId: params.data.documentId,
        at: reviewedAt,
      });

      /**
       * Deliberately not "verified" or "approved".
       *
       * A person confirming the app read a page correctly has not validated the
       * medicine on it, and a field name is the kind of thing that ends up in a
       * UI label unchanged.
       */
      return reply.send({
        reviewedAt,
        reviewedBy: grant.accountId,
        reviewedVersion: body.data.summaryVersion,
      });
    },
  );
};
