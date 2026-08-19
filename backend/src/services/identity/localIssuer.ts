import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';

import type { IdentityConfig } from '../../config/identity.js';
import type { StackName } from '../../config/stack.js';

/**
 * A development identity provider, standing in for a Cognito user pool.
 *
 * It exists to prove the thing that actually matters: that the API rejects a
 * token it did not issue, and scopes every query by the subject of one it did.
 * That is verifiable without emulating Cognito, and emulating Cognito is a paid
 * feature of the available emulators — see ADR-003.
 *
 * ## What it deliberately does not do
 *
 * No passwords, no sign-up, no email, no account recovery, no refresh. Those
 * are Cognito's, and a half-built imitation would invite someone to trust it.
 * `issueFor` mints a token for whoever asks, which is exactly why the guards
 * below exist.
 *
 * ## Why the keys live only in memory
 *
 * They are generated per process and never written down. A restart invalidates
 * every token, which is mildly annoying and much better than a signing key
 * sitting in the repository waiting to be copied into something real.
 */

const ALGORITHM = 'RS256';

/** Cognito's ID-token shape, as far as this system reads it. */
export interface LocalIdentity {
  readonly ownerId: string;
  readonly email?: string;
  /** Defaults to an hour, like a Cognito ID token. */
  readonly lifetimeSeconds?: number;
}

export interface LocalIssuer {
  jwks(): Promise<{ keys: JWK[] }>;
  issueFor(identity: LocalIdentity): Promise<string>;
  /** For proving the verifier refuses a token from any other issuer. */
  readonly issuer: string;
}

export class LocalIssuerRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalIssuerRefused';
  }
}

const DEFAULT_LIFETIME_SECONDS = 60 * 60;

export const createLocalIssuer = (
  config: IdentityConfig,
  stack: StackName,
  /** For a test that needs a second, unrelated issuer. */
  options: { keyId?: string } = {},
): LocalIssuer => {
  if (stack === 'aws') {
    // The guard that has to hold. A process talking to real infrastructure must
    // never be able to mint its own tokens: it would authenticate as any tenant
    // it liked, and every isolation control downstream reads the subject of a
    // token it assumes Cognito signed.
    throw new LocalIssuerRefused(
      'Refusing to start a local identity issuer on the aws stack. Tokens come from Cognito.',
    );
  }

  const keyId = options.keyId ?? 'ayunetz-local-key';

  type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

  let material: Promise<KeyPair> | undefined;
  const keys = (): Promise<KeyPair> => {
    material ??= generateKeyPair(ALGORITHM, { extractable: true });
    return material;
  };

  return {
    issuer: config.issuer,

    async jwks() {
      const { publicKey } = await keys();
      const jwk = await exportJWK(publicKey);
      return { keys: [{ ...jwk, kid: keyId, alg: ALGORITHM, use: 'sig' }] };
    },

    async issueFor({ ownerId, email, lifetimeSeconds }) {
      const { privateKey } = await keys();
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiry = issuedAt + (lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS);

      return new SignJWT({
        // Cognito marks what a token is for, and the verifier insists on it.
        token_use: 'id',
        ...(email === undefined ? {} : { email }),
      })
        .setProtectedHeader({ alg: ALGORITHM, kid: keyId })
        .setSubject(ownerId)
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiry)
        .sign(privateKey);
    },
  };
};

/**
 * Keys for verifying what this issuer minted, resolved in process.
 *
 * The alternative — pointing the verifier at our own JWKS URL — makes the
 * service fetch a document from itself over HTTP to check a token it signed a
 * moment earlier. That is a needless dependency on the socket being up, and it
 * is what made the first version of this return 401 for perfectly good tokens
 * whenever nothing was listening.
 *
 * The published endpoint stays, because it mirrors Cognito's shape and because
 * anything else in the local stack may want it.
 */
export const inProcessKeys = (issuer: LocalIssuer): JWTVerifyGetKey => {
  let resolver: Promise<JWTVerifyGetKey> | undefined;

  return async (header, token) => {
    resolver ??= issuer.jwks().then((jwks) => createLocalJWKSet(jwks));
    return (await resolver)(header, token);
  };
};
