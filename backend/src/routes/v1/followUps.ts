import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import type { PatientRecordRepository } from '../../services/records/PatientRecordRepository.js';
import type { FollowUpRecord } from '../../services/records/RecordRepository.js';
import { requireAccess } from './requireAccess.js';
import { beingDeleted, callerOf, notFound } from './shared.js';

/**
 * Things the family has to do next: an appointment, a test, a refill.
 *
 * ## Why these are on the server at all
 *
 * Because a follow-up is the one record that is *about* coordination. "Who is
 * taking Amma to the eye clinic on Thursday" is a question two people ask on
 * two phones, and a task that lives on one of them answers it for neither. It
 * is also the record most likely to be created by one person and completed by
 * another.
 *
 * ## What the origin field is for
 *
 * A follow-up a person typed and a follow-up accepted from a summary are
 * different things, and `origin` keeps them apart forever. Note what does not
 * exist here: any way for the pipeline to create one. A suggestion the
 * summariser produced is part of the summary until a person accepts it, and
 * acceptance happens in the app, through this endpoint, as an ordinary create
 * with `origin: 'document'`.
 *
 * ## Calendars
 *
 * `calendarEventId` is stored, and storing it grants nothing. Writing to a
 * device calendar is a device decision that its owner confirms; this field
 * only stops a second device offering to create an event that already exists.
 */

export interface FollowUpRoutesOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
}

const patientParam = z.object({ patientId: z.string().min(1).max(128) });
const followUpParam = patientParam.extend({ followUpId: z.string().min(1).max(128) });

const FOLLOW_UP_KINDS = [
  'doctor_visit',
  'lab_test',
  'medicine_refill',
  'vaccination',
  'physiotherapy',
  'other',
] as const;

/**
 * `missed` is one of these because it happens.
 *
 * An appointment nobody kept is a fact about the record, and it is the fact the
 * other person most needs to see. Leaving it out meant the app could set a
 * status the server refused, so "we missed Thursday's clinic" was saved on one
 * phone and rejected on its way to everybody else's.
 */
const STATUSES = ['scheduled', 'completed', 'missed', 'cancelled'] as const;

/**
 * The id the device generated, before it had ever spoken to a server.
 *
 * This is the identity fix. The app writes a follow-up locally, queues it, and
 * may not reach the server for hours; if the server minted its own id on
 * arrival, the app would go on holding one the server has never heard of, and
 * every later edit or deletion would be a 404. So the device's id *is* the id,
 * and the one place it comes from is the client.
 *
 * It is also the idempotency key. A request that commits and loses its response
 * on the way back is indistinguishable from one that never arrived, so the
 * retry carries the same id and is answered with the follow-up that already
 * exists rather than a second copy of the same appointment.
 *
 * Optional, and constrained: the value ends up in a sort key, so it is limited
 * to characters that cannot forge one.
 */
const clientFollowUpId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, underscore or hyphen.');

const followUpDraft = z.object({
  followUpId: clientFollowUpId.optional(),
  title: z.string().min(1).max(200),
  kind: z.enum(FOLLOW_UP_KINDS),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.')
    .nullable()
    .optional(),
  notes: z.string().max(2000).optional(),
  /**
   * `document` requires a document id, checked below. A follow-up claiming to
   * come from a report without naming one cannot be traced back, which defeats
   * the point of recording where it came from.
   */
  origin: z.enum(['manual', 'document']).default('manual'),
  sourceDocumentId: z.string().min(1).max(128).nullable().optional(),
  doctorCategory: z.string().min(1).max(64).nullable().optional(),
});

const followUpPatch = followUpDraft.omit({ followUpId: true }).partial().extend({
  status: z.enum(STATUSES).optional(),
  calendarEventId: z.string().min(1).max(256).nullable().optional(),
});

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

/** `410 Gone` for a record being erased — see `documents.ts`. */
const RECORD_DELETING = 410;

const clean = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;

