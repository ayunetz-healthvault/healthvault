import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Keychain / Android Keystore backed storage for anything sensitive:
 * Cognito tokens and the PIN verifier. Never used for record data — that goes
 * through `persistence.ts`.
 *
 * ## Web
 * `expo-secure-store` ships no web implementation — its web build is literally
 * `export default {}`, so every call throws. Web is only ever a development
 * preview for this app (the real targets are Android and iOS), so rather than
 * let that surface as an unexplained sign-in failure, web falls back to
 * `localStorage` behind a loud warning.
 *
 * That fallback is **not secure**: anything in `localStorage` is readable by
 * any script on the origin. It exists so the UI can be demoed in a browser,
 * and nothing else.
 *
 * TODO(security): if a real web client is ever shipped, delete the fallback and
 * move to httpOnly, SameSite=Strict cookies set by the backend — tokens must
 * not be reachable from JavaScript at all.
 */

export const SECURE_KEYS = {
  idToken: 'ayunetz.auth.idToken',
  accessToken: 'ayunetz.auth.accessToken',
  refreshToken: 'ayunetz.auth.refreshToken',
  /** Salted hash of the PIN — the PIN itself is never stored. */
  pinVerifier: 'ayunetz.lock.pinVerifier',
  pinSalt: 'ayunetz.lock.pinSalt',
} as const;

export type SecureKey = (typeof SECURE_KEYS)[keyof typeof SECURE_KEYS];

const options: SecureStore.SecureStoreOptions = {
  // Records must not leave the device via an iCloud/Google backup.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** True when the platform has a real secure enclave available. */
export const hasSecureEnclave = (): boolean => Platform.OS !== 'web';

// ---------------------------------------------------------------------------
// Web fallback
// ---------------------------------------------------------------------------

let warnedAboutWeb = false;

const warnOnce = (): void => {
  if (warnedAboutWeb) return;
  warnedAboutWeb = true;
  console.warn(
    '[ayunetz] Secure storage is unavailable on web. Falling back to localStorage, ' +
      'which is NOT secure. Use an Android or iOS build for anything real.',
  );
};

/** Survives a reload where localStorage exists; in-memory otherwise. */
const memoryFallback = new Map<string, string>();

const webStorage = {
  get(key: string): string | null {
    warnOnce();
    try {
      return globalThis.localStorage?.getItem(key) ?? memoryFallback.get(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    warnOnce();
    memoryFallback.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private browsing or a full quota — the in-memory copy still works for
      // the current session.
    }
  },
  remove(key: string): void {
    memoryFallback.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Already gone.
    }
  },
};

// ---------------------------------------------------------------------------

export const secureStorage = {
  async get(key: SecureKey): Promise<string | null> {
    if (!hasSecureEnclave()) return webStorage.get(key);
    try {
      return await SecureStore.getItemAsync(key, options);
    } catch {
      // A locked or unavailable keychain is treated as "no value" rather than a
      // crash — the caller then falls back to asking the user to sign in.
      return null;
    }
  },

  /**
   * Note the asymmetry with `get`: a failed write on a real device is NOT
   * swallowed. Silently failing to store a token would leave someone looking
   * signed in with nothing persisted, and silently failing to store the PIN
   * verifier would leave the lock screen unopenable.
   */
  async set(key: SecureKey, value: string): Promise<void> {
    if (!hasSecureEnclave()) {
      webStorage.set(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, options);
  },

  async remove(key: SecureKey): Promise<void> {
    if (!hasSecureEnclave()) {
      webStorage.remove(key);
      return;
    }
    try {
      await SecureStore.deleteItemAsync(key, options);
    } catch {
      // Already gone.
    }
  },

  /** Called on sign-out and on account deletion. */
  async clearAll(): Promise<void> {
    await Promise.all(Object.values(SECURE_KEYS).map((key) => secureStorage.remove(key)));
  },
};
