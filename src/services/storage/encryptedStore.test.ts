import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createEncryptedStore,
  encryptedZustandStorage,
  migratePlaintextToEncrypted,
  storageKeyFor,
} from './encryptedStore';
import { destroyVaultKey, vaultKeyFor } from './vaultCrypto';

/**
 * The record cache.
 *
 * Two properties carry the story: nothing recognisable is left on disk, and one
 * account cannot read another's rows. The migration tests are about the third:
 * that plaintext is only deleted once the encrypted copy has been read back and
 * compared, because a migration that trusts a successful write will one day
 * delete a record whose write silently failed.
 */

const RECORDS = {
  parents: [{ id: 'par_1', fullName: 'Meera Nair', conditions: ['Type 2 diabetes'] }],
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await destroyVaultKey('acc_alice');
  await destroyVaultKey('acc_bob');
});

describe('the encrypted store', () => {
  it('round-trips a record', async () => {
    const store = createEncryptedStore('acc_alice');
    await store.write('parents', RECORDS);

    expect(await store.read('parents')).toEqual(RECORDS);
  });

  /** The assertion the story is for. */
  it('leaves nothing recognisable on disk', async () => {
    await createEncryptedStore('acc_alice').write('parents', RECORDS);

    const stored = await AsyncStorage.getItem(storageKeyFor('acc_alice', 'parents'));

    expect(stored).not.toBeNull();
    expect(stored).not.toContain('Meera');
    expect(stored).not.toContain('diabetes');
    expect(stored).toMatch(/^v1\./);
  });

  it('returns null for a key that was never written', async () => {
    expect(await createEncryptedStore('acc_alice').read('parents')).toBeNull();
  });

  /**
   * Switching accounts on a shared phone. The rows are namespaced *and*
   * encrypted with a different key, so neither the name nor the content
   * crosses.
   */
  it('does not let one account read another’s cache', async () => {
    await createEncryptedStore('acc_alice').write('parents', RECORDS);

    expect(await createEncryptedStore('acc_bob').read('parents')).toBeNull();
  });

  it('does not let one account’s row be decrypted with another’s key', async () => {
    await createEncryptedStore('acc_alice').write('parents', RECORDS);

    // Same logical key, forced into bob's namespace: the envelope is alice's,
    // so bob's key cannot open it and the row is dropped rather than returned.
    const envelope = await AsyncStorage.getItem(storageKeyFor('acc_alice', 'parents'));
    await AsyncStorage.setItem(storageKeyFor('acc_bob', 'parents'), envelope as string);

    expect(await createEncryptedStore('acc_bob').read('parents')).toBeNull();
  });

  it('reports an unreadable row rather than failing silently', async () => {
    const onUnreadable = jest.fn();
    await AsyncStorage.setItem(storageKeyFor('acc_alice', 'parents'), 'v1.bm9wZQ==.bm9wZQ==');

    const value = await createEncryptedStore('acc_alice', { onUnreadable }).read('parents');

    expect(value).toBeNull();
    expect(onUnreadable).toHaveBeenCalledWith('parents', expect.objectContaining({ code: 'unreadable' }));
  });

  /** Retrying a decryption that cannot succeed on every launch helps nobody. */
  it('drops an unreadable row so it is not retried forever', async () => {
    await AsyncStorage.setItem(storageKeyFor('acc_alice', 'parents'), 'v1.bm9wZQ==.bm9wZQ==');
    await createEncryptedStore('acc_alice').read('parents');

    expect(await AsyncStorage.getItem(storageKeyFor('acc_alice', 'parents'))).toBeNull();
  });

  it('clears one account’s rows and leaves the other’s', async () => {
    await createEncryptedStore('acc_alice').write('parents', RECORDS);
    await createEncryptedStore('acc_bob').write('parents', RECORDS);

    await createEncryptedStore('acc_alice').clearAccount();

    expect(await createEncryptedStore('acc_alice').read('parents')).toBeNull();
    expect(await createEncryptedStore('acc_bob').read('parents')).toEqual(RECORDS);
  });

  it('survives a restart, which is the whole point of a cache', async () => {
    await createEncryptedStore('acc_alice').write('parents', RECORDS);

    // A new store instance, as a cold start would build.
    expect(await createEncryptedStore('acc_alice').read('parents')).toEqual(RECORDS);
  });
});

