import { AuthError } from './authErrors';

import { config } from '@/config/env';

/**
 * Amazon Cognito user pools, over their public JSON API.
 *
 * Deliberately dependency-free, in the same spirit as `api/client.ts`. The
 * `AWSCognitoIdentityProviderService` target protocol is a documented, stable
 * JSON-over-HTTPS interface; wrapping the eight operations this app needs is
 * less code than the SDK's own configuration surface, and it keeps the mobile
 * bundle from carrying an AWS SDK to do what `fetch` already does.
 *
 * ## The authentication flow, and why it is this one
 *
 * `USER_PASSWORD_AUTH`. The password goes to Cognito over TLS, which is what
 * every hosted sign-in form does.
 *
 * `USER_SRP_AUTH` would be better — it proves knowledge of the password without
 * sending it, so a compromised endpoint learns nothing. It is not used here
 * because implementing SRP means hand-writing modular exponentiation over a
 * 3072-bit group plus Cognito's own key derivation, and hand-written crypto in
 * an app holding medical records is a worse risk than a password crossing a
 * verified TLS connection to its own identity provider.
 *
 * The right way to get SRP is `amazon-cognito-identity-js`, which implements it
 * properly. That is a dependency worth adding when there is a user pool to test
 * it against; adding it now would mean shipping an unexercised auth path. See
 * ADR-004.
 *
 * ## What is not here
 *
 * No client secret. A secret in a mobile bundle is not a secret — it ships to
 * every device and can be read out of the APK — so the app client must be
 * created as a **public** client. `assertNoClientSecret` makes that a startup
 * failure rather than a review comment.
 */

/** Operations this app uses. The target header is `<service>.<operation>`. */
type Operation =
  | 'SignUp'
  | 'ConfirmSignUp'
  | 'ResendConfirmationCode'
  | 'InitiateAuth'
  | 'ForgotPassword'
  | 'ConfirmForgotPassword'
  | 'GlobalSignOut'
  | 'GetUser';

export interface CognitoTokens {
  readonly idToken: string;
  readonly accessToken: string;
  /** Absent on a refresh: Cognito does not reissue the refresh token. */
  readonly refreshToken: string | null;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

interface AuthenticationResult {
  IdToken?: string;
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

/**
 * Cognito error codes, mapped to what the user can actually do about them.
 *
 * Left un-mapped, every one of these reaches the screen as "An error occurred",
 * which for `UserNotConfirmedException` — the single most common failure, and
 * one the user fixes by opening their email — is actively unhelpful.
 */
const ERROR_CODES: Record<string, { code: AuthError['code']; message: string }> = {
  NotAuthorizedException: {
    code: 'invalid_credentials',
    message: 'That email or password is not right.',
  },
  UserNotFoundException: {
    code: 'invalid_credentials',
    message: 'That email or password is not right.',
  },
  UserNotConfirmedException: {
    code: 'not_confirmed',
    message: 'Confirm your email address first. We can send the code again.',
  },
  CodeMismatchException: {
    code: 'invalid_code',
    message: 'That code is not right. Check it and try again.',
  },
  ExpiredCodeException: {
    code: 'invalid_code',
    message: 'That code has expired. Ask for a new one.',
  },
  UsernameExistsException: {
    code: 'already_registered',
    message: 'There is already an account with that email. Try signing in.',
  },
  InvalidPasswordException: {
    code: 'invalid_input',
    message: 'Choose a longer password with a mix of letters and numbers.',
  },
  InvalidParameterException: {
    code: 'invalid_input',
    message: 'Check the details you entered.',
  },
  LimitExceededException: {
    code: 'rate_limited',
    message: 'Too many attempts. Wait a few minutes and try again.',
  },
  TooManyRequestsException: {
    code: 'rate_limited',
    message: 'Too many attempts. Wait a few minutes and try again.',
  },
  TooManyFailedAttemptsException: {
    code: 'rate_limited',
    message: 'Too many attempts. Wait a few minutes and try again.',
  },
  PasswordResetRequiredException: {
    code: 'reset_required',
    message: 'Your password must be reset before you can sign in.',
  },
};

/** Cognito reports the code in `__type`, sometimes prefixed with a namespace. */
const codeFrom = (payload: unknown): string => {
  if (payload === null || typeof payload !== 'object') return '';
  const { __type: type } = payload as { __type?: unknown };
  return typeof type === 'string' ? (type.split('#').pop() ?? '') : '';
};

/**
 * Never the raw provider message.
 *
 * Cognito echoes the username in several of them, and an error string is the
 * one part of a failed request most likely to end up in a log or a crash
 * report. Unknown codes get a fixed sentence.
 */
const errorFor = (payload: unknown, status: number): AuthError => {
  const known = ERROR_CODES[codeFrom(payload)];
  if (known) return new AuthError(known.code, known.message);
  if (status >= 500) {
    return new AuthError('unavailable', 'Sign-in is temporarily unavailable. Try again shortly.');
  }
  return new AuthError('unknown', 'We could not complete that. Please try again.');
};

const endpointFor = (region: string): string => `https://cognito-idp.${region}.amazonaws.com/`;

/**
 * Refuses to run with a client secret configured.
 *
 * A confidential client requires a `SECRET_HASH` on every call, so the secret
 * would have to be in the bundle — where it is readable by anyone with the app.
 * Failing loudly is the only safe response; silently omitting the hash would
 * just produce an unexplained `NotAuthorizedException` on every sign-in.
 */
export const assertNoClientSecret = (): void => {
  if (process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_SECRET) {
    throw new AuthError(
      'misconfigured',
      'The Cognito app client is configured with a secret. Mobile clients must be public.',
    );
  }
};

export interface CognitoConfig {
  readonly region: string;
  readonly userPoolId: string;
  readonly appClientId: string;
}

/** The configuration, or null when this build has no user pool. */
export const cognitoConfig = (): CognitoConfig | null => {
  const { userPoolId, appClientId } = config.cognito;
  if (userPoolId.length === 0 || appClientId.length === 0) return null;
  return { region: config.aws.region, userPoolId, appClientId };
};

const call = async (
  operation: Operation,
  body: Record<string, unknown>,
  { region }: CognitoConfig,
): Promise<Record<string, unknown>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.api.timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpointFor(region), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw error instanceof Error && error.name === 'AbortError'
      ? new AuthError('unavailable', 'That took too long. Check your connection and try again.')
      : new AuthError('unavailable', 'We could not reach the sign-in service.');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) throw errorFor(payload, response.status);
  return payload as Record<string, unknown>;
};

