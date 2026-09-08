import { renderHook } from '@testing-library/react-native';

import { useRouteGuard } from './useRouteGuard';

import { DEFAULT_PRIVACY, useSessionStore } from '@/state/sessionStore';
import type { AuthSession } from '@/services/auth/authService';

/**
 * The gate in front of every private screen.
 *
 * The bug these tests exist for: on a cold start the persisted store rehydrates
 * before the token is read out of secure storage, so for a moment a signed-in
 * user looks signed out. The guard redirected on that, and the URL the user had
 * actually opened — a reminder linking to one follow-up — was replaced by the
 * dashboard. It was invisible in the app because the round trip is fast; it was
 * obvious the moment a browser was pointed at a deep link.
 */

// `mock`-prefixed so Jest allows the factory below to close over them.
const mockReplace = jest.fn();
let mockSegments: string[] = [];

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useSegments: () => mockSegments,
}));

const session = (): AuthSession => ({
  user: {
    id: 'usr_1',
    email: 'a@example.invalid',
    fullName: 'Ananya Rao',
    location: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  idToken: 'mock.id.usr_1',
  accessToken: 'mock.access.usr_1',
  refreshToken: 'mock.refresh.usr_1',
  expiresAt: Date.now() + 3_600_000,
});

const signedInState = {
  hydrated: true,
  restoreAttempted: true,
  onboardingComplete: true,
  privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: '2026-01-01T00:00:00.000Z' },
  session: session(),
  lockState: 'unlocked' as const,
};

beforeEach(() => {
  mockReplace.mockClear();
  mockSegments = [];
  useSessionStore.setState({
    hydrated: false,
    restoreAttempted: false,
    onboardingComplete: false,
    user: null,
    session: null,
    selfRecordId: null,
    privacy: DEFAULT_PRIVACY,
    lockState: 'unknown',
    backgroundedAt: null,
  });
});

describe('useRouteGuard', () => {
  it('does nothing before the store has rehydrated', async () => {
    await renderHook(() => useRouteGuard());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /** The regression. */
  it('does not call a signed-in user signed out while the token is still being read', async () => {
    useSessionStore.setState({
      hydrated: true,
      restoreAttempted: false,
      onboardingComplete: true,
      privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: '2026-01-01T00:00:00.000Z' },
      session: null,
    });
    mockSegments = ['me'];

    await renderHook(() => useRouteGuard());

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('leaves a signed-in user on the deep link they opened', async () => {
    useSessionStore.setState(signedInState);
    mockSegments = ['follow-up', 'fup_1'];

    await renderHook(() => useRouteGuard());

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('sends a user who has not onboarded to onboarding', async () => {
    useSessionStore.setState({ hydrated: true, restoreAttempted: true });
    mockSegments = ['care'];

    await renderHook(() => useRouteGuard());

    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
  });

  it('sends a signed-out user to sign-in', async () => {
    useSessionStore.setState({
      hydrated: true,
      restoreAttempted: true,
      onboardingComplete: true,
      privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: '2026-01-01T00:00:00.000Z' },
      session: null,
    });
    mockSegments = ['care'];

    await renderHook(() => useRouteGuard());

    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
  });

  it('sends a signed-in but locked user to the lock screen', async () => {
    useSessionStore.setState({
      ...signedInState,
      privacy: { ...signedInState.privacy, lockMethod: 'pin' },
      lockState: 'locked',
    });
    mockSegments = ['care'];

    await renderHook(() => useRouteGuard());

    expect(mockReplace).toHaveBeenCalledWith('/lock');
  });

  it('returns the user to the deep link they wanted after the gate clears', async () => {
    useSessionStore.setState({
      hydrated: true,
      restoreAttempted: true,
      onboardingComplete: true,
      privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: '2026-01-01T00:00:00.000Z' },
      session: null,
    });
    mockSegments = ['document', 'doc_9'];

    const { rerender } = await renderHook(() => useRouteGuard());
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');

    // The gate is entered, then passed.
    mockSegments = ['(auth)'];
    await rerender({});
    useSessionStore.setState(signedInState);
    await rerender({});

    expect(mockReplace).toHaveBeenLastCalledWith('/document/doc_9');
  });

  it('falls back to the home route when there was no destination to keep', async () => {
    useSessionStore.setState({
      hydrated: true,
      restoreAttempted: true,
      onboardingComplete: true,
      privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: '2026-01-01T00:00:00.000Z' },
      session: null,
    });
    mockSegments = ['(auth)'];

    const { rerender } = await renderHook(() => useRouteGuard());
    useSessionStore.setState(signedInState);
    await rerender({});

    expect(mockReplace).toHaveBeenLastCalledWith('/');
  });

  /**
   * A remembered path must not outlive the account that produced it, or the
   * next person to sign in on this device lands on the previous person's
   * record.
   */
  it('forgets the destination once it has been used', async () => {
    useSessionStore.setState({
      hydrated: true,
      restoreAttempted: true,
      onboardingComplete: true,
      privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: '2026-01-01T00:00:00.000Z' },
      session: null,
    });
    mockSegments = ['parent', 'par_1'];

    const { rerender } = await renderHook(() => useRouteGuard());
    mockSegments = ['(auth)'];
    await rerender({});
    useSessionStore.setState(signedInState);
    await rerender({});
    expect(mockReplace).toHaveBeenLastCalledWith('/parent/par_1');

    // Signed out again, and back to a gate with no destination in flight.
    mockReplace.mockClear();
    useSessionStore.setState({ session: null, restoreAttempted: true });
    mockSegments = ['(auth)'];
    await rerender({});
    useSessionStore.setState(signedInState);
    await rerender({});

    expect(mockReplace).toHaveBeenLastCalledWith('/');
  });

  it('reports ready only once the session question has been answered', async () => {
    const { result, rerender } = await renderHook(() => useRouteGuard());
    expect(result.current.ready).toBe(false);

    useSessionStore.setState({ hydrated: true });
    await rerender({});
    expect(result.current.ready).toBe(false);

    useSessionStore.setState({ restoreAttempted: true });
    await rerender({});
    expect(result.current.ready).toBe(true);
  });
});
