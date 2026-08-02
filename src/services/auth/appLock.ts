import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

import { SECURE_KEYS, secureStorage } from '../storage/secureStorage';

import type { AppLockMethod } from '@/types/domain';

/**
 * App lock — biometric with a PIN fallback.
 *
 * Architecture note: the PIN is never stored. We store a random salt plus
 * SHA-256(salt + pin) in the Keychain/Keystore and compare digests. That keeps
 * the door open for the production upgrade path below without changing any
 * call site.
 *
 * TODO(security): before handling real records, move to a KDF with a work
 * factor (PBKDF2/scrypt/Argon2 via a native module) — a 4-digit PIN behind a
 * single SHA-256 round is brute-forceable if the Keystore is ever dumped. Also
 * add an attempt counter that wipes the local cache after N failures.
 */

export const PIN_LENGTH = 6;
/** Failed PIN attempts before the UI forces a full re-authentication. */
export const MAX_PIN_ATTEMPTS = 5;

export interface BiometricCapability {
  /** Device has fingerprint/face hardware. */
  hasHardware: boolean;
  /** User has actually enrolled a fingerprint or face. */
  isEnrolled: boolean;
  /** Copy for the button, e.g. "Use Face ID" / "Use fingerprint". */
  label: string;
  available: boolean;
}

const describe = (types: LocalAuthentication.AuthenticationType[]): string => {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return 'Use face unlock';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return 'Use fingerprint';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return 'Use iris scan';
  }
  return 'Use device unlock';
};

const hashPin = async (pin: string, salt: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`, {
    encoding: Crypto.CryptoEncoding.HEX,
  });

const randomSalt = async (): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export const isValidPinFormat = (pin: string): boolean =>
  new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

export const appLock = {
  async getBiometricCapability(): Promise<BiometricCapability> {
    try {
      const [hasHardware, isEnrolled, types] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);
      return {
        hasHardware,
        isEnrolled,
        label: describe(types),
        available: hasHardware && isEnrolled,
      };
    } catch {
      return {
        hasHardware: false,
        isEnrolled: false,
        label: 'Use device unlock',
        available: false,
      };
    }
  },

  async authenticateWithBiometrics(reason = 'Unlock your family health vault'): Promise<boolean> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        // Let the OS offer the device passcode; the app PIN is our own fallback.
        fallbackLabel: 'Use PIN instead',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      return result.success;
    } catch {
      return false;
    }
  },

  async setPin(pin: string): Promise<void> {
    if (!isValidPinFormat(pin)) {
      throw new Error(`PIN must be exactly ${PIN_LENGTH} digits.`);
    }
    const salt = await randomSalt();
    const verifier = await hashPin(pin, salt);
    await secureStorage.set(SECURE_KEYS.pinSalt, salt);
    await secureStorage.set(SECURE_KEYS.pinVerifier, verifier);
  },

  async hasPin(): Promise<boolean> {
    return (await secureStorage.get(SECURE_KEYS.pinVerifier)) !== null;
  },

  async verifyPin(pin: string): Promise<boolean> {
    const [salt, verifier] = await Promise.all([
      secureStorage.get(SECURE_KEYS.pinSalt),
      secureStorage.get(SECURE_KEYS.pinVerifier),
    ]);
    if (!salt || !verifier) return false;
    return (await hashPin(pin, salt)) === verifier;
  },

  async clearPin(): Promise<void> {
    await secureStorage.remove(SECURE_KEYS.pinSalt);
    await secureStorage.remove(SECURE_KEYS.pinVerifier);
  },

  /**
   * Resolves the lock method the device can actually honour. A profile asking
   * for biometrics on a phone with nothing enrolled falls back to the PIN.
   */
  async resolveEffectiveMethod(preferred: AppLockMethod): Promise<AppLockMethod> {
    if (preferred === 'none') return 'none';
    if (preferred === 'biometric') {
      const capability = await appLock.getBiometricCapability();
      if (capability.available) return 'biometric';
      return (await appLock.hasPin()) ? 'pin' : 'none';
    }
    return (await appLock.hasPin()) ? 'pin' : 'none';
  },
};
