import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import {
  RecordDeletedError,
  type PatientRecordRepository,
} from '../../services/records/PatientRecordRepository.js';
import type { ObjectStore } from '../../services/objects/ObjectStore.js';
import { requireAccess } from './requireAccess.js';
import { callerOf, notFound } from './shared.js';

/**
 * Getting your data out, and getting it deleted.
 *
 * ## Why these are per record, not per account
 *
 * A record is shared. "Export my data" from an account that helps with three
 * parents is three different people's medical histories, and each of them has
 * its own answer about who may read it. So every record in an export is
 * included only because *this* account holds a `read_record` grant on it, and
 * the export says which role it was included under — an export that quietly
 * flattened a viewer's access into an owner's would be a disclosure dressed as
 * a feature.
 *
 * Deletion is stricter still. Only `self` may delete a record, because a
 * manager runs a record and does not own the person it describes, and the
 * caregiver who created a profile does not get to erase somebody's medical
 * history.
 *
 * ## What an export is not
 *
 * It is not a live feed and it is not a backup. It is what the record held at
 * the moment it was asked for, with short-lived URLs for the original pages —
 * which expire, and the response says so rather than letting somebody discover
 * it a week later.
 */

export interface PrivacyRightsOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
  objects: ObjectStore;
  /** How long a page URL in an export lasts. Minutes, like every other one. */
  pageUrlTtlSeconds?: number;
  /**
   * How long an upload URL stays valid, from the stack config.
   *
   * Reported by a deletion rather than assumed by it: it is exactly the window
   * in which bytes can still arrive for a record that has just been erased,
   * because a presigned URL outlives the request that issued it and nothing
   * here can revoke one.
   */
  uploadUrlTtlSeconds?: number;
}

const DEFAULT_PAGE_URL_TTL_SECONDS = 900;

const patientParam = z.object({ patientId: z.string().min(1).max(128) });

const deleteConfirmation = z.object({
  /**
   * The record's own name, typed by the person deleting it.
   *
   * Not a checkbox. This is the one irreversible action in the app, and a
   * mis-tap on a confirm button is the likeliest way somebody loses a parent's
   * entire medical history.
   */
  confirmName: z.string().min(1).max(200),
});

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

