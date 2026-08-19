import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { StackName } from '../config/stack.js';
import type { LocalIssuer } from '../services/identity/localIssuer.js';

/**
 * The development identity provider's HTTP surface.
 *
 * Two routes, mounted under the issuer path so the JWKS document sits exactly
 * where the verifier will look for it:
 *
 *   GET  /local-identity/.well-known/jwks.json
 *   POST /local-identity/token
 *
 * ## This must never be reachable in anything real
 *
 * `POST /token` mints a valid token for whoever asks. On a system holding real
 * records that is not an authentication bypass so much as the absence of
 * authentication. Three things keep it away from one:
 *
 * 1. `createLocalIssuer` throws on the `aws` stack, so the issuer cannot be
 *    constructed to pass in here.
 * 2. This plugin refuses to register on the `aws` stack, so even a caller
 *    holding an issuer cannot mount it.
 * 3. `app.ts` only registers it when the stack is `local`.
 *
 * Three guards for one rule is deliberate. Any single one of them could be
 * removed by somebody refactoring in good faith.
 */

export interface LocalIdentityOptions {
  issuer: LocalIssuer;
  stack: StackName;
}

const tokenRequest = z.object({
  ownerId: z.string().min(1).max(128),
  email: z.string().email().optional(),
  /** Short lifetimes let a test watch a token expire without waiting an hour. */
  lifetimeSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

export const localIdentityRoutes: FastifyPluginAsync<LocalIdentityOptions> = async (
  app,
  options,
) => {
  if (options.stack === 'aws') {
    throw new Error(
      'Refusing to mount the development identity provider on the aws stack. It mints a valid token for anyone who asks.',
    );
  }

  app.get('/local-identity/.well-known/jwks.json', async () => options.issuer.jwks());

  app.post('/local-identity/token', async (request, reply) => {
    const parsed = tokenRequest.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        code: 'invalid_request',
        message: 'Provide an ownerId.',
        retryable: false,
      });
    }

    const { ownerId, email, lifetimeSeconds } = parsed.data;

    // The owner id, because it is not a secret and a developer needs to see
    // which tenant they are acting as. Never the token.
    request.log.info({ ownerId }, 'development token issued');

    return reply.send({
      token: await options.issuer.issueFor({
        ownerId,
        ...(email === undefined ? {} : { email }),
        ...(lifetimeSeconds === undefined ? {} : { lifetimeSeconds }),
      }),
      tokenType: 'Bearer',
    });
  });
};
