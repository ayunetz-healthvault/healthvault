import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AccessRepository } from '../../services/access/AccessRepository.js';
import { allows, type Action, type Grant } from '../../services/access/policy.js';
import { callerOf, notFound } from './shared.js';

/**
 * The authorisation check, in one place.
 *
 * Every `/v1` handler that names a patient calls this before touching anything.
 * Having exactly one implementation is the point: a second copy would
 * eventually differ, and the way it would differ is by being more permissive.
 *
 * Two refusals, and the difference matters:
 *
 * - **No grant → 404**, byte-identical to a patient that does not exist. Any
 *   other answer makes every id-taking endpoint a way to test which ids are
 *   real.
 * - **A grant that does not permit this action → 403.** The caller can already
 *   see the record, so hiding it would only confuse them; what they may not do
 *   is the honest answer.
 *
 * Returns `null` when it has already replied, so a handler's next line is
 * always `if (grant === null) return reply;`.
 */
export const requireAccess = async (
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
    await reply.code(403).send({
      code: 'forbidden' as const,
      message: 'You do not have permission to do that.',
      retryable: false,
    });
    return null;
  }

  return grant;
};
