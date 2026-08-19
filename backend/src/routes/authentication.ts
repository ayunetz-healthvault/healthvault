import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

/**
 * Paths under `/v1` that are deliberately public.
 *
 * An allow-list rather than a convention, so making a route public is a visible
 * edit to this file that a reviewer will see.
 */
const PUBLIC_V1_ROUTES = new Set<string>([]);

/**
 * Refuses to boot if a `/v1` route was registered without authentication.
 *
 * Forgetting a `preHandler` is the easiest possible mistake here, it looks
 * exactly like working code, and the thing it exposes is one family's medical
 * records to anyone who can guess a URL. A convention that every handler
 * remembers is not good enough; this makes it a startup failure instead.
 *
 * Applied **synchronously**, not as a plugin. An `onRoute` hook only sees
 * routes registered after it is added, and a plugin's body does not run until
 * `ready()` — so a route added straight onto the root instance would be
 * registered first and slip past. That is not how the real routes are added,
 * which is why it took a deliberately awkward test to notice.
 */
export const guardV1Authentication = (app: FastifyInstance): void => {
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/v1/') && route.url !== '/v1') return;
    if (PUBLIC_V1_ROUTES.has(route.url)) return;
    // HEAD is registered automatically alongside GET and inherits its handlers.
    if (route.method === 'HEAD') return;

    const preHandlers = [route.preHandler].flat().filter(Boolean);
    const authenticated = preHandlers.some(
      (handler) => (handler as { isAyunetzAuth?: boolean }).isAyunetzAuth === true,
    );

    if (!authenticated) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} has no authentication. Add { preHandler: app.authenticate } or list it in PUBLIC_V1_ROUTES.`,
      );
    }
  });
};

/**
 * Installs authentication, synchronously.
 *
 * Not a plugin. A plugin's body does not run until `ready()`, which would mean
 * `app.authenticate` did not exist while routes were being declared and the
 * route guard below had not been installed when the first route registered.
 * Both need to be true before anything else happens, so both happen here.
 */
export const installAuthentication = (app: FastifyInstance, options: AuthenticationOptions): void => {
  app.decorateRequest('caller', null);

  /**
   * Marked so the `/v1` guard can recognise it on a registered route. A plain
   * function reference would work until somebody wraps it in an arrow, which is
   * exactly the sort of harmless-looking edit that would silently disable the
   * check.
   */
  const authenticate = Object.assign(
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
    { isAyunetzAuth: true as const },
  );

  app.decorate('authenticate', authenticate);
  // Kept as the older name so existing call sites and tests still read well.
  app.decorate('requireCaller', authenticate);

  guardV1Authentication(app);
};




declare module 'fastify' {
  interface FastifyInstance {
    /** Use this as a route's `preHandler`. The `/v1` guard looks for it. */
    authenticate: ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) & {
      isAyunetzAuth: true;
    };
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
