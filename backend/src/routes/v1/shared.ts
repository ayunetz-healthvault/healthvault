import type { FastifyRequest } from 'fastify';

import type { Caller } from '../../services/identity/TokenVerifier.js';

/**
 * The caller, as a non-null value.
 *
 * `request.caller` is typed nullable because it is null until `authenticate`
 * runs. Inside a handler that declares `preHandler: app.authenticate` it is
 * always set, and the `/v1` guard in `authentication.ts` refuses to boot if a
 * route forgot to declare it — so reaching a handler with no caller means those
 * guards were bypassed, and throwing is the only safe answer.
 *
 * Handlers use this instead of `request.caller!` so the invariant is stated
 * once, in a place that explains itself, rather than as a non-null assertion
 * repeated at every call site.
 */
export const callerOf = (request: FastifyRequest): Caller => {
  if (request.caller === null) {
    throw new Error('Reached an authenticated handler with no caller. Authentication was skipped.');
  }
  return request.caller;
};

/**
 * What a caller is told about something that is not theirs.
 *
 * The same 404 as something that does not exist. Distinguishing "no such
 * document" from "not your document" turns any endpoint taking an id into a way
 * to test whether a given id exists in somebody else's records.
 */
export const notFound = (what: string) => ({
  code: 'not_found' as const,
  message: `No such ${what}.`,
  retryable: false,
});

/**
 * What a caller is told about a record that is being erased.
 *
 * A record in the middle of a deletion accepts no new rows. Refusing with a
 * body rather than letting the write through is the difference between an
 * erasure that finishes and one that races an upload it never sees: the sweep
 * has already passed that key, so a document written now survives a deletion
 * that reports success.
 *
 * `retryable: false` on purpose. This is not a busy server; the record is going
 * away, and a client that retried would be waiting for a state that will never
 * come back.
 */
export const beingDeleted = () => ({
  code: 'record_deleting' as const,
  message: 'This record is being deleted, so nothing more can be added to it.',
  retryable: false,
});