const tokensFrom = (payload: Record<string, unknown>): CognitoTokens => {
  const result = payload.AuthenticationResult as AuthenticationResult | undefined;

  if (!result?.IdToken || !result.AccessToken) {
    // A challenge (MFA, forced password change) rather than a session. The app
    // does not implement challenges yet, and pretending this is a signed-in
    // user would leave someone holding no usable token.
    throw new AuthError(
      'challenge_required',
      'This account needs an extra step to sign in that the app does not support yet.',
    );
  }

  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? null,
    // Cognito states the lifetime; recomputing from the token's own `exp` would
    // read an unverified claim, so the response is the source.
    expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
  };
};

export const cognitoClient = {
  async signUp(
    cfg: CognitoConfig,
    input: { email: string; password: string; fullName: string; location: string },
  ): Promise<{ confirmed: boolean }> {
    assertNoClientSecret();
    const payload = await call(
      'SignUp',
      {
        ClientId: cfg.appClientId,
        Username: input.email,
        Password: input.password,
        UserAttributes: [
          { Name: 'email', Value: input.email },
          { Name: 'name', Value: input.fullName },
          ...(input.location ? [{ Name: 'locale', Value: input.location }] : []),
        ],
      },
      cfg,
    );
    return { confirmed: payload.UserConfirmed === true };
  },

  async confirmSignUp(cfg: CognitoConfig, email: string, code: string): Promise<void> {
    assertNoClientSecret();
    await call(
      'ConfirmSignUp',
      { ClientId: cfg.appClientId, Username: email, ConfirmationCode: code },
      cfg,
    );
  },

  async resendConfirmationCode(cfg: CognitoConfig, email: string): Promise<void> {
    assertNoClientSecret();
    await call('ResendConfirmationCode', { ClientId: cfg.appClientId, Username: email }, cfg);
  },

  async signIn(cfg: CognitoConfig, email: string, password: string): Promise<CognitoTokens> {
    assertNoClientSecret();
    const payload = await call(
      'InitiateAuth',
      {
        ClientId: cfg.appClientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      },
      cfg,
    );
    return tokensFrom(payload);
  },

  /**
   * Exchanges a refresh token for a new ID token.
   *
   * The response carries no refresh token — Cognito keeps the original valid
   * for the pool's configured lifetime — so the caller must keep the one it
   * has rather than expecting a replacement.
   */
  async refresh(cfg: CognitoConfig, refreshToken: string): Promise<CognitoTokens> {
    assertNoClientSecret();
    const payload = await call(
      'InitiateAuth',
      {
        ClientId: cfg.appClientId,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      },
      cfg,
    );
    return tokensFrom(payload);
  },

  async forgotPassword(cfg: CognitoConfig, email: string): Promise<void> {
    assertNoClientSecret();
    await call('ForgotPassword', { ClientId: cfg.appClientId, Username: email }, cfg);
  },

  async confirmForgotPassword(
    cfg: CognitoConfig,
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    assertNoClientSecret();
    await call(
      'ConfirmForgotPassword',
      {
        ClientId: cfg.appClientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      },
      cfg,
    );
  },

  /**
   * Revokes every refresh token for the user, on the server.
   *
   * Dropping the tokens from the device is not sign-out: the refresh token
   * stays valid for the pool's lifetime and anyone who extracted it keeps a
   * working session. This is the call that actually ends it.
   */
  async globalSignOut(cfg: CognitoConfig, accessToken: string): Promise<void> {
    await call('GlobalSignOut', { AccessToken: accessToken }, cfg);
  },
};
