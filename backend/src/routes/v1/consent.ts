import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import {
  CONSENT_PURPOSES,
  CURRENT_NOTICE_VERSION,
  describeWithdrawal,
  needsReconsent,
  permits,
  type ConsentPurpose,
  type ConsentRecord,
} from '../../services/consent/policy.js';
import type { PatientRecordRepository } from '../../services/records/PatientRecordRepository.js';
import { requireAccess } from './requireAccess.js';
import { beingDeleted, callerOf } from './shared.js';

/**
 * What a person has agreed to, stored where the worker can read it.
 *
 * The model lives in `services/consent/policy.ts` and was already tested; what
 * was missing was everywhere it mattered — nothing persisted a decision,
 * nothing let anybody make one, and the worker was wired to a stub that
 * returned no consent at all. That stub was safe (nothing means not permitted,
 * so nothing was ever summarised) but it was not consent; it was the absence
 * of the feature, spelled defensively.
 *
 * ## Three properties this endpoint has to hold
 *
 * 1. **Append-only.** Each answer is a new record. "They agreed on the 3rd and
 *    withdrew on the 9th" must remain answerable after the 9th, because that is
 *    precisely the question asked when something was processed that should not
 *    have been.
 * 2. **Versioned.** Every record names the notice the person actually read.
 *    "They consented" is not a fact on its own — they consented to *something*,
 *    and when the wording changes, what they agreed to is no longer what the
 *    app does.
 * 3. **Authorised, and separately from sharing.** `manage_consent` is held by
 *    `self` and `manager` only. A contributor may add documents to a record;
 *    they may not decide on the subject's behalf that those documents can be
 *    sent to a language model.
 */

export interface ConsentRoutesOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
}

const patientParam = z.object({ patientId: z.string().min(1).max(128) });

const consentDecision = z.object({
  purpose: z.enum(['storage', 'ai_processing', 'family_sharing']),
  granted: z.boolean(),
  /**
   * The notice the person was shown.
   *
   * Required, and required to be the current one. A client that submits an old
   * version is showing old wording, and accepting it would record agreement to
   * text nobody can reconstruct.
   */
  noticeVersion: z.string().min(1).max(64),
});

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

/** The current answer for each purpose, with the caveats a screen has to show. */
const summarise = (records: ConsentRecord[]) =>
  CONSENT_PURPOSES.map((purpose: ConsentPurpose) => {
    const history = records.filter((record) => record.purpose === purpose);
    const latest = history.at(-1);

    return {
      purpose,
      granted: permits(records, purpose),
      needsReconsent: needsReconsent(records, purpose),
      /** What withdrawing actually does, in the same words the app shows. */
      withdrawalEffect: describeWithdrawal(purpose),
      decidedAt: latest?.decidedAt ?? null,
      decidedBy: latest?.decidedBy ?? null,
      noticeVersion: latest?.noticeVersion ?? null,
      /**
       * Whether a manager answered for somebody who has no account.
       *
       * Surfaced rather than hidden: a caregiver agreeing on a parent's behalf
       * is a different thing from the parent agreeing, and a screen that cannot
       * tell them apart cannot present the record honestly.
       */
      onBehalfOfPatient: latest?.onBehalfOfPatient ?? false,
    };
  });

export const consentRoutes: FastifyPluginAsync<ConsentRoutesOptions> = async (
  app,
  { access, patients },
) => {
  /**
   * What has been agreed for this record.
   *
   * Readable by anyone who can read the record, including a viewer. Somebody
   * who can see a person's medical documents is entitled to know whether those
   * documents are being sent to a provider — that is not a management detail.
   */
  app.get(
    '/v1/patients/:patientId/consent',
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

      const records = await patients.listConsent(params.data.patientId);

      return reply.send({
        noticeVersion: CURRENT_NOTICE_VERSION,
        consent: summarise(records),
      });
    },
  );

  /**
   * Records one decision.
   *
   * Never an update. The reply carries the whole current picture so a client
   * cannot end up believing a purpose is permitted because it just posted a
   * decision about a different one.
   */
  app.post(
    '/v1/patients/:patientId/consent',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      const body = consentDecision.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the consent decision.'));
      }

      if (body.data.noticeVersion !== CURRENT_NOTICE_VERSION) {
        /**
         * 409 rather than 400: the request is well formed, the client is simply
         * showing wording that has since changed. The current version is
         * returned so it can show the new notice and ask again.
         */
        return reply.code(409).send({
          code: 'stale_notice' as const,
          message: 'The wording of this notice has changed. Show the current one and ask again.',
          noticeVersion: CURRENT_NOTICE_VERSION,
          retryable: false,
        });
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'manage_consent',
      );
      if (grant === null) return reply;

      /**
       * A record being erased takes no more decisions.
       *
       * Withdrawing consent during a deletion changes nothing that is not
       * already happening, and granting it would leave a permission row behind
       * in a partition that has just been swept.
       */
      if ((await patients.getDeletion(params.data.patientId)) !== null) {
        return reply.code(410).send(beingDeleted());
      }

      const accountId = callerOf(request).ownerId;

      const record: ConsentRecord = {
        patientId: params.data.patientId,
        purpose: body.data.purpose,
        granted: body.data.granted,
        decidedBy: accountId,
        decidedAt: new Date().toISOString(),
        noticeVersion: body.data.noticeVersion,
        /**
         * Derived from the grant, never from the request body.
         *
         * A client could otherwise claim the patient answered in person by
         * setting a flag, which is the one thing this field exists to prevent.
         * `self` is the record's subject; anyone else is acting for them.
         */
        onBehalfOfPatient: grant.role !== 'self',
      };

      await patients.appendConsent(record);

      /**
       * Audited, because a consent decision is exactly the kind of change the
       * subject is entitled to see later. Metadata only — the purpose and the
       * verb, never the notice text.
       */
      await patients.appendAudit({
        eventId: `${record.decidedAt}-consent`,
        patientId: params.data.patientId,
        actorAccountId: accountId,
        action: body.data.granted ? 'consent_granted' : 'consent_withdrawn',
        entity: 'consent',
        entityId: body.data.purpose,
        at: record.decidedAt,
      });

      const records = await patients.listConsent(params.data.patientId);

      return reply.code(201).send({
        noticeVersion: CURRENT_NOTICE_VERSION,
        consent: summarise(records),
      });
    },
  );

  /**
   * The full history, for the record's own people.
   *
   * `read_grants` rather than `read_record`: this is the "who decided what,
   * when, and on whose behalf" view, and it belongs with the other questions
   * about who holds power over a record.
   */
  app.get(
    '/v1/patients/:patientId/consent/history',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'read_grants',
      );
      if (grant === null) return reply;

      return reply.send({ history: await patients.listConsent(params.data.patientId) });
    },
  );
};
