import { AuthError } from './authErrors';
import {
  cognitoClient,
  cognitoConfig,
  type CognitoConfig,
  type CognitoTokens,
} from './cognitoClient';
import { setTokenProvider } from '../api/client';
import { SECURE_KEYS, secureStorage } from '../storage/secureStorage';

import { isBackendEnabled, isDemoBuild } from '@/config/env';
import type { AuthUser } from '@/types/domain';
import { nowIso } from '@/utils/date';
import { createId } from '@/utils/id';
import { isValidEmail } from '@/utils/validation';

export { AuthError, type AuthErrorCode } from './authErrors';

/**
 * Authentication.
 *
 * Two modes, and no path between them:
 *
 * - **Demonstration build.** Fictional sessions, no network, tokens that are
 *   obviously fake. Chosen at build time by `isDemoBuild()`.
 * - **Live build.** Amazon Cognito. If the pool is not configured, every call
 *   fails with `not_configured`. It never falls back to a demo user, because a
 *   caregiver who was quietly signed in as a fixture would be looking at
 *   invented medical records believing they were their parent's.
 *
 * That is the whole of the rule, and `assertLiveConfigured` is the one place it
 * is enforced.
 */

export interface AuthSession {
  user: AuthUser;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch millis. */
  expiresAt: number;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput extends SignInInput {
  fullName: string;
  location: string;
}

/** Result of a sign-up: Cognito may or may not require an emailed code. */
export interface SignUpResult {
  /** True when the pool auto-confirms and the user can sign in immediately. */
  confirmed: boolean;
  email: string;
}

/**
 * Refresh this far ahead of expiry.
 *
 * A token that expires mid-upload fails the upload. Five minutes covers a slow
 * multi-page PUT without refreshing so eagerly that every screen change costs a
 * round trip.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const MOCK_TOKEN_TTL_MS = 60 * 60 * 1000;

/** The single demo account. Any password of 8+ characters is accepted. */
export const DEMO_USER: AuthUser = {
  id: 'usr_demo_0001',
  email: 'demo@ayunetz.in',
  fullName: 'Ananya Rao',
  location: 'Berlin, Germany',
  createdAt: '2026-01-12T08:30:00.000Z',
};

const buildMockSession = (user: AuthUser): AuthSession => ({
  user,
  // Obviously-fake tokens: prefixed so they can never be confused with a real
  // Cognito JWT if one ever leaks into a log.
  idToken: `mock.id.${user.id}`,
  accessToken: `mock.access.${user.id}`,
  refreshToken: `mock.refresh.${user.id}`,
  expiresAt: Date.now() + MOCK_TOKEN_TTL_MS,
});

// ---------------------------------------------------------------------------
// ID token claims
// ---------------------------------------------------------------------------

/**
 * Reads the profile claims out of an ID token.
 *
 * **This does not verify the signature, and nothing security-relevant may
 * depend on it.** The token is displayed, not trusted: the backend verifies it
 * on every request (`TokenVerifier`), which is where authorisation actually
 * happens. All this decides is what name to greet somebody with.
 */
const claimsOf = (idToken: string): Record<string, unknown> => {
  const payload = idToken.split('.')[1];
  if (payload === undefined) return {};
  try {
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
    return JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const stringClaim = (claims: Record<string, unknown>, key: string): string => {
  const value = claims[key];
  return typeof value === 'string' ? value : '';
};

const userFromTokens = (tokens: CognitoTokens): AuthUser => {
  const claims = claimsOf(tokens.idToken);
  const subject = stringClaim(claims, 'sub');

  if (subject.length === 0) {
    throw new AuthError('unknown', 'The sign-in response was not in a form we could read.');
  }

  return {
    id: subject,
    email: stringClaim(claims, 'email'),
    fullName: stringClaim(claims, 'name') || stringClaim(claims, 'email'),
    location: stringClaim(claims, 'locale'),
    createdAt: nowIso(),
  };
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const persistSession = async (session: AuthSession): Promise<void> => {
  await Promise.all([
    secureStorage.set(SECURE_KEYS.idToken, session.idToken),
    secureStorage.set(SECURE_KEYS.accessToken, session.accessToken),
    secureStorage.set(SECURE_KEYS.refreshToken, session.refreshToken),
    secureStorage.set(SECURE_KEYS.tokenExpiresAt, String(session.expiresAt)),
  ]);
};

const readStoredTokens = async (): Promise<{
  idToken: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number;
}> => {
  const [idToken, accessToken, refreshToken, expiry] = await Promise.all([
    secureStorage.get(SECURE_KEYS.idToken),
    secureStorage.get(SECURE_KEYS.accessToken),
    secureStorage.get(SECURE_KEYS.refreshToken),
    secureStorage.get(SECURE_KEYS.tokenExpiresAt),
  ]);

  return {
    idToken,
    accessToken,
    refreshToken,
    // A missing expiry means a session stored before expiry was tracked. Zero
    // reads as "already expired", which forces a refresh rather than trusting
    // a token of unknown age.
    expiresAt: expiry === null ? 0 : (Number.parseInt(expiry, 10) || 0),
  };
};

// ---------------------------------------------------------------------------

/**
 * Fails a live build that has no user pool.
 *
 * The alternative — falling through to the mock branch — is the single most
 * dangerous thing this file could do, so the check is one function called by
 * every live entry point rather than a condition repeated in each.
 */
const assertLiveConfigured = (): CognitoConfig => {
  const cfg = cognitoConfig();
  if (cfg === null) {
    throw new AuthError(
      'not_configured',
      'Sign-in is not available in this build. No identity provider is configured.',
    );
  }
  return cfg;
};

/** True when this build talks to Cognito rather than using demo sessions. */
const isLive = (): boolean => !isDemoBuild() && isBackendEnabled();

const validateCredentials = (email: string, password: string): void => {
  if (!isValidEmail(email)) {
    throw new AuthError('invalid_input', 'Enter a valid email address.');
  }
  if (password.length < 8) {
    throw new AuthError('invalid_input', 'Password must be at least 8 characters.');
  }
};

/**
 * One refresh at a time.
 *
 * Several screens can hit a 401 in the same instant. Without this, each one
 * starts its own refresh, and all but the winner overwrite the stored tokens
 * with a stale result.
 */
let inFlightRefresh: Promise<AuthSession | null> | null = null;

const performRefresh = async (): Promise<AuthSession | null> => {
  if (!isLive()) {
    const token = await secureStorage.get(SECURE_KEYS.idToken);
    return token === null ? null : buildMockSession(DEMO_USER);
  }

  const cfg = cognitoConfig();
  const stored = await readStoredTokens();
  if (cfg === null || stored.refreshToken === null) return null;

  try {
    const tokens = await cognitoClient.refresh(cfg, stored.refreshToken);
    const session: AuthSession = {
      user: userFromTokens(tokens),
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      // Cognito does not reissue the refresh token, so the existing one stays.
      refreshToken: tokens.refreshToken ?? stored.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    await persistSession(session);
    return session;
  } catch (error) {
    // A revoked or expired refresh token is the end of the session, and the
    // credentials must go with it — leaving them would keep re-attempting a
    // refresh that can never succeed.
    if (error instanceof AuthError && !error.retryable) {
      await secureStorage.clearAll();
      return null;
    }
    // A network failure is not a revoked session. Keep the credentials so the
    // user is still signed in when the connection returns.
    throw error;
  }
};

export const authService = {
  /**
   * Registers the token source with the API client.
   *
   * The provider refreshes on the way out rather than waiting for a 401, so an
   * upload that starts four minutes before expiry does not fail halfway.
   */
  initialise(): void {
    setTokenProvider(
      async () => authService.currentIdToken(),
      // The forced path, for a 401 the clock did not predict.
      async () => (await authService.refresh().catch(() => null))?.idToken ?? null,
    );
  },

  /** A valid ID token, refreshed if it is close to expiry. Null if signed out. */
  async currentIdToken(): Promise<string | null> {
    const stored = await readStoredTokens();
    if (stored.idToken === null) return null;
    if (Date.now() < stored.expiresAt - REFRESH_MARGIN_MS) return stored.idToken;

    const refreshed = await authService.refresh().catch(() => null);
    return refreshed?.idToken ?? null;
  },

  async signIn({ email, password }: SignInInput): Promise<AuthSession> {
    validateCredentials(email, password);
    const address = email.trim().toLowerCase();

    if (isLive()) {
      const cfg = assertLiveConfigured();
      const tokens = await cognitoClient.signIn(cfg, address, password);
      const session: AuthSession = {
        user: userFromTokens(tokens),
        idToken: tokens.idToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? '',
        expiresAt: tokens.expiresAt,
      };
      await persistSession(session);
      return session;
    }

    const user: AuthUser =
      address === DEMO_USER.email
        ? DEMO_USER
        : {
            id: createId('usr'),
            email: address,
            fullName: 'Caregiver',
            location: '',
            createdAt: nowIso(),
          };

    const session = buildMockSession(user);
    await persistSession(session);
    return session;
  },

  /**
   * Creates an account.
   *
   * Returns rather than signing in: a pool that requires email confirmation
   * leaves the user unable to sign in until they enter the code, and reporting
   * that honestly is the difference between "check your email" and an
   * unexplained failure on the next screen.
   */
  async signUp({ email, password, fullName, location }: SignUpInput): Promise<SignUpResult> {
    validateCredentials(email, password);
    if (fullName.trim().length < 2) {
      throw new AuthError('invalid_input', 'Please enter your name.');
    }
    const address = email.trim().toLowerCase();

    if (isLive()) {
      const cfg = assertLiveConfigured();
      const { confirmed } = await cognitoClient.signUp(cfg, {
        email: address,
        password,
        fullName: fullName.trim(),
        location: location.trim(),
      });
      return { confirmed, email: address };
    }

    const session = buildMockSession({
      id: createId('usr'),
      email: address,
      fullName: fullName.trim(),
      location: location.trim(),
      createdAt: nowIso(),
    });
    await persistSession(session);
    return { confirmed: true, email: address };
  },

  /** Completes sign-up with the emailed code, then signs in. */
  async confirmSignUp(email: string, code: string, password: string): Promise<AuthSession> {
    if (code.trim().length === 0) {
      throw new AuthError('invalid_code', 'Enter the code from your email.');
    }
    if (!isLive()) return authService.signIn({ email, password });

    const cfg = assertLiveConfigured();
    await cognitoClient.confirmSignUp(cfg, email.trim().toLowerCase(), code.trim());
    return authService.signIn({ email, password });
  },

  async resendConfirmationCode(email: string): Promise<void> {
    if (!isLive()) return;
    const cfg = assertLiveConfigured();
    await cognitoClient.resendConfirmationCode(cfg, email.trim().toLowerCase());
  },

  /** Starts password recovery. Cognito emails a code. */
  async requestPasswordReset(email: string): Promise<void> {
    if (!isValidEmail(email)) {
      throw new AuthError('invalid_input', 'Enter a valid email address.');
    }
    if (!isLive()) return;
    const cfg = assertLiveConfigured();
    await cognitoClient.forgotPassword(cfg, email.trim().toLowerCase());
  },

  async confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
    validateCredentials(email, newPassword);
    if (code.trim().length === 0) {
      throw new AuthError('invalid_code', 'Enter the code from your email.');
    }
    if (!isLive()) return;
    const cfg = assertLiveConfigured();
    await cognitoClient.confirmForgotPassword(
      cfg,
      email.trim().toLowerCase(),
      code.trim(),
      newPassword,
    );
  },

  /** Instant demo entry — skips the credential form entirely. */
  async signInAsDemo(): Promise<AuthSession> {
    if (isLive()) {
      throw new AuthError('not_configured', 'Demonstration sign-in is not available in this build.');
    }
    const session = buildMockSession(DEMO_USER);
    await persistSession(session);
    return session;
  },

  /**
   * Signs out here and, in a live build, on the server.
   *
   * The order matters. Revoking first means a failure to revoke is visible;
   * clearing first would leave a still-valid refresh token on Cognito with
   * nothing on the device to retry it with. The local clear runs either way —
   * a user who asked to sign out must end up signed out on this phone even if
   * the network is down.
   */
  async signOut(): Promise<void> {
    try {
      if (isLive()) {
        const cfg = cognitoConfig();
        const accessToken = await secureStorage.get(SECURE_KEYS.accessToken);
        if (cfg !== null && accessToken !== null) {
          await cognitoClient.globalSignOut(cfg, accessToken);
        }
      }
    } catch {
      // Reported nowhere on purpose: the reason a revocation failed is not
      // something the user can act on, and the local sign-out below is what
      // they asked for. The refresh token expires on the pool's own schedule.
    } finally {
      await secureStorage.clearAll();
    }
  },

  /** True when a token is present. Does not validate the signature. */
  async hasStoredSession(): Promise<boolean> {
    return (await secureStorage.get(SECURE_KEYS.idToken)) !== null;
  },

  /**
   * Restores or renews the session.
   *
   * Returns null when there is nothing to restore or the session has ended.
   * Throws only when the answer is genuinely unknown — offline, or the provider
   * is down — so a caller can tell "signed out" from "could not check".
   */
  async refresh(): Promise<AuthSession | null> {
    inFlightRefresh ??= performRefresh().finally(() => {
      inFlightRefresh = null;
    });
    return inFlightRefresh;
  },

  /** Surfaced on the sign-in screen so a demonstration build is self-evident. */
  get isMock(): boolean {
    return !isLive();
  },

  get cognitoConfigured(): boolean {
    return cognitoConfig() !== null;
  },
};
