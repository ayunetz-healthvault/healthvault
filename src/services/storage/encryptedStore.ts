import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  decryptWithKey,
  encryptWithKey,
  isEncryptedEnvelope,
  vaultKeyFor,
  VaultCryptoError,
} from './vaultCrypto';

/**
 * The record cache: encrypted, and partitioned by account.
 *
 * Replaces the plaintext AsyncStorage the vault used to write to. Two changes,
 * and both matter:
 *
 * 1. **Every value is encrypted** with the account's key. AsyncStorage is plain
 *    JSON on disk, readable by anything that can read the file system — a
 *    backup, a rooted device, a forensic image.
 * 2. **Every key is namespaced by account.** The old keys were global, so two
 *    accounts on one phone shared one cache. Signing out cleared the session
 *    and left the records; the next account opened the app and saw them.
 *
 * The name is still recognisable in a storage dump — `ayunetz.acc_x.v2.parents`
 * says an account has parent records. That is metadata, and it is the trade for
 * being able to enumerate and clear one account's rows without decrypting them.
 * The contents are what must not leak, and they do not.
 */

/** Bumped alongside the envelope; `v1` keys are the plaintext generation. */
const GENERATION = 'v2';

const PREFIX = 'ayunetz';

/**
 * A namespaced key.
 *
 * `logicalKey` is the old unqualified name — `parents`, `documents` — so the
 * mapping from the previous layout is legible rather than a lookup table.
 */
export const storageKeyFor = (accountId: string, logicalKey: string): string =>
  `${PREFIX}.${accountId}.${GENERATION}.${logicalKey}`;

const accountPrefix = (accountId: string): string => `${PREFIX}.${accountId}.`;

export interface EncryptedStore {
  read<T>(logicalKey: string): Promise<T | null>;
  write<T>(logicalKey: string, value: T): Promise<void>;
  remove(logicalKey: string): Promise<void>;
  /** Everything this account has cached. Used on sign-out and on wipe. */
  clearAccount(): Promise<void>;
}

export interface EncryptedStoreOptions {
  /**
   * Called when a stored value cannot be decrypted.
   *
   * Separated from the read so the policy — drop it, tell the user, resync —
   * lives with the UI rather than being decided here by whatever felt safe.
   */
  onUnreadable?: (logicalKey: string, error: VaultCryptoError) => void;
}

export const createEncryptedStore = (
  accountId: string,
  { onUnreadable }: EncryptedStoreOptions = {},
): EncryptedStore => {
  const keyed = (logicalKey: string): string => storageKeyFor(accountId, logicalKey);

  return {
    async read<T>(logicalKey: string): Promise<T | null> {
      const raw = await AsyncStorage.getItem(keyed(logicalKey));
      if (raw === null) return null;

      try {
        const key = await vaultKeyFor(accountId);
        return JSON.parse(decryptWithKey(key, raw)) as T;
      } catch (error) {
        /**
         * An unreadable row is dropped, not kept.
         *
         * Leaving it means every launch retries a decryption that cannot
         * succeed. Dropping it loses only the cache — the backend still has the
         * record — which is why this is safe here and would not be if this were
         * the only copy.
         */
        await AsyncStorage.removeItem(keyed(logicalKey)).catch(() => undefined);
        if (error instanceof VaultCryptoError) onUnreadable?.(logicalKey, error);
        return null;
      }
    },

    async write<T>(logicalKey: string, value: T): Promise<void> {
      const key = await vaultKeyFor(accountId);
      await AsyncStorage.setItem(keyed(logicalKey), encryptWithKey(key, JSON.stringify(value)));
    },

    async remove(logicalKey: string): Promise<void> {
      await AsyncStorage.removeItem(keyed(logicalKey));
    },

    async clearAccount(): Promise<void> {
      const all = await AsyncStorage.getAllKeys();
      const mine = all.filter((key) => key.startsWith(accountPrefix(accountId)));
      if (mine.length > 0) await AsyncStorage.multiRemove(mine);
    },
  };
};

/**
 * Adapter for zustand's `persist` middleware.
 *
 * `persist` hands whole-store JSON through `setItem`, so encryption here covers
 * every entity the store holds without each one having to remember.
 */
export const encryptedZustandStorage = (
  accountId: string,
  options: EncryptedStoreOptions = {},
): {
  getItem: (name: string) => Promise<string | null>;
  setItem: (name: string, value: string) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
} => ({
  async getItem(name) {
    const raw = await AsyncStorage.getItem(storageKeyFor(accountId, name));
    if (raw === null) return null;
    try {
      return decryptWithKey(await vaultKeyFor(accountId), raw);
    } catch (error) {
      await AsyncStorage.removeItem(storageKeyFor(accountId, name)).catch(() => undefined);
      if (error instanceof VaultCryptoError) options.onUnreadable?.(name, error);
      return null;
    }
  },

  async setItem(name, value) {
    await AsyncStorage.setItem(
      storageKeyFor(accountId, name),
      encryptWithKey(await vaultKeyFor(accountId), value),
    );
  },

  async removeItem(name) {
    await AsyncStorage.removeItem(storageKeyFor(accountId, name));
  },
});

export interface MigrationResult {
  readonly migrated: string[];
  /** Keys that were read but could not be re-read after encryption. */
  readonly failed: string[];
  /** Keys with nothing stored under the old name. */
  readonly absent: string[];
}

/**
 * Moves plaintext rows into the encrypted, account-scoped layout.
 *
 * ## Verify before deleting
 *
 * Each row is encrypted, written, **read back and compared**, and only then is
 * the plaintext removed. A migration that deletes on the strength of a
 * successful `setItem` will one day delete a row whose write silently failed —
 * a full disk, a corrupt store — and the record is gone.
 *
 * On failure the plaintext stays exactly where it is. The app carries on
 * reading it through the old path, and the next launch tries again. A partial
 * migration is a recoverable state; a partial deletion is not.
 *
 * ## Idempotent
 *
 * Absent keys are reported and skipped, so a second run is a no-op rather than
 * an error.
 */
export const migratePlaintextToEncrypted = async (
  accountId: string,
  legacyKeys: readonly string[],
): Promise<MigrationResult> => {
  const migrated: string[] = [];
  const failed: string[] = [];
  const absent: string[] = [];

  const store = createEncryptedStore(accountId);

  for (const legacyKey of legacyKeys) {
    const raw = await AsyncStorage.getItem(legacyKey);
    if (raw === null) {
      absent.push(legacyKey);
      continue;
    }

    // Already migrated by an interrupted earlier run: the value is an envelope
    // rather than JSON. Leave it, and let the delete below finish the job.
    if (isEncryptedEnvelope(raw)) {
      await AsyncStorage.removeItem(legacyKey);
      migrated.push(legacyKey);
      continue;
    }

    const logicalKey = legacyKey.replace(/^ayunetz\.v1\./, '');

    try {
      const parsed: unknown = JSON.parse(raw);
      await store.write(logicalKey, parsed);

      const readBack = await store.read<unknown>(logicalKey);
      if (JSON.stringify(readBack) !== JSON.stringify(parsed)) {
        failed.push(legacyKey);
        continue;
      }

      await AsyncStorage.removeItem(legacyKey);
      migrated.push(legacyKey);
    } catch {
      // Unparseable, unwritable, or unreadable afterwards. The plaintext stays.
      failed.push(legacyKey);
    }
  }

  return { migrated, failed, absent };
};
