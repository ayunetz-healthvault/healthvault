import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import {
  AlreadyExistsError,
  RecordDeletedError,
  type PatientRecordRepository,
} from '../../services/records/PatientRecordRepository.js';
import type {
  DoseEventRecord,
  ObservationRecord,
  TreatmentScheduleRecord,
} from '../../services/records/RecordRepository.js';
import { requireAccess } from './requireAccess.js';
import { beingDeleted, callerOf, notFound } from './shared.js';

/**
 * The three records daily care actually produces: what somebody noticed, what
 * they are taking, and whether they took it.
 *
 * These were built, tested and stored on one phone. `mutationSender` refused
 * them explicitly rather than queueing them against endpoints that did not
 * exist — which was honest, and meant a caregiver's note and a recorded dose
 * reached nobody. Shared care that cannot share the two things a carer does
 * every day is not shared care.
 *
 * ## What each of them refuses to become
 *
 * **An observation is not a symptom this service has classified.** The text is
 * stored exactly as written: no severity, no triage flag, no mapping to a
 * clinical term. `impact` is the person's own answer about their day. The
 * moment a server assigns weight to "Amma felt dizzy after the new tablet" it
 * is practising medicine on the strength of a text box.
 *
 * **A schedule is never created from a document.** `confirmedBy` and
 * `confirmedAt` are required, and there is no path here for the pipeline to
 * write one: a medicine a model read off a prescription is a mention until a
 * person confirms it, at times they chose. Changing one supersedes it rather
 * than editing it, so what somebody was taking last month stays readable.
 *
 * **A dose event is append-only, and silence is never a missed dose.** There
 * is no update and no delete. Undo appends an event that supersedes the
 * earlier one, marked as an undo, so "taken, then corrected to missed" and
 * "taken, then undone" stay different things. Nothing in this file writes a
 * `missed` event on its own — a dose nobody recorded is unrecorded, which is
 * what the app shows.
 *
 * ## Who may do what
 *
 * Notes are `contribute_notes`; medicines and doses are `record_treatment`.
 * They are separate actions because they are separate powers: a helper may
 * write down what they saw without being able to state, on the record, that
 * somebody took their tablets.
 */

export interface DailyCareRoutesOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
}

const patientParam = z.object({ patientId: z.string().min(1).max(128) });

/** Client-generated, and constrained because it lands in a sort key. */
const clientId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, underscore or hyphen.');

const IMPACTS = ['a_little', 'moderately', 'a_lot'] as const;
const isoDateTime = z.string().datetime();

const observationDraft = z.object({
  observationId: clientId,
  /**
   * No maximum below 4000 and no minimum above 1.
   *
   * Somebody describing a fortnight of symptoms in one box is doing the right
   * thing; a limit that truncated them would lose the part a doctor needed.
   */
  text: z.string().min(1).max(4000),
  occurredAt: isoDateTime,
  impact: z.enum(IMPACTS),
  recordedBy: z.string().min(1).max(128),
  recordedAt: isoDateTime,
});

const observationPatch = z.object({
  text: z.string().min(1).max(4000).optional(),
  impact: z.enum(IMPACTS).optional(),
  /**
   * The version being edited.
   *
   * Required, because two family members editing the same note is not a rare
   * case in a record built for two family members. A stale version is a
   * conflict a person resolves, never a silent overwrite.
   */
  version: z.number().int().positive(),
});

const scheduleDraft = z.object({
  scheduleId: clientId,
  name: z.string().min(1).max(200),
  dosage: z.string().min(1).max(120),
  /**
   * Times of day, not a frequency.
   *
   * "Twice a day" says how many times and nothing about when, and the app
   * refuses to guess for the same reason this does: the decision belongs to
   * the person taking the medicine.
   */
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.'))
    .min(1)
    .max(12),
  timezone: z.string().min(1).max(64),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  provenance: z.enum(['manual', 'from_document']),
  sourceDocumentId: z.string().min(1).max(128).nullable().optional(),
  /**
   * Who confirmed it, and when. Both required.
   *
   * The one field that separates a medicine somebody is taking from a line a
   * model read on a photograph. A default here — the caller, say — would let a
   * client create reminders to take a drug that nobody had confirmed.
   */
  confirmedBy: z.string().min(1).max(128),
  confirmedAt: isoDateTime,
});

const supersedeRequest = z.object({ supersededAt: isoDateTime });

const doseEventDraft = z.object({
  eventId: clientId,
  scheduleId: clientId,
  occurrenceKey: z.string().min(1).max(256),
  occurrenceAt: isoDateTime,
  /** Only what a person pressed. Nothing here is derived from silence. */
  state: z.enum(['taken', 'missed']),
  recordedAt: isoDateTime,
  recordedBy: z.string().min(1).max(128),
  recordedBySelf: z.boolean(),
  supersedesEventId: clientId.nullable().optional(),
  undo: z.boolean().default(false),
});

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

/** `410 Gone` for a record being erased — see `documents.ts`. */
const RECORD_DELETING = 410;

