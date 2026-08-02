import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useSessionStore } from '@/state/sessionStore';

/**
 * Decides which of the four app states the user belongs in and redirects.
 *
 *   not onboarded          -> /onboarding
 *   onboarded, signed out  -> /(auth)/sign-in
 *   signed in, locked      -> /lock
 *   signed in, unlocked    -> /(tabs)
 *
 * Implemented as a redirect effect rather than conditional rendering so deep
 * links (a calendar reminder tapping through to a follow-up) still land on the
 * right screen after the gate clears.
 */
export const useRouteGuard = (): { ready: boolean } => {
  const router = useRouter();
  const segments = useSegments();

  const hydrated = useSessionStore((state) => state.hydrated);
  const onboardingComplete = useSessionStore((state) => state.onboardingComplete);
  const disclaimerAcceptedAt = useSessionStore((state) => state.privacy.disclaimerAcceptedAt);
  const session = useSessionStore((state) => state.session);
  const lockMethod = useSessionStore((state) => state.privacy.lockMethod);
  const lockState = useSessionStore((state) => state.lockState);

  useEffect(() => {
    if (!hydrated) return;

    const root = segments[0];
    const inOnboarding = root === 'onboarding';
    const inAuth = root === '(auth)';
    const onLockScreen = root === 'lock';

    const needsOnboarding = !onboardingComplete || disclaimerAcceptedAt === null;
    const needsAuth = session === null;
    const needsUnlock = session !== null && lockMethod !== 'none' && lockState !== 'unlocked';

    if (needsOnboarding) {
      if (!inOnboarding) router.replace('/onboarding');
      return;
    }

    if (needsAuth) {
      if (!inAuth) router.replace('/sign-in');
      return;
    }

    if (needsUnlock) {
      if (!onLockScreen) router.replace('/lock');
      return;
    }

    // Fully authorised — bounce off any gate screen we are still sitting on.
    if (inOnboarding || inAuth || onLockScreen) {
      router.replace('/');
    }
  }, [
    hydrated,
    onboardingComplete,
    disclaimerAcceptedAt,
    session,
    lockMethod,
    lockState,
    segments,
    router,
  ]);

  return { ready: hydrated };
};
