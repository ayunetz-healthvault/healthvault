import { authService, DEMO_USER } from './authService';
import { AuthError } from './authErrors';

import { SECURE_KEYS, secureStorage } from '@/services/storage/secureStorage';

/**
 * Authentication, in both modes.
 *
 * The assertions that matter most are the ones about what must *not* happen: a
 * live build must never quietly hand out a demo session, a client secret must
 * never be tolerated in the bundle, and signing out must revoke on the server
 * rather than only forgetting locally. Each of those, done wrong, looks exactly
 * like working software.
 */

const mockEnv = {
  demo: true,
  backend: false,
  userPoolId: '',
  appClientId: '',
};

jest.mock('@/config/env', () => ({
  get config() {
    return {
      environment: 'local',
      demo: mockEnv.demo,
      aws: { region: 'ap-south-1', documentsBucket: 'b' },
      api: { baseUrl: 'https://api.test.invalid', timeoutMs: 5000, processingTimeoutMs: 5000 },
      cognito: {
        userPoolId: mockEnv.userPoolId,
        appClientId: mockEnv.appClientId,
        domain: '',
        redirectUri: '',
      },
      upload: { presignTtlSeconds: 900, maxUploadBytes: 1000 },
      features: { aiSummary: true, calendarSync: true, biometricLock: true },
      sentryDsn: null,
    };
  },
  isDemoBuild: () => mockEnv.demo,
  isBackendEnabled: () => mockEnv.backend,
}));

/** Builds an unsigned JWT-shaped token. Only the payload is ever read. */
const fakeIdToken = (claims: Record<string, unknown>): string => {
  const encode = (value: object): string =>
    globalThis.btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
};

const CLAIMS = {
  sub: 'cognito-sub-1234',
  email: 'meera@example.invalid',
  name: 'Meera Nair',
  locale: 'Kochi, India',
};

const goLive = (): void => {
  mockEnv.demo = false;
  mockEnv.backend = true;
  mockEnv.userPoolId = 'ap-south-1_TESTPOOL';
  mockEnv.appClientId = 'testappclient';
};

const fetchMock = jest.fn();

beforeEach(async () => {
  mockEnv.demo = true;
  mockEnv.backend = false;
  mockEnv.userPoolId = '';
  mockEnv.appClientId = '';
  delete process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_SECRET;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await secureStorage.clearAll();
});

/** One Cognito JSON response. */
const respondWith = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
};

const authResult = (overrides: Record<string, unknown> = {}): unknown => ({
  AuthenticationResult: {
    IdToken: fakeIdToken(CLAIMS),
    AccessToken: 'access-token-value',
    RefreshToken: 'refresh-token-value',
    ExpiresIn: 3600,
    ...overrides,
  },
});

