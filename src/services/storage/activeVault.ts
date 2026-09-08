import AsyncStorage from '@react-native-async-storage/async-storage';

import { encryptedZustandStorage, migratePlaintextToEncrypted } from './encryptedStore';
import { STORAGE_KEYS } from './persistence';
import { clearOriginals } from './protectedFiles';
import { destroyVaultKey, type VaultCryptoError } from './vaultCrypto';

/**
 * Which account's vault is currently open.
 *
 * Zustand's `persist` middleware takes its storage once, at store creation,
 * long before anybody has signed in. This is the indirection that lets the
 * storage follow the account: the adapter below asks *at call time* who is
 * signed in, so the same store reads and writes a different, separately
 * encrypted namespace for each one.
 *
 * While nobody is signed in it reads and writes nothing. That is not a
 * degraded mode — an app with no session has no business holding decrypted
 * medical records in memory, let alone writing them.
 */

let activeAccountId: string | null = null;
let reportUnreadable: ((key: string, error: VaultCryptoError) => void) | null = null;

/**
 * The account whose vault is open, or null while signed out.
 *
 * Read by anything that needs to file something under the current account —
 * captured pages, for one — so there is a single answer rather than each
 * caller threading an id down from wherever it happened to have one.
 */
export const currentVaultAccountId = (): string | null => activeAccountId;

/** Called when a cached row cannot be decrypted, so the UI can explain it. */
export const onVaultUnreadable = (
  handler: ((key: string, error: VaultCryptoError) => void) | null,
): void => {
  reportUnreadable = handler;
};

/**
 * Opens an account's vault.
 *
 * Migrates any plaintext rows left by an earlier build first, so the first read
 * after an upgrade finds the records rather than an empty vault. The migration
 * verifies before deleting — see `migratePlaintextToEncrypted`.
 */
export const openVaultFor = async (accountId: string): Promise<void> => {
  activeAccountId = accountId;
  await migratePlaintextToEncrypted(accountId, Object.values(STORAGE_KEYS));
};

/**
 * Closes the vault on sign-out.
 *
 * Only detaches. It deliberately does **not** delete the account's rows: a
 * caregiver who signs out on a shared phone and back in a minute later should
 * not have to re-download every record, and the rows are unreadable to anyone
 * else anyway — different account, different key.
 *
 * `forget` is the stronger form, for account deletion and for a local wipe.
 */
export const closeVault = (): void => {
  activeAccountId = null;
};

/**
 * Destroys everything about an account on this device.
 *
 * The key goes first. Once it is gone the cached rows are ciphertext nobody can
 * open, so an interruption after this point leaves unreadable bytes rather than
 * a half-deleted readable vault.
 */
export const forgetAccountLocally = async (accountId: string): Promise<void> => {
  await destroyVaultKey(accountId);

  const all = await AsyncStorage.getAllKeys();
  const mine = all.filter((key) => key.startsWith(`ayunetz.${accountId}.`));
  if (mine.length > 0) await AsyncStorage.multiRemove(mine);

  try {
    clearOriginals(accountId);
  } catch {
    // A file system that will not delete is worth knowing about, but the key is
    // already gone: the records are unreadable whether or not the bytes remain.
  }

  if (activeAccountId === accountId) activeAccountId = null;
};

/**
 * The storage zustand's `persist` middleware is given.
 *
 * Every method resolves the account at call time, so signing in as somebody
 * else changes what the same store reads without the store knowing anything
 * about accounts.
 */
export const activeVaultStorage = {
  async getItem(name: string): Promise<string | null> {
    if (activeAccountId === null) return null;
    return encryptedZustandStorage(activeAccountId, {
      ...(reportUnreadable === null ? {} : { onUnreadable: reportUnreadable }),
    }).getItem(name);
  },

  async setItem(name: string, value: string): Promise<void> {
    // Signed out: drop it. Writing to a namespace nobody owns would leave
    // records on the device with no key that opens them and no account to
    // clear them.
    if (activeAccountId === null) return;
    await encryptedZustandStorage(activeAccountId).setItem(name, value);
  },

  async removeItem(name: string): Promise<void> {
    if (activeAccountId === null) return;
    await encryptedZustandStorage(activeAccountId).removeItem(name);
  },
};
