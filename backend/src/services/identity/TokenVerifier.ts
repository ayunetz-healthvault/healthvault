import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import type { IdentityConfig } from '../../config/identity.js';

/**
 * Turns a bearer token into the tenant it belongs to, or refuses.
 *
 * One implementation for both stacks: the local issuer and a Cognito user pool
 * are both JWKS endpoints, so only the issuer URL and key source differ.
 *
 * ## Why this file is written defensively
 *
 * Everything keeping one family's medical records away from another's rests on
 * `sub` being the value the issuer put there. A verifier that is merely
 * *usually* right is a cross-tenant read waiting for the right token, so each
 * check below is explicit rather than left to a library default that might
 * change.
 */

/** A verified caller. Nothing here came from the request body. */
export interface Caller {
  /** The token subject. The tenant key everywhere else in the system. */
  readonly ownerId: string;
  readonly email: string | undefined;
  /** When this token stops being valid, for the caller's own logging. */
  readonly expiresAt: Date;
}

export type TokenRejectionReason =
  | 'missing'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'wrong_token_use'
  | 'no_subject';

/**
 * The identity provider could not be reached.
 *
 * Deliberately not a `TokenRejected`. Answering 401 when the JWKS endpoint is
 * down tells every user at once that their session has ended and sends them to
 * sign in again — which will also fail, because the thing that verifies
 * sign-ins is what is broken. An outage is a 503.
 */
export class IdentityUnavailable extends Error {
  constructor(cause: unknown) {
    super('The identity provider could not be reached.');
    this.name = 'IdentityUnavailable';
    this.cause = cause;
  }
}

export class TokenRejected extends Error {
  readonly reason: TokenRejectionReason;

  constructor(reason: TokenRejectionReason, message: string) {
    super(message);
    this.name = 'TokenRejected';
    this.reason = reason;
  }
}

export interface TokenVerifier {
  verify(token: string): Promise<Caller>;
  /** Pulls the token out of an `Authorization` header, or refuses. */
  fromAuthorizationHeader(header: string | undefined): Promise<Caller>;
}

/**
 * Cognito marks what a token is for. An access token and an ID token are both
 * validly signed by the same pool, so accepting either where one was meant
 * would take a token issued for a different purpose.
 *
 * The API is specified as taking the ID token — see `endpoints.ts`.
 */
const REQUIRED_TOKEN_USE = 'id';

const BEARER = /^Bearer (.+)$/;

/**
 * Maps a `jose` failure onto our own reasons.
 *
 * The reason is for logs and metrics only. What goes back to the caller is a
 * flat 401: telling someone whether a token failed on its signature or its
 * expiry tells an attacker which half of their forgery is working.
 */
/**
 * True when the failure is about the token rather than about our ability to
 * check it.
 *
 * `jose` codes all begin `ERR_J`. Anything else — a DNS failure, a refused
 * connection, a timeout fetching the JWKS — is an outage, and the timeout code
 * is listed with them because it means the same thing.
 */
const isTokenProblem = (error: unknown): boolean => {
  const code = (error as { code?: string }).code;
  if (typeof code !== 'string') return false;
  if (code === 'ERR_JWKS_TIMEOUT') return false;
  return code.startsWith('ERR_J');
};

const reasonFor = (error: unknown): TokenRejectionReason => {
  const code = (error as { code?: string }).code;

  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      const claim = (error as { claim?: string }).claim;
      if (claim === 'iss') return 'wrong_issuer';
      if (claim === 'aud') return 'wrong_audience';
      return 'malformed';
    }
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return 'bad_signature';
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      // `alg: none`, or an HMAC algorithm offered so a public key gets used as
      // a shared secret. Both are forgery attempts, not malformed input.
      return 'bad_signature';
    default:
      return 'malformed';
  }
};

export const createTokenVerifier = (
  config: IdentityConfig,
  /** Injected in tests so verification can be exercised without a server. */
  keySource?: Parameters<typeof jwtVerify>[1],
): TokenVerifier => {
  const keys = keySource ?? createRemoteJWKSet(new URL(config.jwksUri));

  const verify = async (token: string): Promise<Caller> => {
    if (token.trim() === '') {
      throw new TokenRejected('missing', 'No token supplied.');
    }

    let payload: JWTPayload;

    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.audience,
        // The allow-list. Without it the token's own header chooses the
        // algorithm, which is how `alg: none` and RSA-key-as-HMAC-secret work.
        algorithms: [...config.algorithms],
        clockTolerance: config.clockToleranceSeconds,
      }));
    } catch (error) {
      if (!isTokenProblem(error)) throw new IdentityUnavailable(error);
      throw new TokenRejected(reasonFor(error), 'The token was not accepted.');
    }

    if (payload.token_use !== REQUIRED_TOKEN_USE) {
      throw new TokenRejected(
        'wrong_token_use',
        `Expected a ${REQUIRED_TOKEN_USE} token, not ${String(payload.token_use)}.`,
      );
    }

    if (typeof payload.sub !== 'string' || payload.sub.trim() === '') {
      // Every key in the system is built from this. A token without one cannot
      // be scoped to anybody, so there is nothing safe to do with it.
      throw new TokenRejected('no_subject', 'The token carries no subject.');
    }

    if (payload.exp === undefined) {
      // `jose` only enforces expiry when the claim is present, so a token
      // without one never expires. Refuse rather than mint an eternal session.
      throw new TokenRejected('malformed', 'The token has no expiry.');
    }

    return {
      ownerId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      expiresAt: new Date(payload.exp * 1000),
    };
  };

  return {
    verify,

    async fromAuthorizationHeader(header) {
      if (header === undefined || header.trim() === '') {
        throw new TokenRejected('missing', 'No Authorization header.');
      }

      const match = BEARER.exec(header.trim());
      if (match?.[1] === undefined) {
        throw new TokenRejected('malformed', 'Authorization header is not a Bearer token.');
      }

      return verify(match[1]);
    },
  };
};
