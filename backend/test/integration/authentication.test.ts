import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { createTokenVerifier } from '../../src/services/identity/TokenVerifier.js';

/**
 * Authentication through the real server, over real HTTP shapes.
 *
 * `tokenVerifier.test.ts` proves the verifier refuses what it should. This
 * proves the refusal reaches the client as a flat 401, that a caller actually
 * materialises on the request, and that the development identity provider
 * cannot exist anywhere it should not.
 */
/** Swallows log output. Fastify only needs `write`. */
const silent = (): NodeJS.WritableStream =>
  ({ write: () => true }) as unknown as NodeJS.WritableStream;

const stack = loadStackConfig({ AYUNETZ_STACK: 'local' });
const identity = loadIdentityConfig('local', stack.region, {
  AYUNETZ_IDENTITY_ISSUER: 'http://localhost:4000/local-identity',
});

describe('authentication over HTTP', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({ stack, identity, logStream: silent() });

    // A route that exists only to prove the caller reaches a handler.
    app.get(
      '/test/whoami',
      { preHandler: (request, reply) => app.requireCaller(request, reply) },
      async (request) => ({ ownerId: request.caller?.ownerId ?? null }),
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const issueToken = async (body: Record<string, unknown>): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/local-identity/token',
      payload: body,
    });

    return (JSON.parse(response.body) as { token: string }).token;
  };

  describe('the development identity provider', () => {
    it('publishes a JWKS document where the verifier looks for it', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/local-identity/.well-known/jwks.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { keys: Record<string, unknown>[] };
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0]).not.toHaveProperty('d');
    });

    it('issues a token for a named owner', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/local-identity/token',
        payload: { ownerId: 'owner_alice' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ tokenType: 'Bearer' });
    });

    it('refuses a request with no owner', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/local-identity/token',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('does not exist when the stack is aws', async () => {
      const awsStack = loadStackConfig({ AYUNETZ_STACK: 'aws' });
      const awsIdentity = loadIdentityConfig('aws', awsStack.region, {
        AYUNETZ_COGNITO_USER_POOL_ID: 'ap-south-1_ABC123',
      });

      const awsApp = buildApp({
        stack: awsStack,
        identity: awsIdentity,
        logStream: silent(),
      });
      await awsApp.ready();

      const jwks = await awsApp.inject({
        method: 'GET',
        url: '/local-identity/.well-known/jwks.json',
      });
      const token = await awsApp.inject({ method: 'POST', url: '/local-identity/token' });

      expect(jwks.statusCode).toBe(404);
      expect(token.statusCode).toBe(404);

      await awsApp.close();
    });
  });

  describe('a request carrying a valid token', () => {
    it('reaches the handler as a caller', async () => {
      const token = await issueToken({ ownerId: 'owner_alice' });

      const response = await app.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ownerId: 'owner_alice' });
    });

    it('carries the subject the token names, not one the client asks for', async () => {
      const token = await issueToken({ ownerId: 'owner_alice' });

      // A request body claiming to be someone else changes nothing: the handler
      // reads `request.caller`, which only the token can set.
      const response = await app.inject({
        method: 'GET',
        url: '/test/whoami?ownerId=owner_bob',
        headers: { authorization: `Bearer ${token}` },
        payload: { ownerId: 'owner_bob' },
      });

      expect(JSON.parse(response.body)).toEqual({ ownerId: 'owner_alice' });
    });
  });

  describe('a request that should be refused', () => {
    it.each([
      ['no Authorization header', undefined],
      ['an empty header', ''],
      ['Basic auth', 'Basic YWxpY2U6c2VjcmV0'],
      ['a bare token', 'not.a.token'],
      ['Bearer with rubbish after it', 'Bearer not-a-jwt'],
    ])('answers 401 for %s', async (_label, authorization) => {
      const response = await app.inject({
        method: 'GET',
        url: '/test/whoami',
        ...(authorization === undefined ? {} : { headers: { authorization } }),
      });

      expect(response.statusCode).toBe(401);
    });

    it('answers 401 for an expired token', async () => {
      // Clock tolerance is zero on this instance, so a one-second token is
      // genuinely dead a second later. Without that the test would have to
      // either wait out the tolerance or accept both outcomes, and a test that
      // accepts both outcomes asserts nothing.
      const strict = buildApp({
        stack,
        identity: loadIdentityConfig('local', stack.region, {
          AYUNETZ_IDENTITY_ISSUER: identity.issuer,
          AYUNETZ_IDENTITY_CLOCK_TOLERANCE_SECONDS: '0',
        }),
        logStream: silent(),
      });
      strict.get(
        '/test/whoami',
        { preHandler: (request, reply) => strict.requireCaller(request, reply) },
        async () => ({ ok: true }),
      );
      await strict.ready();

      const issued = await strict.inject({
        method: 'POST',
        url: '/local-identity/token',
        payload: { ownerId: 'owner_alice', lifetimeSeconds: 1 },
      });
      const { token } = JSON.parse(issued.body) as { token: string };

      const before = await strict.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(before.statusCode).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 1_500));

      const after = await strict.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(after.statusCode).toBe(401);

      await strict.close();
    });

    it('says nothing about why', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: 'Bearer not-a-jwt' },
      });

      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body).toEqual({
        code: 'unauthorized',
        message: 'Sign in again to continue.',
        retryable: false,
      });
      expect(JSON.stringify(body)).not.toMatch(/signature|issuer|audience|expired|jwt/i);
    });

    it('never echoes the token back', async () => {
      const token = await issueToken({ ownerId: 'owner_alice' });
      const tampered = `${token.slice(0, -4)}AAAA`;

      const response = await app.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: `Bearer ${tampered}` },
      });

      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain(tampered.slice(0, 40));
    });
  });

  /**
   * The first version of this returned 401 whenever the JWKS endpoint could not
   * be reached, because every failure inside verification was treated as a bad
   * token. That tells every user at once that their session has ended and sends
   * them to sign in again, which fails too — the thing that verifies sign-ins is
   * what is down.
   */
  describe('when the identity provider cannot be reached', () => {
    it('answers 503 and says to try again, rather than 401', async () => {
      const unreachable = buildApp({
        stack,
        // Points at a port with nothing on it, and no in-process key source,
        // so verification fails on the fetch rather than on the token.
        identity: loadIdentityConfig('local', stack.region, {
          AYUNETZ_IDENTITY_ISSUER: 'http://127.0.0.1:1/local-identity',
        }),
        verifier: createTokenVerifier(
          loadIdentityConfig('local', stack.region, {
            AYUNETZ_IDENTITY_ISSUER: 'http://127.0.0.1:1/local-identity',
          }),
        ),
        logStream: silent(),
      });
      unreachable.get(
        '/test/whoami',
        { preHandler: (request, reply) => unreachable.requireCaller(request, reply) },
        async () => ({ ok: true }),
      );
      await unreachable.ready();

      const token = await issueToken({ ownerId: 'owner_alice' });

      const response = await unreachable.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toMatchObject({ retryable: true });

      await unreachable.close();
    });
  });

  describe('what reaches the log', () => {
    it('records the reason but never the token', async () => {
      const lines: string[] = [];
      const capturing = buildApp({
        stack,
        identity,
        logStream: {
          write: (chunk: string) => {
            lines.push(chunk);
            return true;
          },
        } as unknown as NodeJS.WritableStream,
      });

      capturing.get(
        '/test/whoami',
        { preHandler: (request, reply) => capturing.requireCaller(request, reply) },
        async () => ({ ok: true }),
      );
      await capturing.ready();

      const token = await issueToken({ ownerId: 'owner_alice' });
      const tampered = `${token.slice(0, -4)}AAAA`;

      await capturing.inject({
        method: 'GET',
        url: '/test/whoami',
        headers: { authorization: `Bearer ${tampered}` },
      });

      const written = lines.join('\n');
      expect(written).toContain('token rejected');
      // A rejected token is still a credential, and a log line is a durable
      // copy of one.
      expect(written).not.toContain(tampered.slice(0, 40));

      await capturing.close();
    });
  });
});