describe('demonstration build', () => {
  it('signs in without touching the network', async () => {
    const session = await authService.signIn({ email: DEMO_USER.email, password: 'password123' });

    expect(session.user).toEqual(DEMO_USER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mints tokens that could never be mistaken for a real one', async () => {
    const session = await authService.signIn({ email: DEMO_USER.email, password: 'password123' });

    expect(session.idToken.startsWith('mock.')).toBe(true);
    expect(session.accessToken.startsWith('mock.')).toBe(true);
  });

  it('rejects a bad address and a short password before doing anything', async () => {
    await expect(authService.signIn({ email: 'nope', password: 'password123' })).rejects.toThrow(
      AuthError,
    );
    await expect(
      authService.signIn({ email: DEMO_USER.email, password: 'short' }),
    ).rejects.toThrow(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('live build without a configured pool', () => {
  beforeEach(() => {
    mockEnv.demo = false;
    mockEnv.backend = true;
    // No pool id, no client id.
  });

  /** The one that matters most in this file. */
  it('fails rather than falling back to a demonstration user', async () => {
    await expect(
      authService.signIn({ email: 'someone@example.invalid', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'not_configured' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await secureStorage.get(SECURE_KEYS.idToken)).toBeNull();
  });

  it('refuses the demonstration shortcut outright', async () => {
    await expect(authService.signInAsDemo()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('reports itself as not a mock, so no screen claims otherwise', () => {
    expect(authService.isMock).toBe(false);
    expect(authService.cognitoConfigured).toBe(false);
  });
});

describe('live build with a configured pool', () => {
  beforeEach(goLive);

  it('signs in and stores the session, with the profile read from the token', async () => {
    respondWith(authResult());

    const session = await authService.signIn({
      email: 'Meera@Example.invalid',
      password: 'password123',
    });

    expect(session.user).toMatchObject({
      id: 'cognito-sub-1234',
      email: 'meera@example.invalid',
      fullName: 'Meera Nair',
    });
    expect(await secureStorage.get(SECURE_KEYS.refreshToken)).toBe('refresh-token-value');
    expect(await secureStorage.get(SECURE_KEYS.tokenExpiresAt)).not.toBeNull();
  });

  it('sends the address lower-cased, as Cognito stores it', async () => {
    respondWith(authResult());
    await authService.signIn({ email: '  Meera@Example.invalid ', password: 'password123' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      AuthParameters: { USERNAME: string };
    };
    expect(body.AuthParameters.USERNAME).toBe('meera@example.invalid');
  });

  it('never sends a client secret, and refuses to run if one is configured', async () => {
    process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_SECRET = 'should-not-exist';

    await expect(
      authService.signIn({ email: 'meera@example.invalid', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'misconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['NotAuthorizedException', 'invalid_credentials'],
    ['UserNotConfirmedException', 'not_confirmed'],
    ['UsernameExistsException', 'already_registered'],
    ['CodeMismatchException', 'invalid_code'],
    ['TooManyRequestsException', 'rate_limited'],
    ['PasswordResetRequiredException', 'reset_required'],
  ])('turns %s into something the user can act on', async (type, expected) => {
    respondWith({ __type: type, message: 'x' }, 400);

    await expect(
      authService.signIn({ email: 'meera@example.invalid', password: 'password123' }),
    ).rejects.toMatchObject({ code: expected });
  });

  /**
   * A provider message can echo the username, and an error string is the part
   * of a failed request most likely to reach a log or a crash report.
   */
  it('never repeats the provider message, which can name the user', async () => {
    respondWith(
      { __type: 'SomeUnmappedException', message: 'User meera@example.invalid does not exist' },
      400,
    );

    await expect(
      authService.signIn({ email: 'meera@example.invalid', password: 'password123' }),
    ).rejects.toMatchObject({
      code: 'unknown',
      message: expect.not.stringContaining('meera'),
    });
  });

  it('treats a challenge as unsupported rather than as a session', async () => {
    respondWith({ ChallengeName: 'SMS_MFA', Session: 'abc' });

    await expect(
      authService.signIn({ email: 'meera@example.invalid', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'challenge_required' });
  });

  it('reports an unconfirmed sign-up instead of pretending it signed in', async () => {
    respondWith({ UserConfirmed: false, UserSub: 'sub' });

    await expect(
      authService.signUp({
        email: 'meera@example.invalid',
        password: 'password123',
        fullName: 'Meera Nair',
        location: 'Kochi',
      }),
    ).resolves.toEqual({ confirmed: false, email: 'meera@example.invalid' });
  });
});

describe('token lifetime', () => {
  beforeEach(goLive);

  it('returns the stored token while it is comfortably valid', async () => {
    respondWith(authResult());
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });
    fetchMock.mockReset();

    expect(await authService.currentIdToken()).toBe(fakeIdToken(CLAIMS));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes before expiry rather than letting a request fail', async () => {
    respondWith(authResult({ ExpiresIn: 60 })); // inside the five-minute margin
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    respondWith(authResult({ RefreshToken: undefined, ExpiresIn: 3600 }));

    expect(await authService.currentIdToken()).not.toBeNull();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { AuthFlow: string };
    expect(body.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
  });

  /** Cognito does not reissue it, so losing it would end the session early. */
  it('keeps the existing refresh token when the refresh response omits one', async () => {
    respondWith(authResult({ ExpiresIn: 60 }));
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    respondWith(authResult({ RefreshToken: undefined }));
    await authService.refresh();

    expect(await secureStorage.get(SECURE_KEYS.refreshToken)).toBe('refresh-token-value');
  });

  it('ends the session and clears credentials when the refresh token is rejected', async () => {
    respondWith(authResult({ ExpiresIn: 60 }));
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    respondWith({ __type: 'NotAuthorizedException' }, 400);

    expect(await authService.refresh()).toBeNull();
    expect(await secureStorage.get(SECURE_KEYS.idToken)).toBeNull();
    expect(await secureStorage.get(SECURE_KEYS.refreshToken)).toBeNull();
  });

  /**
   * Being offline is not being signed out. Clearing credentials here would sign
   * a user out of their own records every time they opened the app on a train.
   */
  it('keeps the session when a refresh fails because the network is down', async () => {
    respondWith(authResult({ ExpiresIn: 60 }));
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(authService.refresh()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await secureStorage.get(SECURE_KEYS.refreshToken)).toBe('refresh-token-value');
  });

  it('collapses concurrent refreshes into one call to the provider', async () => {
    respondWith(authResult({ ExpiresIn: 60 }));
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    respondWith(authResult());

    const [a, b, c] = await Promise.all([
      authService.refresh(),
      authService.refresh(),
      authService.refresh(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.idToken).toBe(b?.idToken);
    expect(b?.idToken).toBe(c?.idToken);
  });

  /** A session stored before expiry was tracked must not be trusted blindly. */
  it('treats a session with no recorded expiry as needing a refresh', async () => {
    await secureStorage.set(SECURE_KEYS.idToken, 'old-token');
    await secureStorage.set(SECURE_KEYS.refreshToken, 'old-refresh');
    respondWith(authResult());

    await authService.currentIdToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('sign out', () => {
  beforeEach(goLive);

  it('revokes on the server, not only on the device', async () => {
    respondWith(authResult());
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    respondWith({});
    await authService.signOut();

    const target = fetchMock.mock.calls[0][1].headers['X-Amz-Target'] as string;
    expect(target).toContain('GlobalSignOut');
    expect(await secureStorage.get(SECURE_KEYS.idToken)).toBeNull();
  });

  /** Someone who asked to sign out must end up signed out on this phone. */
  it('clears the device even when the revocation call fails', async () => {
    respondWith(authResult());
    await authService.signIn({ email: 'meera@example.invalid', password: 'password123' });

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await authService.signOut();

    expect(await secureStorage.get(SECURE_KEYS.idToken)).toBeNull();
    expect(await secureStorage.get(SECURE_KEYS.refreshToken)).toBeNull();
    expect(await secureStorage.get(SECURE_KEYS.accessToken)).toBeNull();
  });
});