export const followUpRoutes: FastifyPluginAsync<FollowUpRoutesOptions> = async (
  app,
  { access, patients },
) => {
  app.get(
    '/v1/patients/:patientId/follow-ups',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'read_record');
      if (grant === null) return reply;

      return reply.send({ followUps: await patients.listFollowUps(params.data.patientId) });
    },
  );

  app.post(
    '/v1/patients/:patientId/follow-ups',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      const body = followUpDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the follow-up.'));
      }

      if (body.data.origin === 'document' && !body.data.sourceDocumentId) {
        return reply
          .code(400)
          .send(invalid('A follow-up from a document has to name the document.'));
      }

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'manage_tasks');
      if (grant === null) return reply;

      if ((await patients.getDeletion(params.data.patientId)) !== null) {
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      /**
       * Already here.
       *
       * The retry of a request that committed, or the second tap of a button on
       * a slow connection. Either way the answer is the follow-up that exists,
       * with a 200 rather than a 201 so a caller can tell the two apart — and
       * no second audit entry, because nothing was created.
       */
      if (body.data.followUpId !== undefined) {
        const existing = await patients.getFollowUp(
          params.data.patientId,
          body.data.followUpId,
        );
        if (existing !== null) return reply.code(200).send({ followUp: existing });
      }

      const now = new Date().toISOString();
      const followUp: FollowUpRecord = clean({
        followUpId:
          body.data.followUpId ??
          `fup_${now.replace(/\D/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
        parentId: params.data.patientId,
        title: body.data.title,
        kind: body.data.kind,
        dueDate: body.data.dueDate,
        dueTime: body.data.dueTime ?? null,
        notes: body.data.notes ?? '',
        status: 'scheduled',
        origin: body.data.origin,
        sourceDocumentId: body.data.sourceDocumentId ?? null,
        doctorCategory: body.data.doctorCategory ?? null,
        calendarEventId: null,
        createdAt: now,
        updatedAt: now,
      });

      await patients.putFollowUp(params.data.patientId, followUp);
      await patients.appendAudit({
        eventId: `${now}-followup-created`,
        patientId: params.data.patientId,
        actorAccountId: callerOf(request).ownerId,
        action: 'follow_up_created',
        entity: 'follow_up',
        entityId: followUp.followUpId,
        at: now,
      });

      return reply.code(201).send({ followUp });
    },
  );

  app.patch(
    '/v1/patients/:patientId/follow-ups/:followUpId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = followUpParam.safeParse(request.params);
      const body = followUpPatch.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the change.'));
      }

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'manage_tasks');
      if (grant === null) return reply;

      if ((await patients.getDeletion(params.data.patientId)) !== null) {
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      const existing = await patients.getFollowUp(params.data.patientId, params.data.followUpId);
      if (existing === null) return reply.code(404).send(notFound('follow-up'));

      const now = new Date().toISOString();
      /**
       * Merged field by field rather than spread.
       *
       * A partial body carries `undefined` for everything the caller left out,
       * and spreading those over the existing record blanks it — a request that
       * only marks a task done would erase its title.
       *
       * Origin and provenance are deliberately absent from this list: a task
       * accepted from a summary cannot be relabelled as one somebody typed, in
       * either direction, because that erases the only record of where the
       * instruction came from.
       */
      const patch = body.data;
      const updated: FollowUpRecord = clean({
        followUpId: existing.followUpId,
        parentId: existing.parentId,
        title: patch.title ?? existing.title,
        kind: patch.kind ?? existing.kind,
        dueDate: patch.dueDate ?? existing.dueDate,
        dueTime: patch.dueTime === undefined ? (existing.dueTime ?? null) : patch.dueTime,
        notes: patch.notes ?? existing.notes ?? '',
        status: patch.status ?? existing.status,
        origin: existing.origin,
        sourceDocumentId: existing.sourceDocumentId ?? null,
        doctorCategory:
          patch.doctorCategory === undefined
            ? (existing.doctorCategory ?? null)
            : patch.doctorCategory,
        calendarEventId:
          patch.calendarEventId === undefined
            ? (existing.calendarEventId ?? null)
            : patch.calendarEventId,
        createdAt: existing.createdAt,
        updatedAt: now,
      });

      /**
       * A changed due date changes the sort key, so the old row is removed
       * rather than left behind as a duplicate at the previous date.
       */
      if (updated.dueDate !== existing.dueDate) {
        await patients.deleteFollowUp(
          params.data.patientId,
          existing.dueDate,
          existing.followUpId,
        );
      }

      await patients.putFollowUp(params.data.patientId, updated);

      return reply.send({ followUp: updated });
    },
  );

  app.delete(
    '/v1/patients/:patientId/follow-ups/:followUpId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = followUpParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a follow-up id.'));

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'manage_tasks');
      if (grant === null) return reply;

      const existing = await patients.getFollowUp(params.data.patientId, params.data.followUpId);
      if (existing === null) return reply.code(404).send(notFound('follow-up'));

      await patients.deleteFollowUp(
        params.data.patientId,
        existing.dueDate,
        existing.followUpId,
      );

      const now = new Date().toISOString();
      await patients.appendAudit({
        eventId: `${now}-followup-deleted`,
        patientId: params.data.patientId,
        actorAccountId: callerOf(request).ownerId,
        action: 'follow_up_deleted',
        entity: 'follow_up',
        entityId: existing.followUpId,
        at: now,
      });

      return reply.code(204).send();
    },
  );
};