describe('the zustand adapter', () => {
  it('encrypts what the persist middleware hands it', async () => {
    const storage = encryptedZustandStorage('acc_alice');
    await storage.setItem('vault', JSON.stringify(RECORDS));

    const raw = await AsyncStorage.getItem(storageKeyFor('acc_alice', 'vault'));
    expect(raw).not.toContain('Meera');
    expect(await storage.getItem('vault')).toBe(JSON.stringify(RECORDS));
  });

  it('returns null rather than throwing when the value cannot be read', async () => {
    await AsyncStorage.setItem(storageKeyFor('acc_alice', 'vault'), 'not-an-envelope');

    expect(await encryptedZustandStorage('acc_alice').getItem('vault')).toBeNull();
  });
});

describe('migrating plaintext rows', () => {
  const LEGACY = 'ayunetz.v1.parents';

  it('moves a plaintext row into the encrypted layout', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify(RECORDS));

    const result = await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(result.migrated).toEqual([LEGACY]);
    expect(await createEncryptedStore('acc_alice').read('parents')).toEqual(RECORDS);
  });

  it('removes the plaintext only after the encrypted copy reads back', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify(RECORDS));

    await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(await AsyncStorage.getItem(LEGACY)).toBeNull();
  });

  /**
   * The failure this ordering exists for. If the encrypted write does not
   * survive, the plaintext must still be there — a partial migration is
   * recoverable, a partial deletion is not.
   */
  it('keeps the plaintext when the encrypted copy cannot be read back', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify(RECORDS));

    /**
     * A write that reports success and stores nothing — a full disk, a corrupt
     * store. Swapped and restored by hand rather than with `jest.spyOn`:
     * AsyncStorage's own mock is already a `jest.fn`, so `mockRestore` leaves a
     * no-op behind and every later test in this file silently stops writing.
     */
    const original = AsyncStorage.setItem;
    AsyncStorage.setItem = (async () => undefined) as typeof AsyncStorage.setItem;

    let result;
    try {
      result = await migratePlaintextToEncrypted('acc_alice', [LEGACY]);
    } finally {
      AsyncStorage.setItem = original;
    }

    expect(result.failed).toEqual([LEGACY]);
    expect(await AsyncStorage.getItem(LEGACY)).toBe(JSON.stringify(RECORDS));
  });

  it('keeps the plaintext when it cannot be parsed', async () => {
    await AsyncStorage.setItem(LEGACY, 'not json at all');

    const result = await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(result.failed).toEqual([LEGACY]);
    expect(await AsyncStorage.getItem(LEGACY)).toBe('not json at all');
  });

  it('reports a key with nothing under it rather than treating it as a failure', async () => {
    const result = await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(result).toEqual({ migrated: [], failed: [], absent: [LEGACY] });
  });

  it('is a no-op the second time', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify(RECORDS));
    await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    const second = await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(second.absent).toEqual([LEGACY]);
    expect(await createEncryptedStore('acc_alice').read('parents')).toEqual(RECORDS);
  });

  /** An earlier run that was interrupted after writing but before deleting. */
  it('finishes an interrupted run without re-encrypting an envelope', async () => {
    const key = await vaultKeyFor('acc_alice');
    expect(key).toHaveLength(32);
    await AsyncStorage.setItem(LEGACY, 'v1.bm9uY2U=.Y2lwaGVy');

    const result = await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(result.migrated).toEqual([LEGACY]);
    expect(await AsyncStorage.getItem(LEGACY)).toBeNull();
  });

  it('migrates each account into its own namespace', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify(RECORDS));
    await migratePlaintextToEncrypted('acc_alice', [LEGACY]);

    expect(await createEncryptedStore('acc_bob').read('parents')).toBeNull();
  });
});