export const dailyCareRoutes: FastifyPluginAsync<DailyCareRoutesOptions> = async (
  app,
  { access, patients },
) => {
  app.get(
    '/v1/patients/:patientId/observations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'read_record');
      if (grant === null) return reply;

      return reply.send({ observations: await patients.listObservations(params.data.patientId) });
    },
  );

  app.post(
    '/v1/patients/:patientId/observations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      const body = observationDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the note.'));
      }

      // Writing down what you saw is contributing, not managing treatment.
      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'contribute_notes',
      );
      if (grant === null) return reply;

      const now = new Date().toISOString();
      const observation: ObservationRecord = {
        observationId: body.data.observationId,
        parentId: params.data.patientId,
        // Exactly as written, trimmed only of surrounding whitespace.
        text: body.data.text.trim(),
        occurredAt: body.data.occurredAt,
        impact: body.data.impact,
        recordedBy: body.data.recordedBy,
        /**
         * Derived from the grant, never taken from the body.
         *
         * A client could otherwise claim the patient wrote this themselves,
         * and "my mother says she felt dizzy" is a different fact from "her
         * daughter thinks she looked dizzy".
         */
        recordedBySelf: grant.role === 'self',
        recordedAt: body.data.recordedAt,
        version: 1,
        updatedAt: now,
      };

      try {
        await patients.createObservation(params.data.patientId, observation);
      } catch (error) {
        if (error instanceof RecordDeletedError) {
          return reply.code(RECORD_DELETING).send(beingDeleted());
        }
        if (!(error instanceof AlreadyExistsError)) throw error;

        // The retry of a request that committed. Answer with what is there.
        const existing = await patients.getObservation(
          params.data.patientId,
          body.data.observationId,
        );
        if (existing === null) throw error;
        return reply.code(200).send({ observation: existing });
      }

      return reply.code(201).send({ observation });
    },
  );

  app.patch(
    '/v1/patients/:patientId/observations/:observationId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam
        .extend({ observationId: z.string().min(1).max(128) })
        .safeParse(request.params);
      const body = observationPatch.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the change.'));
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'contribute_notes',
      );
      if (grant === null) return reply;

      const existing = await patients.getObservation(
        params.data.patientId,
        params.data.observationId,
      );
      if (existing === null) return reply.code(404).send(notFound('observation'));

      /**
       * Somebody else edited it first.
       *
       * 409 with the current version and text, so the screen can show both and
       * let a person decide. Overwriting would silently discard what the other
       * family member wrote, and neither of them would ever know.
       */
      if (body.data.version !== existing.version) {
        return reply.code(409).send({
          code: 'observation_changed' as const,
          message: 'Somebody else changed this note first.',
          retryable: false,
          details: { version: existing.version },
        });
      }

      const updated: ObservationRecord = {
        ...existing,
        text: body.data.text === undefined ? existing.text : body.data.text.trim(),
        impact: body.data.impact ?? existing.impact,
        /**
         * The author and the time it happened are not patchable.
         *
         * An edit changes what was written, not who wrote it or when the thing
         * being described took place — rewriting either would let one person's
         * correction quietly reattribute somebody else's note.
         */
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };

      try {
        await patients.putObservation(params.data.patientId, updated);
      } catch (error) {
        if (!(error instanceof RecordDeletedError)) throw error;
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      return reply.send({ observation: updated });
    },
  );

  app.delete(
    '/v1/patients/:patientId/observations/:observationId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam
        .extend({ observationId: z.string().min(1).max(128) })
        .safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide an observation id.'));

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'contribute_notes',
      );
      if (grant === null) return reply;

      const existing = await patients.getObservation(
        params.data.patientId,
        params.data.observationId,
      );
      if (existing === null) return reply.code(404).send(notFound('observation'));

      await patients.deleteObservation(params.data.patientId, params.data.observationId);
      return reply.code(204).send();
    },
  );

  app.get(
    '/v1/patients/:patientId/treatments',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'read_record');
      if (grant === null) return reply;

      /**
       * Superseded schedules are returned too, and deliberately.
       *
       * "What was she taking in August" is a question somebody asks in a
       * consulting room. The row carries `supersededAt`, so a client can show
       * the current ones and still answer it.
       */
      return reply.send({ treatments: await patients.listSchedules(params.data.patientId) });
    },
  );

  app.post(
    '/v1/patients/:patientId/treatments',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      const body = scheduleDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the medicine.'));
      }

      if (body.data.provenance === 'from_document' && !body.data.sourceDocumentId) {
        return reply
          .code(400)
          .send(invalid('A medicine read from a document has to name the document.'));
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'record_treatment',
      );
      if (grant === null) return reply;

      const now = new Date().toISOString();
      const schedule: TreatmentScheduleRecord = {
        scheduleId: body.data.scheduleId,
        parentId: params.data.patientId,
        name: body.data.name,
        dosage: body.data.dosage,
        // Sorted, so two clients that confirmed the same times in a different
        // order produce the same schedule.
        times: [...body.data.times].sort(),
        timezone: body.data.timezone,
        startDate: body.data.startDate,
        endDate: body.data.endDate ?? null,
        provenance: body.data.provenance,
        sourceDocumentId: body.data.sourceDocumentId ?? null,
        confirmedBy: body.data.confirmedBy,
        confirmedAt: body.data.confirmedAt,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await patients.createSchedule(params.data.patientId, schedule);
      } catch (error) {
        if (error instanceof RecordDeletedError) {
          return reply.code(RECORD_DELETING).send(beingDeleted());
        }
        if (!(error instanceof AlreadyExistsError)) throw error;

        const existing = await patients.getSchedule(params.data.patientId, body.data.scheduleId);
        if (existing === null) throw error;
        return reply.code(200).send({ treatment: existing });
      }

      await patients.appendAudit({
        eventId: `${now}-treatment-confirmed`,
        patientId: params.data.patientId,
        actorAccountId: callerOf(request).ownerId,
        action: 'treatment_confirmed',
        entity: 'treatment',
        entityId: schedule.scheduleId,
        at: now,
      });

      return reply.code(201).send({ treatment: schedule });
    },
  );

  /**
   * Stops a schedule. The only edit there is.
   *
   * Not a general PATCH: changing the times or the dose of a medicine somebody
   * is taking produces a *new* schedule, because what they were taking before
   * is part of the record. This sets the end and leaves everything else alone.
   */
  app.post(
    '/v1/patients/:patientId/treatments/:scheduleId/supersede',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam
        .extend({ scheduleId: z.string().min(1).max(128) })
        .safeParse(request.params);
      const body = supersedeRequest.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Say when it stopped.'));
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'record_treatment',
      );
      if (grant === null) return reply;

      const existing = await patients.getSchedule(params.data.patientId, params.data.scheduleId);
      if (existing === null) return reply.code(404).send(notFound('treatment'));

      // Already stopped: the first answer stands rather than moving the date,
      // so a retry cannot rewrite when somebody came off a medicine.
      if (existing.supersededAt) return reply.code(200).send({ treatment: existing });

      const updated: TreatmentScheduleRecord = {
        ...existing,
        supersededAt: body.data.supersededAt,
        updatedAt: new Date().toISOString(),
      };

      try {
        await patients.putSchedule(params.data.patientId, updated);
      } catch (error) {
        if (!(error instanceof RecordDeletedError)) throw error;
        return reply.code(RECORD_DELETING).send(beingDeleted());
      }

      return reply.send({ treatment: updated });
    },
  );

  app.get(
    '/v1/patients/:patientId/dose-events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(request, reply, access, params.data.patientId, 'read_record');
      if (grant === null) return reply;

      return reply.send({ doseEvents: await patients.listDoseEvents(params.data.patientId) });
    },
  );

  /**
   * Records what somebody pressed. Append-only.
   *
   * There is no PATCH and no DELETE for a dose event anywhere in this service,
   * and that is the design rather than an omission: undoing a tap appends an
   * event that supersedes it. A record of somebody's medicines that can be
   * quietly rewritten cannot answer the question it exists for.
   */
  app.post(
    '/v1/patients/:patientId/dose-events',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientParam.safeParse(request.params);
      const body = doseEventDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Check the dose.'));
      }

      const grant = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'record_treatment',
      );
      if (grant === null) return reply;

      const schedule = await patients.getSchedule(params.data.patientId, body.data.scheduleId);
      if (schedule === null) return reply.code(404).send(notFound('treatment'));

      const event: DoseEventRecord = {
        eventId: body.data.eventId,
        parentId: params.data.patientId,
        scheduleId: body.data.scheduleId,
        occurrenceKey: body.data.occurrenceKey,
        occurrenceAt: body.data.occurrenceAt,
        state: body.data.state,
        recordedAt: body.data.recordedAt,
        recordedBy: body.data.recordedBy,
        /**
         * From the grant, not the body — the same rule as an observation, and
         * it matters more here. "She told me she took it" and "I watched her
         * take it" are different claims, and only one of them is the patient's
         * own.
         */
        recordedBySelf: grant.role === 'self',
        supersedesEventId: body.data.supersedesEventId ?? null,
        undo: body.data.undo,
        createdAt: new Date().toISOString(),
      };

      try {
        await patients.appendDoseEvent(params.data.patientId, event);
      } catch (error) {
        if (error instanceof RecordDeletedError) {
          return reply.code(RECORD_DELETING).send(beingDeleted());
        }
        if (!(error instanceof AlreadyExistsError)) throw error;

        /**
         * The same tap, twice. One tablet, one event.
         *
         * This is the case the occurrence key exists for, and answering with
         * the event that is already there is the whole point: a second row for
         * one dose would make the record say a tablet was taken twice.
         */
        const events = await patients.listDoseEvents(params.data.patientId);
        const already = events.find((entry) => entry.eventId === body.data.eventId);
        if (already === undefined) throw error;
        return reply.code(200).send({ doseEvent: already });
      }

      return reply.code(201).send({ doseEvent: event });
    },
  );
};
