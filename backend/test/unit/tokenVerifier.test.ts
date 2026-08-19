import {
  SignJWT,
  base64url,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadIdentityConfig, IdentityConfigError } from '../../src/config/identity.js';
import { createLocalIssuer, LocalIssuerRefused } from '../../src/services/identity/localIssuer.js';
import {
  createTokenVerifier,
  TokenRejected,
  type TokenVerifier,
} from '../../src/services/identity/TokenVerifier.js';

/**
 * The subject of a verified token becomes the DynamoDB partition key and the S3
 * key prefix. Everything keeping one family's medical records away from
 * another's rests on this file being right, so it is tested as an attacker
 * would probe it rather than only along the happy path.
 */
const config = loadIdentityConfig('local', 'ap-south-1', {
  AYUNETZ_IDENTITY_ISSUER: 'http://localhost:4000/local-identity',
  AYUNETZ_IDENTITY_AUDIENCE: 'ayunetz-local-app',
});

const issuer = createLocalIssuer(config, 'local');

/** Verifies against the issuer's own keys, with no network. */
const verifierFor = async (): Promise<TokenVerifier> =>
  createTokenVerifier(config, createLocalJWKSet(await issuer.jwks()));

/**
 * A key the verifier genuinely trusts, for tests about *claims*.
 *
 * Signing those with an unrelated key would make them pass on the signature
 * check instead of the claim they name — a green test proving nothing. Here the
 * signature is always valid, so the only thing that can fail is the claim.
 */
const trusted = await (async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const verifier = createTokenVerifier(
    config,
    createLocalJWKSet({ keys: [{ ...jwk, kid: 'trusted-key', alg: 'RS256', use: 'sig' }] }),
  );

  const sign = (
    claims: Record<string, unknown>,
    expiresAt: number,
    overrides: { issuer?: string; audience?: string } = {},
  ): Promise<string> =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
      .setIssuer(overrides.issuer ?? config.issuer)
      .setAudience(overrides.audience ?? config.audience)
      .setExpirationTime(expiresAt)
      .sign(privateKey);

  return { verifier, sign };
})();

/** An expiry comfortably in the future, so no claim test races the clock. */
const soon = (): number => Math.floor(Date.now() / 1000) + 600;

