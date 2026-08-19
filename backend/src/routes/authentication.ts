import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  TokenRejected,
  type Caller,
  type TokenVerifier,
} from '../services/identity/TokenVerifier.js';

/**
 * Turns a bearer token into `request.caller`, or refuses the request.
 *
 * Registered as a plugin rather than a per-route hook so there is one place
 * where a caller comes into existence. Every handler downstream reads
 * `request.caller.ownerId` and never a body field, which is what makes tenant
 * scoping a property of the request rather than a thing each handler remembers.
 */

export interface AuthenticationOptions {
  verifier: TokenVerifier;
}

/**
 * What a rejected caller is told: nothing.
 *
 * Whether the token expired, was signed by the wrong key, or was minted for
 * another app client is useful to an attacker refining a forgery and useless to
 * a legitimate client, which can only do one thing about a 401 either way. The
 * reason is logged, not returned.
 */
const UNAUTHORIZED_BODY = {
  code: 'unauthorized',
  message: 'Sign in again to continue.',
  retryable: false,
} as const;

const plugin: FastifyPluginAsync<AuthenticationOptions> = async (app, options) => {
  app.decorateRequest('caller', null);

  app.decorate(
    'requireCaller',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        request.caller = await options.verifier.fromAuthorizationHeader(
          request.headers.authorization,
        );
      } catch (error) {
        if (error instanceof TokenRejected) {
          // The reason, and never the token. A rejected token is still a
          // credential, and a log line is a durable copy of one.
          request.log.warn({ reason: error.reason }, 'token rejected');
          await reply.code(401).send(UNAUTHORIZED_BODY);
          return;
        }

        // A JWKS fetch failing is an outage, not a bad credential. Saying 401
        // would tell every user their session had ended and send them to sign
        // in again, which will not work either.
        request.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'identity provider unreachable',
        );
        await reply.code(503).send({
          code: 'identity_unavailable',
          message: 'Sign-in is temporarily unavailable. Try again shortly.',
          retryable: true,
        });
      }
    },
  );
};

export const authentication = fp(plugin, { name: 'authentication' });

declare module 'fastify' {
  interface FastifyInstance {
    requireCaller: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /**
     * Set by `requireCaller`. Non-null inside any route that runs it as a
     * preHandler, and never populated from anything the client sent beyond the
     * signed token itself.
     */
    caller: Caller | null;
  }
}
