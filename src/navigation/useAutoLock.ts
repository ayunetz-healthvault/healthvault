import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useSessionStore } from '@/state/sessionStore';

/**
 * Re-locks the vault after the app has been in the background longer than the
 * user's auto-lock window.
 *
 * The threshold is checked on *return* rather than with a background timer:
 * both platforms suspend timers aggressively, and a phone that sat in a pocket
 * overnight must come back locked regardless of whether a timer survived.
 */
export const useAutoLock = (): void => {
  const noteBackgrounded = useSessionStore((state) => state.noteBackgrounded);
  const evaluateForeground = useSessionStore((state) => state.evaluateForeground);
  const previous = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const wasActive = previous.current === 'active';
      const isActive = next === 'active';

      if (wasActive && !isActive) {
        noteBackgrounded();
      } else if (!wasActive && isActive) {
        evaluateForeground();
      }

      previous.current = next;
    });

    return () => subscription.remove();
  }, [noteBackgrounded, evaluateForeground]);
};