describe('the token verifier', () => {
  let verifier: TokenVerifier;

  beforeAll(async () => {
    verifier = await verifierFor();
  });

  describe('a token this system issued', () => {
    it('yields the subject as the tenant', async () => {
      const token = await issuer.issueFor({ ownerId: 'owner_alice' });

      expect((await verifier.verify(token)).ownerId).toBe('owner_alice');
    });

    it('carries the email through when there is one', async () => {
      const token = await issuer.issueFor({ ownerId: 'owner_alice', email: 'a@example.com' });

      expect((await verifier.verify(token)).email).toBe('a@example.com');
    });

    it('reports when the token stops being valid', async () => {
      const token = await issuer.issueFor({ ownerId: 'owner_alice', lifetimeSeconds: 600 });

      const { expiresAt } = await verifier.verify(token);
      const secondsAway = (expiresAt.getTime() - Date.now()) / 1000;
      expect(secondsAway).toBeGreaterThan(500);
      expect(secondsAway).toBeLessThan(700);
    });
  });

  describe('forgery', () => {
    it('refuses a token signed by a different key', async () => {
      const other = createLocalIssuer(config, 'local', { keyId: 'someone-elses-key' });
      const token = await other.issueFor({ ownerId: 'owner_alice' });

      await expect(verifier.verify(token)).rejects.toMatchObject({ reason: 'bad_signature' });
    });

    /**
     * The classic. Strip the signature, set `alg` to `none`, and a verifier that
     * reads the algorithm out of the token accepts anything the attacker wrote.
     */
    it('refuses alg: none', async () => {
      const header = base64url.encode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payload = base64url.encode(
        JSON.stringify({
          sub: 'owner_victim',
          iss: config.issuer,
          aud: config.audience,
          token_use: 'id',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      );

      await expect(verifier.verify(`${header}.${payload}.`)).rejects.toBeInstanceOf(TokenRejected);
    });

    /**
     * Algorithm confusion. The RSA public key is published at the JWKS endpoint
     * and is not a secret; a verifier that accepts HS256 can be handed a token
     * signed with that public key used as an HMAC shared secret.
     */
    it('refuses an HMAC token signed with the public key as the secret', async () => {
      const jwks = await issuer.jwks();
      const publicJwk = jwks.keys[0]!;
      const secret = new TextEncoder().encode(JSON.stringify(publicJwk));

      const token = await new SignJWT({ token_use: 'id' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('owner_victim')
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setExpirationTime('1h')
        .sign(secret);

      await expect(verifier.verify(token)).rejects.toBeInstanceOf(TokenRejected);
    });

    /**
     * The test above and the `alg: none` one both pass even with the algorithm
     * allow-list removed — an RSA key set will not resolve a key for HS256 or
     * for `none`, so `jose` refuses them anyway. That was found by deleting the
     * allow-list and watching every test stay green.
     *
     * This one fails without it. The key source here hands back whatever key the
     * token's header asks for, which is what a permissive or future resolver
     * looks like; the only thing left refusing the token is the allow-list. It
     * is the difference between "our library happens to stop this" and "we stop
     * this".
     */
    it('refuses HS256 even when the key source would happily supply the secret', async () => {
      const secret = new TextEncoder().encode('x'.repeat(32));
      const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });

      const permissive: JWTVerifyGetKey = async (header) =>
        header.alg === 'HS256' ? secret : publicKey;

      const permissiveVerifier = createTokenVerifier(config, permissive);

      const forged = await new SignJWT({ sub: 'owner_victim', token_use: 'id' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setExpirationTime(soon())
        .sign(secret);

      await expect(permissiveVerifier.verify(forged)).rejects.toMatchObject({
        reason: 'bad_signature',
      });

      // Proof the key source really would have worked: the same resolver
      // accepts a properly signed RS256 token.
      const honest = await new SignJWT({ sub: 'owner_alice', token_use: 'id' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setExpirationTime(soon())
        .sign(privateKey);

      expect((await permissiveVerifier.verify(honest)).ownerId).toBe('owner_alice');
    });

    it('refuses a token whose payload was edited after signing', async () => {
      const token = await issuer.issueFor({ ownerId: 'owner_alice' });
      const [header, payload, signature] = token.split('.');

      const decoded = JSON.parse(new TextDecoder().decode(base64url.decode(payload!))) as Record<
        string,
        unknown
      >;
      decoded.sub = 'owner_bob';
      const tampered = base64url.encode(JSON.stringify(decoded));

      await expect(
        verifier.verify(`${header}.${tampered}.${signature}`),
      ).rejects.toMatchObject({ reason: 'bad_signature' });
    });
  });

  describe('claims', () => {
    it('refuses an expired token', async () => {
      const expired = await trusted.sign(
        { sub: 'owner_alice', token_use: 'id' },
        Math.floor(Date.now() / 1000) - 60,
      );

      await expect(trusted.verifier.verify(expired)).rejects.toMatchObject({ reason: 'expired' });
    });

    it('accepts the same token while it is still valid, so expiry is the only difference', async () => {
      const live = await trusted.sign(
        { sub: 'owner_alice', token_use: 'id' },
        soon(),
      );

      expect((await trusted.verifier.verify(live)).ownerId).toBe('owner_alice');
    });

    it('refuses a token from another issuer', async () => {
      // Correctly signed by a key this verifier trusts. Only `iss` is wrong —
      // which is the case that matters, because a token from a pool we do not
      // control must not become a tenant here.
      const token = await trusted.sign({ sub: 'owner_alice', token_use: 'id' }, soon(), {
        issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/some-other-pool',
      });

      await expect(trusted.verifier.verify(token)).rejects.toMatchObject({
        reason: 'wrong_issuer',
      });
    });

    it('refuses a token minted for a different app client', async () => {
      const token = await trusted.sign({ sub: 'owner_alice', token_use: 'id' }, soon(), {
        audience: 'some-other-app',
      });

      await expect(trusted.verifier.verify(token)).rejects.toMatchObject({
        reason: 'wrong_audience',
      });
    });

    it('refuses an access token where an ID token is required', async () => {
      // Same key, same issuer, same audience, unexpired. Only `token_use`
      // differs from the token accepted above, so that is the only thing that
      // can be rejecting it.
      const accessToken = await trusted.sign({ sub: 'owner_alice', token_use: 'access' }, soon());

      await expect(trusted.verifier.verify(accessToken)).rejects.toMatchObject({
        reason: 'wrong_token_use',
      });
    });

    it('refuses a token carrying no subject, since nothing could be scoped to it', async () => {
      const noSubject = await trusted.sign({ token_use: 'id' }, soon());

      await expect(trusted.verifier.verify(noSubject)).rejects.toMatchObject({
        reason: 'no_subject',
      });
    });
  });

  describe('the Authorization header', () => {
    it('accepts a well-formed Bearer token', async () => {
      const token = await issuer.issueFor({ ownerId: 'owner_alice' });

      expect((await verifier.fromAuthorizationHeader(`Bearer ${token}`)).ownerId).toBe(
        'owner_alice',
      );
    });

    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['not a bearer token', 'Basic abc123'],
      ['bearer with nothing after it', 'Bearer '],
      ['a bare token with no scheme', 'abc.def.ghi'],
    ])('refuses a header that is %s', async (_label, header) => {
      await expect(verifier.fromAuthorizationHeader(header)).rejects.toBeInstanceOf(TokenRejected);
    });
  });

  describe('what a refusal tells the caller', () => {
    it('says nothing about which check failed', async () => {
      const other = createLocalIssuer(config, 'local', { keyId: 'someone-elses-key' });
      const token = await other.issueFor({ ownerId: 'owner_alice' });

      // The reason is kept for logs and metrics; the message is flat, because
      // telling someone which half of their forgery worked helps them finish it.
      const error: TokenRejected = await verifier.verify(token).then(
        () => {
          throw new Error('expected the token to be rejected');
        },
        (caught: unknown) => caught as TokenRejected,
      );

      expect(error.reason).toBe('bad_signature');
      expect(error.message).toBe('The token was not accepted.');
      expect(error.message).not.toMatch(/signature|issuer|audience|expired/i);
    });
  });
});

describe('identity configuration', () => {
  it('refuses to start on aws without an issuer to verify against', () => {
    expect(() => loadIdentityConfig('aws', 'ap-south-1', {})).toThrow(IdentityConfigError);
  });

  it('derives the Cognito issuer from the user pool', () => {
    const derived = loadIdentityConfig('aws', 'ap-south-1', {
      AYUNETZ_COGNITO_USER_POOL_ID: 'ap-south-1_ABC123',
    });

    expect(derived.issuer).toBe('https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_ABC123');
    expect(derived.jwksUri).toBe(
      'https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_ABC123/.well-known/jwks.json',
    );
  });

  it('refuses a plaintext issuer on aws, where anyone on the path picks the keys', () => {
    expect(() =>
      loadIdentityConfig('aws', 'ap-south-1', {
        AYUNETZ_IDENTITY_ISSUER: 'http://cognito-idp.ap-south-1.amazonaws.com/pool',
      }),
    ).toThrow(/https/i);
  });

  it('allows only RS256, so the token cannot choose its own algorithm', () => {
    expect([...config.algorithms]).toEqual(['RS256']);
  });

  it('keeps clock tolerance tight, so expiry means expiry', () => {
    expect(config.clockToleranceSeconds).toBeLessThanOrEqual(10);
  });

  it('logs no key material at startup', () => {
    const described = JSON.stringify(config);
    expect(described).not.toMatch(/PRIVATE KEY|"d":/);
  });
});

describe('the local issuer', () => {
  it('refuses to exist on the aws stack, where tokens come from Cognito', () => {
    expect(() => createLocalIssuer(config, 'aws')).toThrow(LocalIssuerRefused);
  });

  it('publishes only a public key', async () => {
    const jwks = await issuer.jwks();

    expect(jwks.keys).toHaveLength(1);
    // `d` is the RSA private exponent. Its presence would mean the signing key
    // is being served to anyone who asks for the JWKS document.
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(jwks.keys[0]?.alg).toBe('RS256');
  });

  it('mints tokens that expire', async () => {
    const token = await issuer.issueFor({ ownerId: 'owner_alice' });
    const payload = JSON.parse(
      new TextDecoder().decode(base64url.decode(token.split('.')[1]!)),
    ) as { exp?: number };

    expect(payload.exp).toBeTypeOf('number');
  });
});
