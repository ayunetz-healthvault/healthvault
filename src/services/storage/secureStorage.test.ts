import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { SECURE_KEYS, hasSecureEnclave, secureStorage } from './secureStorage';

/**
 * The web fallback exists because `expo-secure-store`'s web build is
 * `export default {}` — every call throws. That took down sign-in in a browser
 * preview once; these tests make sure it stays fixed.
 */

const setPlatform = (os: 'ios' | 'android' | 'web'): void => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
};

const originalPlatform = Platform.OS;

afterEach(() => {
  setPlatform(originalPlatform as 'ios' | 'android' | 'web');
  jest.clearAllMocks();
  globalThis.localStorage?.clear?.();
});

describe('hasSecureEnclave', () => {
  it('is true on a device', () => {
    setPlatform('ios');
    expect(hasSecureEnclave()).toBe(true);
  });

  it('is false on web, where there is no keychain', () => {
    setPlatform('web');
    expect(hasSecureEnclave()).toBe(false);
  });
});

describe('on a device', () => {
  beforeEach(() => setPlatform('ios'));

  it('reads and writes through SecureStore', async () => {
    await secureStorage.set(SECURE_KEYS.idToken, 'token-1');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_KEYS.idToken,
      'token-1',
      expect.objectContaining({ keychainAccessible: expect.anything() }),
    );
    await expect(secureStorage.get(SECURE_KEYS.idToken)).resolves.toBe('token-1');
  });

  it('treats an unreadable keychain as "no value" rather than crashing', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

    await expect(secureStorage.get(SECURE_KEYS.idToken)).resolves.toBeNull();
  });

  it('does NOT swallow a failed write — a lost token must surface', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain full'));

    await expect(secureStorage.set(SECURE_KEYS.idToken, 'token-1')).rejects.toThrow(
      'keychain full',
    );
  });

  it('tolerates deleting something that is already gone', async () => {
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('not found'));

    await expect(secureStorage.remove(SECURE_KEYS.idToken)).resolves.toBeUndefined();
  });
});

describe('on web', () => {
  beforeEach(() => setPlatform('web'));

  it('stores and retrieves without touching SecureStore', async () => {
    await secureStorage.set(SECURE_KEYS.idToken, 'token-web');

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    await expect(secureStorage.get(SECURE_KEYS.idToken)).resolves.toBe('token-web');
  });

  it('does not throw on write — this is what broke sign-in', async () => {
    await expect(secureStorage.set(SECURE_KEYS.pinVerifier, 'digest')).resolves.toBeUndefined();
  });

  it('returns null for a key that was never set', async () => {
    await expect(secureStorage.get(SECURE_KEYS.refreshToken)).resolves.toBeNull();
  });

  it('removes a single key', async () => {
    await secureStorage.set(SECURE_KEYS.idToken, 'token-web');
    await secureStorage.remove(SECURE_KEYS.idToken);

    await expect(secureStorage.get(SECURE_KEYS.idToken)).resolves.toBeNull();
  });

  it('clears every key on sign-out', async () => {
    await secureStorage.set(SECURE_KEYS.idToken, 'a');
    await secureStorage.set(SECURE_KEYS.accessToken, 'b');
    await secureStorage.set(SECURE_KEYS.pinVerifier, 'c');

    await secureStorage.clearAll();

    for (const key of Object.values(SECURE_KEYS)) {
      await expect(secureStorage.get(key)).resolves.toBeNull();
    }
  });
});
