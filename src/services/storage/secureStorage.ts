import * as SecureStore from 'expo-secure-store';

/**
 * Keychain / Android Keystore backed storage for anything sensitive:
 * Cognito tokens and the PIN verifier. Never used for record data — that goes
 * through `persistence.ts`.
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

export const secureStorage = {
  async get(key: SecureKey): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, options);
    } catch {
      // A locked or unavailable keychain is treated as "no value" rather than a
      // crash — the caller then falls back to asking the user to sign in.
      return null;
    }
  },

  async set(key: SecureKey, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, options);
  },

  async remove(key: SecureKey): Promise<void> {
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
