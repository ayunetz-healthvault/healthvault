import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import {
  allows,
  canGrantRole,
  canRevoke,
  GRANTABLE_ROLES,
  type Action,
  type Grant,
} from '../../services/access/policy.js';
import type { PatientRecordRepository } from '../../services/records/PatientRecordRepository.js';
import { callerOf, notFound } from './shared.js';

/**
 * Patients, and who may reach them.
 *
 * ## The one rule
 *
 * Every handler that touches a patient resolves a grant first, through
 * `requireAccess`. There is no path in this file that reads a `patientId` from
 * a request and uses it without that call, and `requireAccess` answers a
 * missing grant with the same 404 as a patient that does not exist — otherwise
 * any endpoint taking a patient id becomes a way to test which ids are real.
 */

export interface AccessRoutesOptions {
  access: AccessRepository;
  patients: PatientRecordRepository;
  /** How long an invitation stays usable. Seven days by default. */
  invitationTtlSeconds?: number;
}

const DEFAULT_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

const patientIdParam = z.object({ patientId: z.string().min(1).max(128) });
const accountIdParam = patientIdParam.extend({ accountId: z.string().min(1).max(128) });

const patientDraft = z.object({
  fullName: z.string().min(1).max(200),
  relationship: z.string().min(1).max(40),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  city: z.string().max(120).optional(),
  /**
   * Whether the caller is the subject of this record or is managing it for
   * somebody else.
   *
   * Asked explicitly rather than inferred. "I am creating a record" and "I am
   * creating a record about my mother" produce different grants and different
   * powers, and guessing wrong in either direction is bad: a caregiver silently
   * made the subject of their parent's record, or a patient unable to control
   * their own.
   */
  subject: z.enum(['me', 'someone_else']),
});

const invitationDraft = z.object({
  role: z.enum(['manager', 'contributor', 'viewer']),
  /** Hashed before storage; the plaintext never reaches the database. */
  inviteeHint: z.string().max(200).optional(),
});

const acceptDraft = z.object({ token: z.string().min(8).max(512) });

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

const forbidden = {
  code: 'forbidden' as const,
  message: 'You do not have permission to do that.',
  retryable: false,
};

/**
 * A grant that permits `action`, or a reply already sent.
 *
 * Two different refusals, and the difference matters:
 *
 * - **No grant at all → 404.** The caller learns nothing about whether the
 *   patient exists. Anything else makes this a membership oracle.
 * - **A grant that does not permit this action → 403.** The caller already
 *   knows the record exists — they can read it — so hiding it would only be
 *   confusing. What they may not do is the honest answer.
 */
const requireAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  access: AccessRepository,
  patientId: string,
  action: Action,
): Promise<Grant | null> => {
  const accountId = callerOf(request).ownerId;
  const grant = await access.getGrant(patientId, accountId);

  if (grant === null || grant.status !== 'active') {
    await reply.code(404).send(notFound('patient'));
    return null;
  }

  if (!allows(grant, action)) {
    await reply.code(403).send(forbidden);
    return null;
  }

  return grant;
};

/** Never carries the plaintext, so a hint cannot be turned back into an address. */
const hintOf = async (value: string | undefined): Promise<string | undefined> => {
  if (value === undefined) return undefined;
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 16);
};

