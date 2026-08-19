import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { RecordRepository } from '../../services/records/RecordRepository.js';
import { callerOf, notFound } from './shared.js';

/**
 * Parent profiles.
 *
 * Every handler reads the owner from `callerOf(request)` and never from the
 * body or the path. A client can name any `parentId` it likes; naming one that
 * belongs to somebody else returns 404, because the query is scoped to the
 * caller before the id is ever used.
 */

export interface ParentRoutesOptions {
  repository: RecordRepository;
}

const parentDraft = z.object({
  fullName: z.string().min(1).max(120),
  relationship: z.string().min(1).max(40),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  city: z.string().min(1).max(80).optional(),
});

const parentPatch = parentDraft.partial();

const parentId = z.object({ parentId: z.string().min(1).max(128) });

const invalid = (message: string) => ({
  code: 'invalid_request' as const,
  message,
  retryable: false,
});

export const parentRoutes: FastifyPluginAsync<ParentRoutesOptions> = async (app, { repository }) => {
  app.get('/v1/parents', { preHandler: app.authenticate }, async (request) => ({
    parents: await repository.listParents(callerOf(request).ownerId),
  }));

  app.post('/v1/parents', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = parentDraft.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalid('Check the parent details.'));

    const now = new Date().toISOString();
    const parent = {
      parentId: `parent_${crypto.randomUUID()}`,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    };

    await repository.putParent(callerOf(request).ownerId, parent);
    return reply.code(201).send({ parent });
  });

  app.get('/v1/parents/:parentId', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = parentId.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(invalid('Provide a parent id.'));

    const parent = await repository.getParent(callerOf(request).ownerId, parsed.data.parentId);
    if (parent === null) return reply.code(404).send(notFound('parent'));

    return reply.send({ parent });
  });

  app.patch('/v1/parents/:parentId', { preHandler: app.authenticate }, async (request, reply) => {
    const params = parentId.safeParse(request.params);
    const body = parentPatch.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send(invalid('Check the parent details.'));
    }

    const ownerId = callerOf(request).ownerId;
    // Read first, so a patch against somebody else's id is a 404 rather than a
    // write that creates a row in their partition.
    const existing = await repository.getParent(ownerId, params.data.parentId);
    if (existing === null) return reply.code(404).send(notFound('parent'));

    // Spread only the fields actually supplied: `partial()` leaves absent keys
    // out, but an explicit `undefined` would blank a stored value.
    const patch = Object.fromEntries(
      Object.entries(body.data).filter(([, value]) => value !== undefined),
    );
    const parent = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await repository.putParent(ownerId, parent);

    return reply.send({ parent });
  });

  app.delete('/v1/parents/:parentId', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = parentId.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(invalid('Provide a parent id.'));

    const ownerId = callerOf(request).ownerId;
    const existing = await repository.getParent(ownerId, parsed.data.parentId);
    if (existing === null) return reply.code(404).send(notFound('parent'));

    /**
     * Refuses while documents remain.
     *
     * The alternative is a cascade that removes somebody's medical records as a
     * side effect of tidying up a profile. Deleting records is its own decision
     * and gets its own confirmation — see P2-16.
     */
    const documents = await repository.listDocumentsForParent(ownerId, parsed.data.parentId);
    if (documents.length > 0) {
      return reply.code(409).send({
        code: 'parent_has_documents',
        message: 'Delete this person’s documents first.',
        retryable: false,
        details: { documentCount: documents.length },
      });
    }

    await repository.deleteParent(ownerId, parsed.data.parentId);
    return reply.code(204).send();
  });
};
