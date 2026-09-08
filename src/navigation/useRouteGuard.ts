import { useRouter, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSessionStore } from '@/state/sessionStore';

/**
 * Decides which of the four app states the user belongs in and redirects.
 *
 *   not onboarded          -> /onboarding
 *   onboarded, signed out  -> /(auth)/sign-in
 *   signed in, locked      -> /lock
 *   signed in, unlocked    -> the URL they asked for, or `/`
 *
 * Implemented as a redirect effect rather than conditional rendering so a deep
 * link — a calendar reminder tapping through to a follow-up — survives the gate
 * it has to pass through. Two things are needed for that to actually be true,
 * and both are below.
 *
 * ## 1. Wait before deciding somebody is signed out
 *
 * The persisted store rehydrates from AsyncStorage before the token is read out
 * of SecureStore. In that window `session` is null for a user who is perfectly
 * well signed in. Redirecting on it sent every cold start to sign-in, and then
 * — once the token arrived — to `/`, losing whatever URL the user actually
 * opened. `restoreAttempted` is the store saying it has finished looking.
 *
 * ## 2. Remember where they were going
 *
 * Once a gate does apply, the destination is kept here and restored when the
 * gate clears. It is deliberately *not* persisted: a URL captured on one launch
 * is stale by the next, and a stored path that survives a sign-out would send
 * the next account to the previous account's record.
 */

/** Route roots that are gates rather than destinations. */
const GATES = new Set(['onboarding', '(auth)', 'lock']);

export const useRouteGuard = (): { ready: boolean } => {
  const router = useRouter();
  const segments = useSegments();

  const hydrated = useSessionStore((state) => state.hydrated);
  const restoreAttempted = useSessionStore((state) => state.restoreAttempted);
  const onboardingComplete = useSessionStore((state) => state.onboardingComplete);
  const disclaimerAcceptedAt = useSessionStore((state) => state.privacy.disclaimerAcceptedAt);
  const session = useSessionStore((state) => state.session);
  const lockMethod = useSessionStore((state) => state.privacy.lockMethod);
  const lockState = useSessionStore((state) => state.lockState);

  /** Where the user was headed when a gate interrupted them. */
  const intendedRoute = useRef<string | null>(null);

  useEffect(() => {
    // Not "is the store loaded" but "does the store yet know whether there is a
    // session". Those are different moments, and acting on the first one is
    // what broke deep links.
    if (!hydrated || !restoreAttempted) return;

    const root = segments[0];
    const onGate = root !== undefined && GATES.has(root);

    const needsOnboarding = !onboardingComplete || disclaimerAcceptedAt === null;
    const needsAuth = session === null;
    const needsUnlock = session !== null && lockMethod !== 'none' && lockState !== 'unlocked';

    if (needsOnboarding || needsAuth || needsUnlock) {
      // Capture the destination once, on the way in. Re-capturing on every
      // render would overwrite it with the gate's own route.
      if (!onGate && intendedRoute.current === null && segments.length > 0) {
        intendedRoute.current = `/${segments.join('/')}`;
      }

      if (needsOnboarding) {
        if (root !== 'onboarding') router.replace('/onboarding');
        return;
      }
      if (needsAuth) {
        if (root !== '(auth)') router.replace('/sign-in');
        return;
      }
      if (root !== 'lock') router.replace('/lock');
      return;
    }

    // Fully authorised. Leave the user where they are unless they are sitting
    // on a gate that no longer applies.
    if (!onGate) return;

    const destination = intendedRoute.current;
    intendedRoute.current = null;
    router.replace(destination ?? '/');
  }, [
    hydrated,
    restoreAttempted,
    onboardingComplete,
    disclaimerAcceptedAt,
    session,
    lockMethod,
    lockState,
    segments,
    router,
  ]);

  return { ready: hydrated && restoreAttempted };
};
