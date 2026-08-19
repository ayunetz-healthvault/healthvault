import { z } from 'zod';

import type { StackName } from './stack.js';

/**
 * Who a request belongs to.
 *
 * A local issuer and a Cognito user pool are both JWKS endpoints, so there is
 * one verifier and two configurations — the same story as the other ports. What
 * differs is only where the keys are fetched from and what the issuer is called.
 *
 * ## The claim that matters
 *
 * `sub` becomes the DynamoDB partition key and the S3 key prefix. Everything
 * the repository does to keep tenants apart rests on this value being the one
 * Cognito issued and nothing else — so verification here is the single point
 * where a mistake becomes a cross-tenant read.
 */

const DEFAULT_LOCAL_ISSUER = 'http://localhost:4000/local-identity';

export const identitySchema = z.object({
  /**
   * Overridden only when the local issuer is not on the default port. On `aws`
   * this is derived from the user pool unless set explicitly.
   */
  AYUNETZ_IDENTITY_ISSUER: z.string().url().optional(),

  /**
   * The app client the token was minted for. Cognito puts this in `aud` on an
   * ID token, and a token minted for a different client must not be accepted.
   */
  AYUNETZ_IDENTITY_AUDIENCE: z.string().min(1).default('ayunetz-local-app'),

  /** Cognito user pool id, e.g. `ap-south-1_XXXXXXXXX`. Required on `aws`. */
  AYUNETZ_COGNITO_USER_POOL_ID: z.string().min(1).optional(),

  /**
   * Tolerance for clock difference between the issuer and this service.
   *
   * Small on purpose. A generous skew extends the life of every token past its
   * stated expiry, including one that has been stolen.
   */
  AYUNETZ_IDENTITY_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(120).default(5),
});

export interface IdentityConfig {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly audience: string;
  readonly clockToleranceSeconds: number;
  /**
   * Signing algorithms this service will accept.
   *
   * An allow-list, not a preference. Reading the algorithm out of the token's
   * own header and trusting it is how an attacker gets a token verified with
   * `alg: none`, or gets an RSA public key — which is not secret — accepted as
   * an HMAC key. Both are refused because neither algorithm is on this list.
   */
  readonly algorithms: readonly string[];
}

export class IdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityConfigError';
  }
}

const cognitoIssuer = (region: string, userPoolId: string): string =>
  `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

export const loadIdentityConfig = (
  stack: StackName,
  region: string,
  source: NodeJS.ProcessEnv = process.env,
): IdentityConfig => {
  const env = identitySchema.parse(
    Object.fromEntries(
      Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
    ),
  );

  const issuer =
    env.AYUNETZ_IDENTITY_ISSUER ??
    (stack === 'aws'
      ? env.AYUNETZ_COGNITO_USER_POOL_ID === undefined
        ? undefined
        : cognitoIssuer(region, env.AYUNETZ_COGNITO_USER_POOL_ID)
      : DEFAULT_LOCAL_ISSUER);

  if (issuer === undefined) {
    throw new IdentityConfigError(
      'On the aws stack, set AYUNETZ_COGNITO_USER_POOL_ID or AYUNETZ_IDENTITY_ISSUER. Refusing to start without an issuer to verify against.',
    );
  }

  if (stack === 'aws' && !issuer.startsWith('https://')) {
    // A plaintext JWKS endpoint means anyone on the path chooses the keys that
    // verify tokens, which is the whole of authentication.
    throw new IdentityConfigError(`The identity issuer must be https on the aws stack: ${issuer}`);
  }

  return Object.freeze({
    issuer,
    jwksUri: `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`,
    audience: env.AYUNETZ_IDENTITY_AUDIENCE,
    clockToleranceSeconds: env.AYUNETZ_IDENTITY_CLOCK_TOLERANCE_SECONDS,
    algorithms: Object.freeze(['RS256']),
  });
};

/** Safe to log at startup. Contains no key material and no token. */
export const describeIdentity = (config: IdentityConfig): Record<string, string | number> => ({
  issuer: config.issuer,
  audience: config.audience,
  algorithms: config.algorithms.join(','),
  clockToleranceSeconds: config.clockToleranceSeconds,
});
