import { setTokenProvider } from '../api/client';
import { SECURE_KEYS, secureStorage } from '../storage/secureStorage';

import { config, isBackendEnabled } from '@/config/env';
import type { AuthUser } from '@/types/domain';
import { nowIso } from '@/utils/date';
import { createId } from '@/utils/id';
import { isValidEmail } from '@/utils/validation';

/**
 * Authentication.
 *
 * This is a *placeholder* implementation with the real shape already in place:
 * the interface below is exactly what an Amazon Cognito user pool provides, so
 * swapping the mock for `amazon-cognito-identity-js` (or the Amplify v6 auth
 * module) is a single-file change with no call-site edits.
 *
 * Planned production flow:
 *   1. Hosted UI / native SRP sign-in against the Mumbai user pool.
 *   2. PKCE authorization code exchange (public client — no client secret).
 *   3. ID + refresh tokens stored in SecureStore (Keychain / Keystore).
 *   4. Silent refresh on 401; API Gateway validates the JWT with a JWT authorizer.
 *
 * TODO(backend): replace the mock branches in `signIn`/`signUp` with Cognito
 * calls and delete `signInAsDemo` along with `buildMockSession`.
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

export class AuthError extends Error {
  readonly code: 'invalid_credentials' | 'invalid_input' | 'not_configured' | 'unknown';

  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const MOCK_TOKEN_TTL_MS = 60 * 60 * 1000;

const buildMockSession = (user: AuthUser): AuthSession => ({
  user,
  // Obviously-fake tokens: prefixed so they can never be confused with a real
  // Cognito JWT if one ever leaks into a log.
  idToken: `mock.id.${user.id}`,
  accessToken: `mock.access.${user.id}`,
  refreshToken: `mock.refresh.${user.id}`,
  expiresAt: Date.now() + MOCK_TOKEN_TTL_MS,
});

/** The single demo account. Any password of 8+ characters is accepted. */
export const DEMO_USER: AuthUser = {
  id: 'usr_demo_0001',
  email: 'demo@ayunetz.in',
  fullName: 'Ananya Rao',
  location: 'Berlin, Germany',
  createdAt: '2026-01-12T08:30:00.000Z',
};

const persistSession = async (session: AuthSession): Promise<void> => {
  await Promise.all([
    secureStorage.set(SECURE_KEYS.idToken, session.idToken),
    secureStorage.set(SECURE_KEYS.accessToken, session.accessToken),
    secureStorage.set(SECURE_KEYS.refreshToken, session.refreshToken),
  ]);
};

export const authService = {
  /**
   * Registers the token source with the API client. Called once from the root
   * layout so every request picks up the current ID token automatically.
   */
  initialise(): void {
    setTokenProvider(async () => secureStorage.get(SECURE_KEYS.idToken));
  },

  async signIn({ email, password }: SignInInput): Promise<AuthSession> {
    if (!isValidEmail(email)) {
      throw new AuthError('invalid_input', 'Enter a valid email address.');
    }
    if (password.length < 8) {
      throw new AuthError('invalid_credentials', 'Password must be at least 8 characters.');
    }

    if (isBackendEnabled()) {
      // TODO(backend): Cognito InitiateAuth (USER_SRP_AUTH) against
      // `config.cognito.userPoolId` / `config.cognito.appClientId`.
      throw new AuthError('not_configured', 'Cognito sign-in is not wired up yet.');
    }

    const user: AuthUser =
      email.trim().toLowerCase() === DEMO_USER.email
        ? DEMO_USER
        : {
            id: createId('usr'),
            email: email.trim().toLowerCase(),
            fullName: 'Caregiver',
            location: '',
            createdAt: nowIso(),
          };

    const session = buildMockSession(user);
    await persistSession(session);
    return session;
  },

  async signUp({ email, password, fullName, location }: SignUpInput): Promise<AuthSession> {
    if (!isValidEmail(email)) {
      throw new AuthError('invalid_input', 'Enter a valid email address.');
    }
    if (password.length < 8) {
      throw new AuthError('invalid_input', 'Choose a password of at least 8 characters.');
    }
    if (fullName.trim().length < 2) {
      throw new AuthError('invalid_input', 'Please enter your name.');
    }

    if (isBackendEnabled()) {
      // TODO(backend): Cognito SignUp + ConfirmSignUp (email OTP), then sign in.
      throw new AuthError('not_configured', 'Cognito sign-up is not wired up yet.');
    }

    const session = buildMockSession({
      id: createId('usr'),
      email: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      location: location.trim(),
      createdAt: nowIso(),
    });
    await persistSession(session);
    return session;
  },

  /** Instant demo entry — skips the credential form entirely. */
  async signInAsDemo(): Promise<AuthSession> {
    const session = buildMockSession(DEMO_USER);
    await persistSession(session);
    return session;
  },

  async signOut(): Promise<void> {
    // TODO(backend): also call Cognito GlobalSignOut so the refresh token is
    // revoked server-side, not just dropped from the device.
    await secureStorage.clearAll();
  },

  /** True when a token is present. Does not validate the signature. */
  async hasStoredSession(): Promise<boolean> {
    return (await secureStorage.get(SECURE_KEYS.idToken)) !== null;
  },

  /**
   * TODO(backend): exchange the refresh token for a fresh ID token when it is
   * within ~5 minutes of expiry, and call this from the API client on 401.
   */
  async refresh(): Promise<AuthSession | null> {
    if (isBackendEnabled()) return null;
    const token = await secureStorage.get(SECURE_KEYS.idToken);
    return token ? buildMockSession(DEMO_USER) : null;
  },

  /** Surfaced on the sign-in screen so the demo build is self-explanatory. */
  get isMock(): boolean {
    return !isBackendEnabled();
  },

  get cognitoConfigured(): boolean {
    return config.cognito.userPoolId.length > 0 && config.cognito.appClientId.length > 0;
  },
};
