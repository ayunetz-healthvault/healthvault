import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import * as Crypto from 'expo-crypto';

import { SECURE_KEYS, secureStorage, type SecureKey } from './secureStorage';

/**
 * Encryption for anything clinical held on the device.
 *
 * ## Why a library, and why this one
 *
 * Expo ships no symmetric cipher. `expo-crypto` provides digests and random
 * bytes and nothing that encrypts, so meeting KOO-04 needs a dependency.
 *
 * `@noble/ciphers` is audited, has no dependencies of its own, and is pure
 * TypeScript — which matters here because this app is a managed Expo project
 * with no `android/` or `ios/` directory. A native module such as
 * `react-native-quick-crypto` would be faster and would force a prebuild;
 * records are JSON of a few kilobytes, so the speed is irrelevant and the
 * build change is not.
 *
 * ## XChaCha20-Poly1305
 *
 * Authenticated, so a modified ciphertext fails to decrypt rather than
 * decrypting to something plausible — the failure mode that matters when the
 * plaintext is somebody's medicine list.
 *
 * The 192-bit nonce is why it is XChaCha rather than ChaCha: nonces are drawn
 * at random on every write, and at 96 bits a birthday collision after a few
 * million writes is a real number. At 192 bits it is not.
 *
 * ## What this does not protect against
 *
 * A compromised device with the app unlocked. The key lives in the Keychain or
 * Keystore, and anything that can run as this app can ask for it. What it does
 * protect is the case this is actually for: a phone's file system read by
 * something that is not this app — a backup, a rooted device, a forensic dump —
 * where AsyncStorage is plain JSON on disk.
 *
 * **The app lock is not this.** A PIN gates the UI; it does not encrypt a byte.
 * See `appLock.ts`, which says the same thing from the other side.
 */

/** Bumped if the envelope format or the cipher ever changes. */
const ENVELOPE_VERSION = 1;

const KEY_BYTES = 32;
const NONCE_BYTES = 24;

/**
 * Envelope: `v1.<base64 nonce>.<base64 ciphertext>`.
 *
 * Version first so a future format is recognisable before anything tries to
 * decrypt it, and so a value written by a newer build fails loudly on an older
 * one rather than being treated as corrupt and dropped.
 */
const ENVELOPE_PATTERN = /^v(\d+)\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]*)$/;

export class VaultCryptoError extends Error {
  readonly code: 'no_key' | 'unreadable' | 'unsupported_version';

  constructor(code: VaultCryptoError['code'], message: string) {
    super(message);
    this.name = 'VaultCryptoError';
    this.code = code;
  }
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/**
 * The key for one account.
 *
 * Per account, not per device. Two accounts on one phone get different keys, so
 * "sign out and sign in as somebody else" cannot read what the previous account
 * cached even if a stale row survives — the wrong key produces an
 * authentication failure, not a plausible plaintext.
 */
const keyNameFor = (accountId: string): SecureKey =>
  `${SECURE_KEYS.vaultKeyPrefix}${accountId}` as SecureKey;

/**
 * Reads the account's key, creating one on first use.
 *
 * Generated on the device and never sent anywhere. There is deliberately no
 * escrow and no recovery: a key that can be recovered from a server is a key
 * the server can read the records with. The consequence is stated plainly in
 * `describeKeyLoss` and surfaced in the UI — losing the key means re-syncing
 * from the backend, not losing the record.
 */
export const vaultKeyFor = async (accountId: string): Promise<Uint8Array> => {
  const name = keyNameFor(accountId);
  const existing = await secureStorage.get(name);
  if (existing !== null) {
    const bytes = fromBase64(existing);
    if (bytes.length === KEY_BYTES) return bytes;
    // A key of the wrong length is not a key. Replacing it silently would
    // orphan whatever it encrypted, so this is loud.
    throw new VaultCryptoError('no_key', 'The stored vault key is not usable.');
  }

  const created = Crypto.getRandomBytes(KEY_BYTES);
  await secureStorage.set(name, toBase64(created));
  return created;
};

export const hasVaultKey = async (accountId: string): Promise<boolean> =>
  (await secureStorage.get(keyNameFor(accountId))) !== null;

/**
 * Destroys an account's key.
 *
 * Everything it encrypted becomes unreadable immediately — which is the point.
 * On sign-out this is faster and more complete than deleting rows one by one,
 * and it cannot half-succeed and leave a readable remainder.
 */
export const destroyVaultKey = async (accountId: string): Promise<void> => {
  await secureStorage.remove(keyNameFor(accountId));
};

export const encryptWithKey = (key: Uint8Array, plaintext: string): string => {
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  return `v${ENVELOPE_VERSION}.${toBase64(nonce)}.${toBase64(ciphertext)}`;
};

export const decryptWithKey = (key: Uint8Array, envelope: string): string => {
  const match = ENVELOPE_PATTERN.exec(envelope);
  if (match === null) {
    throw new VaultCryptoError('unreadable', 'Stored value is not an encrypted envelope.');
  }

  const [, version, nonce, ciphertext] = match as unknown as [string, string, string, string];
  if (Number(version) !== ENVELOPE_VERSION) {
    throw new VaultCryptoError(
      'unsupported_version',
      `Stored value uses envelope version ${version}, which this build cannot read.`,
    );
  }

  try {
    return bytesToUtf8(
      xchacha20poly1305(key, fromBase64(nonce)).decrypt(fromBase64(ciphertext)),
    );
  } catch {
    // Wrong key, or tampering. Both mean "do not trust this value", and neither
    // is distinguishable from the other — nor should it be.
    throw new VaultCryptoError('unreadable', 'Stored value could not be decrypted.');
  }
};

/** True for anything this module wrote. Used to tell migrated rows from old ones. */
export const isEncryptedEnvelope = (value: string): boolean => ENVELOPE_PATTERN.test(value);

/**
 * What happens if the key is gone, in the words the UI uses.
 *
 * Kept next to the code that would cause it so the promise and the mechanism
 * cannot drift. Never "your records are lost": the backend still has them, and
 * anything that had not synced is what is actually gone.
 */
export const describeKeyLoss = (): string =>
  'The records saved on this phone could not be opened, so they were cleared. ' +
  'Anything already synced will download again when you sign in. Anything that ' +
  'had not finished syncing is no longer on this device.';