export const privacyRightsRoutes: FastifyPluginAsync<PrivacyRightsOptions> = async (
  app,
  {
    access,
    patients,
    objects,
    pageUrlTtlSeconds = DEFAULT_PAGE_URL_TTL_SECONDS,
    uploadUrlTtlSeconds = DEFAULT_PAGE_URL_TTL_SECONDS,
  },
) => {
  /**
   * Everything one record holds, as it stands right now.
   *
   * Readable by anyone with `read_record`, including a viewer: a person who
   * can read a record on a screen can read it in a file, and pretending
   * otherwise would be security theatre rather than a control.
   */
  const exportRecord = async (patientId: string) => {
    const [patient, documents, processing, followUps, consent, audit] = await Promise.all([
      patients.getPatient(patientId),
      patients.listDocuments(patientId),
      patients.listProcessing(patientId),
      patients.listFollowUps(patientId),
      patients.listConsent(patientId),
      patients.listAudit(patientId, 500),
    ]);

    const summaries = await Promise.all(
      documents.map((document) => patients.getSummary(patientId, document.documentId)),
    );

    const pages = await Promise.all(
      documents.flatMap((document) =>
        Array.from({ length: document.pageCount }, async (_, index) => ({
          documentId: document.documentId,
          page: index + 1,
          url: await objects.presignDownload(
            { patientId, documentId: document.documentId, page: index + 1 },
            pageUrlTtlSeconds,
          ),
        })),
      ),
    );

    return {
      patient,
      documents,
      processing,
      /**
       * Summaries carry their corrections, because a correction is part of the
       * record: an export with the model's output and none of what people said
       * about it would be a misleading account of what this record contains.
       */
      summaries: summaries.filter((summary) => summary !== null),
      followUps,
      consent,
      audit,
      pages,
      pageUrlsExpireInSeconds: pageUrlTtlSeconds,
    };
  };

  app.get(
    '/v1/patients/:patientId/export',
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

      const now = new Date().toISOString();

      await patients.appendAudit({
        eventId: `${now}-export`,
        patientId: params.data.patientId,
        actorAccountId: grant.accountId,
        action: 'record_exported',
        entity: 'record',
        entityId: params.data.patientId,
        at: now,
      });

      return reply.send({
        exportedAt: now,
        /** The access this export was produced under. Never widened. */
        exportedUnderRole: grant.role,
        record: await exportRecord(params.data.patientId),
      });
    },
  );

  /**
   * Every record this account can reach, in one file.
   *
   * Assembled record by record through the same grant check, so a viewer's
   * export contains exactly what a viewer can see. There is no account-level
   * shortcut that reads the table by owner: that is the shape this codebase
   * moved away from in ADR-005, and reintroducing it here — in the one endpoint
   * whose whole job is to hand data to somebody — would be the worst place for
   * it.
   */
  app.post('/v1/account/export-request', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = callerOf(request).ownerId;
    const grants = (await access.listGrantsForAccount(accountId)).filter(
      (grant) => grant.status === 'active',
    );

    const records = [];
    for (const grant of grants) {
      records.push({
        patientId: grant.patientId,
        role: grant.role,
        record: await exportRecord(grant.patientId),
      });
    }

    return reply.send({
      exportedAt: new Date().toISOString(),
      accountId,
      /**
       * Returned inline rather than as a link to a file somewhere.
       *
       * A generated export sitting in an object store is a copy of somebody's
       * medical history with a URL, waiting to be found. Handing it back in the
       * response means there is no second copy to protect, expire, or forget.
       */
      records,
    });
  });

  /**
   * Deletes a record and everything in it.
   *
   * `transfer_or_delete_record` — `self` only. Irreversible, and honest about
   * what goes with it: the audit trail lives inside the record, so deleting the
   * record deletes the log of who did what to it. That is the correct reading
   * of erasure, and the response says it plainly rather than leaving a partial
   * trail behind under a patient nobody can name.
   *
   * ## Why this is an operation and not a statement
   *
   * An erasure is several thousand deletes across an object store and a table,
   * and the process running it can die in the middle. The version this replaces
   * would then have deleted some of somebody's documents, reported nothing at
   * all, and left the rest reachable — while an upload already in flight, or a
   * worker finishing a job it started a minute earlier, wrote fresh rows into
   * the partition behind the sweep.
   *
   * So it runs in a shape that survives being interrupted:
   *
   * 1. **A marker goes down first.** Every write path checks it, so nothing new
   *    enters the record from the moment the deletion is accepted.
   * 2. **Bytes, then rows.** A row deleted before its object leaves the object
   *    unreachable, undeletable, and still there.
   * 3. **Grants last, the caller's own last of all** — so an interrupted
   *    erasure can be resumed by the person who asked for it.
   * 4. **The marker comes down at the very end.** Its presence is the evidence
   *    that this record is half-erased; calling this endpoint again finishes the
   *    job, and does not ask for the name a second time because the record it
   *    would be typed against is already gone.
   */
  app.delete(
    '/v1/patients/:patientId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'transfer_or_delete_record',
      );
      if (grant === null) return reply;

      const started = await patients.getDeletion(params.data.patientId);
      const patient = await patients.getPatient(params.data.patientId);

      /**
       * A deletion already under way is resumed rather than restarted.
       *
       * The typed name is not asked for again: the profile row it would be
       * checked against may already be deleted, and the person has confirmed
       * this once. What is *not* skipped is the authorisation above — a resume
       * is still `self` only.
       */
      if (started === null) {
        const body = deleteConfirmation.safeParse(request.body);
        if (!body.success) {
          return reply.code(400).send(invalid('Type the record’s name to confirm.'));
        }
        if (patient === null) return reply.code(404).send(notFound('patient'));
        if (body.data.confirmName.trim().toLowerCase() !== patient.fullName.trim().toLowerCase()) {
          return reply.code(400).send(invalid('That name does not match this record.'));
        }

        await patients.beginDeletion({
          patientId: params.data.patientId,
          requestedByAccountId: grant.accountId,
          requestedAt: new Date().toISOString(),
        });
      }

      /**
       * Bytes first, by prefix rather than by row.
       *
       * A row deleted before its object leaves the object with nothing pointing
       * at it — unreachable, undeletable, and still there. Deriving the keys
       * from the rows had exactly that failure in it: pages uploaded through a
       * URL signed before the deletion began have no row to derive a key from,
       * and neither do pages whose document row an earlier partial deletion had
       * already removed. The prefix is the record, so the prefix is what gets
       * swept.
       */
      const documents = await patients.listDocuments(params.data.patientId);
      const prefix = objects.prefixFor(params.data.patientId);
      const firstSweep = await objects.deletePrefix(prefix);

      const { items } = await patients.deleteEverythingFor(params.data.patientId);

      /**
       * A second sweep, after the rows have gone.
       *
       * A presigned upload URL outlives the request that issued it, so bytes
       * can still arrive while the row sweep runs; the second pass catches
       * those. It does not catch everything — a URL signed a minute before the
       * deletion stays valid for its full lifetime, and nothing here can revoke
       * it — so the response says how long that window is rather than claiming
       * the bytes are certainly all gone.
       */
      const secondSweep = await objects.deletePrefix(prefix);

      /**
       * Every grant is revoked, so nobody is left holding access to a record
       * that no longer exists — and so a helper's device drops its cached copy
       * on its next pull.
       *
       * The caller's own grant goes last. Revoking it first would lock the
       * person out of their own half-finished erasure: `requireAccess` would
       * refuse the resume, and the record would sit fenced and partly deleted
       * with nobody able to finish it.
       */
      const grants = await access.listGrantsForPatient(params.data.patientId);
      const ordered = [
        ...grants.filter((held) => held.accountId !== grant.accountId),
        ...grants.filter((held) => held.accountId === grant.accountId),
      ];
      for (const held of ordered) {
        if (held.status === 'active') {
          await access.revokeGrant(params.data.patientId, held.accountId, grant.accountId);
        }
      }

      /**
       * The marker becomes a tombstone, last, once there is nothing left to
       * fence.
       *
       * Not removed. A marker taken down here would let a write that was
       * paused during the sweep — a worker mid-pipeline, an upload completing —
       * resume a second later and write into the partition that has just been
       * emptied, with nothing left to say the record had ever been deleted.
       * Anything that failed above leaves the marker in its `deleting` state,
       * which is what makes the next call a resume rather than a fresh deletion
       * of a record that is already half gone.
       */
      await patients.completeDeletion(params.data.patientId, new Date().toISOString());

      return reply.send({
        deleted: true,
        /** True when this call finished an erasure an earlier one had begun. */
        resumed: started !== null,
        itemsRemoved: items,
        pagesRemoved: firstSweep.objects + secondSweep.objects,
        /** What the record's own rows said it held, for comparison. */
        pagesExpected: documents.reduce((total, document) => total + document.pageCount, 0),
        grantsRevoked: grants.length,
        /**
         * Said rather than implied, because it is the one gap this path cannot
         * close by itself: an upload URL signed before the deletion keeps
         * working until it expires.
         */
        lateUploadWindowSeconds: uploadUrlTtlSeconds,
        /**
         * Said rather than implied. Copies on other people's phones go when
         * those phones next reach the server, which may be tomorrow — and a
         * response that claimed the data was gone everywhere would be wrong.
         */
        note: 'Copies already downloaded to other devices are removed the next time each device connects.',
      });
    },
  );

  /**
   * Deleting an account.
   *
   * Not the same as deleting records, and the difference is the whole point. An
   * account is a way in; a record is a person. So this revokes every grant the
   * account holds and refuses when that would strand a record — one where this
   * account is the only active grant-holder and the record would be left with
   * nobody who can reach it, including nobody who can delete it.
   *
   * The refusal names the records, so the person can hand them over or delete
   * them first. Doing it silently either way — orphaning them, or deleting
   * other people's records without being asked — is worse than saying no.
   */
  app.post(
    '/v1/account/deletion-request',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const accountId = callerOf(request).ownerId;
      const grants = (await access.listGrantsForAccount(accountId)).filter(
        (grant) => grant.status === 'active',
      );

      const stranded: string[] = [];
      for (const grant of grants) {
        const others = (await access.listGrantsForPatient(grant.patientId)).filter(
          (held) => held.status === 'active' && held.accountId !== accountId,
        );
        if (others.length === 0) stranded.push(grant.patientId);
      }

      if (stranded.length > 0) {
        return reply.code(409).send({
          code: 'records_would_be_stranded' as const,
          message:
            'Some records would be left with nobody who can reach them. Delete them, or give somebody else access, before deleting this account.',
          retryable: false,
          details: { patientIds: stranded },
        });
      }

      const now = new Date().toISOString();
      for (const grant of grants) {
        await access.revokeGrant(grant.patientId, accountId, accountId);

        /**
         * The audit entry is a write like any other, and a record that is being
         * erased refuses it.
         *
         * That is the right refusal — there is nothing left to write it into —
         * and it must not fail the account deletion around it. The access has
         * already been revoked by the line above, which is what this request
         * was for.
         */
        try {
          await patients.appendAudit({
            eventId: `${now}-account-deleted-${grant.patientId}`,
            patientId: grant.patientId,
            actorAccountId: accountId,
            action: 'access_removed_on_account_deletion',
            entity: 'grant',
            entityId: accountId,
            at: now,
          });
        } catch (error) {
          if (!(error instanceof RecordDeletedError)) throw error;
        }
      }

      return reply.send({
        requestedAt: now,
        grantsRevoked: grants.length,
        /**
         * The identity provider holds the login, and this service cannot delete
         * it. Saying so is the difference between an honest report and a claim
         * this endpoint has no way to make good on.
         */
        note: 'Access to every record has been removed. The sign-in itself is deleted separately by the identity provider.',
      });
    },
  );
};