export const accessRoutes: FastifyPluginAsync<AccessRoutesOptions> = async (
  app,
  { access, patients, invitationTtlSeconds = DEFAULT_INVITATION_TTL_SECONDS },
) => {
  /**
   * Every patient this account can reach.
   *
   * The first call the app makes after sign-in, and the thing that decides
   * which of the two experiences renders. Revoked grants are filtered here so
   * a withdrawn record disappears from the list rather than appearing greyed
   * out with its name still visible.
   */
  app.get('/v1/patients', { preHandler: app.authenticate }, async (request, reply) => {
    const accountId = callerOf(request).ownerId;
    const grants = (await access.listGrantsForAccount(accountId)).filter(
      (grant) => grant.status === 'active',
    );

    const records = await Promise.all(
      grants.map(async (grant) => {
        const patient = await patients.getPatient(grant.patientId);
        return patient === null ? null : { patient, role: grant.role };
      }),
    );

    return reply.send({ patients: records.filter((entry) => entry !== null) });
  });

  /**
   * Creates a patient record, and the grant that goes with it.
   *
   * The two writes are not atomic, and the order is deliberate: the grant is
   * written *after* the record, so a crash between them leaves a record nobody
   * can reach rather than a grant pointing at nothing. The first is
   * recoverable by an operator; the second is a dangling permission.
   */
  app.post('/v1/patients', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = patientDraft.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalid('Check the details.'));

    const accountId = callerOf(request).ownerId;
    const now = new Date().toISOString();
    const patientId = `pat_${crypto.randomUUID()}`;
    const { subject, ...details } = parsed.data;

    await patients.putPatient({
      patientId,
      ...details,
      createdByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });

    const grant =
      subject === 'me'
        ? await access.createSelfGrant(patientId, accountId)
        : await access.createManagerGrant(patientId, accountId);

    if (grant === null) {
      // Only reachable if the same patient id already had a subject, which for
      // a freshly generated id means something is badly wrong. Refusing beats
      // returning a record the caller cannot open.
      return reply.code(409).send({
        code: 'conflict',
        message: 'That record could not be created.',
        retryable: false,
      });
    }

    await patients.appendAudit({
      eventId: crypto.randomUUID(),
      patientId,
      actorAccountId: accountId,
      action: 'create',
      entity: 'patient',
      entityId: patientId,
      at: now,
    });

    return reply.code(201).send({ patient: await patients.getPatient(patientId), role: grant.role });
  });

  app.get('/v1/patients/:patientId', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = patientIdParam.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(invalid('Provide a patient id.'));

    const grant = await requireAccess(request, reply, access, parsed.data.patientId, 'read_record');
    if (grant === null) return reply;

    const patient = await patients.getPatient(parsed.data.patientId);
    if (patient === null) return reply.code(404).send(notFound('patient'));

    return reply.send({ patient, role: grant.role });
  });

  /** Who holds access, for the record's own Family screen. */
  app.get(
    '/v1/patients/:patientId/grants',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = patientIdParam.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const grant = await requireAccess(request, reply, access, parsed.data.patientId, 'read_grants');
      if (grant === null) return reply;

      return reply.send({
        grants: await access.listGrantsForPatient(parsed.data.patientId),
      });
    },
  );

  /**
   * Invites somebody.
   *
   * The token comes back **once**, in this response, and is never stored or
   * logged: only its hash reaches the database. Sending it to the invitee is
   * deliberately not this service's job — see the note in ADR-005.
   */
  app.post(
    '/v1/patients/:patientId/invitations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = patientIdParam.safeParse(request.params);
      const body = invitationDraft.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(invalid('Choose what the person may do.'));
      }

      const actor = await requireAccess(
        request,
        reply,
        access,
        params.data.patientId,
        'manage_grants',
      );
      if (actor === null) return reply;

      // Belt and braces: `requireAccess` proved the permission, this proves the
      // role being handed out is one that may be handed out at all.
      if (!canGrantRole(actor, body.data.role)) return reply.code(403).send(forbidden);

      const issued = await access.createInvitation({
        patientId: params.data.patientId,
        role: body.data.role,
        invitedBy: actor.accountId,
        ttlSeconds: invitationTtlSeconds,
        inviteeHint: await hintOf(body.data.inviteeHint),
      });

      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: params.data.patientId,
        actorAccountId: actor.accountId,
        action: 'invite',
        entity: 'grant',
        entityId: body.data.role,
        at: issued.invitation.createdAt,
      });

      return reply.code(201).send({ token: issued.token, invitation: issued.invitation });
    },
  );

  app.get(
    '/v1/patients/:patientId/invitations',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = patientIdParam.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide a patient id.'));

      const actor = await requireAccess(
        request,
        reply,
        access,
        parsed.data.patientId,
        'manage_grants',
      );
      if (actor === null) return reply;

      return reply.send({
        invitations: await access.listInvitationsForPatient(parsed.data.patientId),
      });
    },
  );

  /**
   * Accepts an invitation.
   *
   * The only route here that does **not** call `requireAccess`, because the
   * caller has no grant yet — that is the point of it. What it does require is
   * an authenticated account: a token on its own reads nothing, so an
   * invitation that leaks is not a key to the record, only an offer that
   * somebody with an account can take up.
   */
  app.post('/v1/invitations/accept', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = acceptDraft.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalid('Provide the invitation token.'));

    const accountId = callerOf(request).ownerId;
    const result = await access.acceptInvitation(parsed.data.token, accountId);

    if (result.outcome === 'rejected') {
      // One answer for wrong, spent, revoked and expired.
      return reply.code(404).send({
        code: 'invitation_not_valid',
        message: 'That invitation is not valid. Ask for a new one.',
        retryable: false,
      });
    }

    if (result.outcome === 'accepted') {
      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: result.grant.patientId,
        actorAccountId: accountId,
        action: 'accept_invitation',
        entity: 'grant',
        entityId: result.grant.role,
        at: result.grant.grantedAt,
      });
    }

    return reply.send({ grant: result.grant, alreadyGranted: result.outcome === 'already_granted' });
  });

  /**
   * Withdraws somebody's access.
   *
   * Takes effect on the next server operation. What it cannot do is reach a
   * copy already downloaded to a device that is offline, or an object a
   * presigned URL was already issued for — both are bounded, and both are
   * stated in ADR-005 rather than glossed over here.
   */
  app.delete(
    '/v1/patients/:patientId/grants/:accountId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = accountIdParam.safeParse(request.params);
      if (!parsed.success) return reply.code(400).send(invalid('Provide the access to remove.'));

      const actor = await requireAccess(
        request,
        reply,
        access,
        parsed.data.patientId,
        'manage_grants',
      );
      if (actor === null) return reply;

      const target = await access.getGrant(parsed.data.patientId, parsed.data.accountId);
      if (target === null) return reply.code(404).send(notFound('access grant'));

      // The self grant is not revocable by anybody, including its holder: a
      // record whose subject cannot reach it has no recovery path.
      if (!canRevoke(actor, target)) return reply.code(403).send(forbidden);

      const revoked = await access.revokeGrant(
        parsed.data.patientId,
        parsed.data.accountId,
        actor.accountId,
      );
      // Already revoked. Saying so is harmless — the caller can see the grant
      // list — and the alternative is a confusing 404 for a row they just read.
      if (revoked === null) return reply.code(409).send({
        code: 'already_revoked',
        message: 'That access has already been removed.',
        retryable: false,
      });

      await patients.appendAudit({
        eventId: crypto.randomUUID(),
        patientId: parsed.data.patientId,
        actorAccountId: actor.accountId,
        action: 'revoke',
        entity: 'grant',
        entityId: parsed.data.accountId,
        at: revoked.revokedAt ?? new Date().toISOString(),
      });

      return reply.code(204).send();
    },
  );

  /** Exposed so a client can render the choices without hard-coding them. */
  app.get('/v1/grant-roles', { preHandler: app.authenticate }, async (_request, reply) =>
    reply.send({ roles: GRANTABLE_ROLES }),
  );
};
