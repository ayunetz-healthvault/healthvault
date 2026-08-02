import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { appLock } from '@/services/auth/appLock';
import { type AuthSession, authService } from '@/services/auth/authService';
import { STORAGE_KEYS } from '@/services/storage/persistence';
import type { AppLockMethod, AuthUser, PrivacySettings } from '@/types/domain';
import { nowIso } from '@/utils/date';

/**
 * Session, onboarding and app-lock state.
 *
 * Kept separate from the record vault so signing out can drop this store
 * without touching cached documents (which are wiped explicitly, by the
 * account service, when the user asks for it).
 */

export type LockState = 'unknown' | 'locked' | 'unlocked';

export const DEFAULT_PRIVACY: PrivacySettings = {
  lockMethod: 'none',
  autoLockMinutes: 5,
  // Both analytics flags are opt-in. Health data does not get a default yes.
  analyticsEnabled: false,
  shareAnonymisedDataForImprovement: false,
  disclaimerAcceptedAt: null,
  calendarSyncEnabled: false,
};

interface SessionState {
  hydrated: boolean;
  onboardingComplete: boolean;
  user: AuthUser | null;
  session: AuthSession | null;
  privacy: PrivacySettings;
  lockState: LockState;
  /** Timestamp the app last went to background, for the auto-lock timer. */
  backgroundedAt: number | null;

  setHydrated: () => void;
  completeOnboarding: () => void;
  acceptDisclaimer: () => void;
  signIn: (session: AuthSession) => void;
  signOut: () => Promise<void>;
  updatePrivacy: (patch: Partial<PrivacySettings>) => void;
  setLockMethod: (method: AppLockMethod) => void;
  lock: () => void;
  unlock: () => void;
  noteBackgrounded: () => void;
  /** Applies the auto-lock rule on foreground; returns the resulting state. */
  evaluateForeground: () => LockState;
  reset: () => void;
}

const initialState = {
  hydrated: false,
  onboardingComplete: false,
  user: null as AuthUser | null,
  session: null as AuthSession | null,
  privacy: DEFAULT_PRIVACY,
  lockState: 'unknown' as LockState,
  backgroundedAt: null as number | null,
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setHydrated: () => set({ hydrated: true }),

      completeOnboarding: () => set({ onboardingComplete: true }),

      acceptDisclaimer: () =>
        set((state) => ({
          privacy: { ...state.privacy, disclaimerAcceptedAt: nowIso() },
        })),

      signIn: (session) =>
        set({
          session,
          user: session.user,
          // A fresh sign-in is an unlock; the lock screen would be redundant.
          lockState: 'unlocked',
        }),

      signOut: async () => {
        await authService.signOut();
        set({
          ...initialState,
          hydrated: true,
          // Onboarding and the accepted disclaimer survive a sign-out; making
          // someone re-read the disclaimer to sign back in is just friction.
          onboardingComplete: get().onboardingComplete,
          privacy: { ...DEFAULT_PRIVACY, disclaimerAcceptedAt: get().privacy.disclaimerAcceptedAt },
        });
      },

      updatePrivacy: (patch) => set((state) => ({ privacy: { ...state.privacy, ...patch } })),

      setLockMethod: (method) =>
        set((state) => ({
          privacy: { ...state.privacy, lockMethod: method },
          lockState: method === 'none' ? 'unlocked' : state.lockState,
        })),

      lock: () => set({ lockState: 'locked' }),

      unlock: () => set({ lockState: 'unlocked', backgroundedAt: null }),

      noteBackgrounded: () => set({ backgroundedAt: Date.now() }),

      evaluateForeground: () => {
        const { privacy, backgroundedAt, session } = get();
        if (!session || privacy.lockMethod === 'none') {
          set({ lockState: 'unlocked', backgroundedAt: null });
          return 'unlocked';
        }
        const elapsedMs = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
        const shouldLock = elapsedMs >= privacy.autoLockMinutes * 60 * 1000;
        const next: LockState = shouldLock ? 'locked' : 'unlocked';
        set({ lockState: next, backgroundedAt: null });
        return next;
      },

      reset: () => set({ ...initialState, hydrated: true }),
    }),
    {
      name: STORAGE_KEYS.session,
      storage: createJSONStorage(() => AsyncStorage),
      // `session` deliberately excluded: tokens live in SecureStore, never in
      // AsyncStorage. `lockState` is excluded so the app always starts locked.
      partialize: (state) => ({
        onboardingComplete: state.onboardingComplete,
        user: state.user,
        privacy: state.privacy,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);

/** True when the vault should be gated behind the lock screen right now. */
export const shouldShowLockScreen = (state: {
  session: AuthSession | null;
  privacy: PrivacySettings;
  lockState: LockState;
}): boolean =>
  state.session !== null && state.privacy.lockMethod !== 'none' && state.lockState !== 'unlocked';

/** Restores a session from SecureStore on cold start. */
export const restoreSession = async (): Promise<void> => {
  const restored = await authService.refresh();
  if (restored) {
    const method = await appLock.resolveEffectiveMethod(
      useSessionStore.getState().privacy.lockMethod,
    );
    useSessionStore.setState({
      session: restored,
      user: restored.user,
      lockState: method === 'none' ? 'unlocked' : 'locked',
    });
  }
};
