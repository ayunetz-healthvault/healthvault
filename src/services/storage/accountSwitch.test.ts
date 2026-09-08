import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  currentVaultAccountId,
  activeVaultStorage,
  closeVault,
  forgetAccountLocally,
  openVaultFor,
} from './activeVault';
import { storageKeyFor } from './encryptedStore';
import { destroyVaultKey, hasVaultKey } from './vaultCrypto';

import { useVaultStore, closeVaultInMemory, hydrateVaultForAccount } from '@/state/vaultStore';
import type { ParentProfile } from '@/types/domain';

/**
 * Switching accounts on one phone.
 *
 * The failure this guards against is the one a user would notice immediately
 * and never forgive: signing in as somebody else and seeing the previous
 * person's parents, medicines and reports. It was possible before this change,
 * because the vault's storage keys were global and its contents were plaintext.
 */

const parent = (id: string, fullName: string): ParentProfile => ({
  id,
  fullName,
  relationship: 'mother',
  dateOfBirth: '1957-04-02',
  bloodGroup: 'O+',
  city: 'Kochi',
  phone: '',
  conditions: ['Type 2 diabetes'],
  allergies: [],
  primaryDoctor: '',
  notes: '',
  avatarColor: '#145B48',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** Writes through the store, then waits for the persist middleware to land it. */
const saveParent = async (record: ParentProfile): Promise<void> => {
  useVaultStore.setState({ parents: [record] });
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await destroyVaultKey('acc_alice');
  await destroyVaultKey('acc_bob');
  closeVault();
  closeVaultInMemory();
});

describe('signing in', () => {
  it('reads the account’s own records back after a restart', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    // A cold start: detach, clear memory, same account signs in again. The
    // order is the point — clearing while still attached would write the empty
    // vault over what was just saved.
    closeVault();
    closeVaultInMemory();
    await openVaultFor('acc_alice');
    await hydrateVaultForAccount();

    expect(useVaultStore.getState().parents.map((entry) => entry.fullName)).toEqual(['Meera Nair']);
  });

  /** The one that matters. */
  it('does not show one account the other’s records', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    await openVaultFor('acc_bob');
    await hydrateVaultForAccount();

    expect(useVaultStore.getState().parents).toEqual([]);
  });

  it('leaves the first account’s records intact while the second is signed in', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    await openVaultFor('acc_bob');
    await hydrateVaultForAccount();
    await saveParent(parent('par_2', 'Ravi Nair'));

    await openVaultFor('acc_alice');
    await hydrateVaultForAccount();

    expect(useVaultStore.getState().parents.map((entry) => entry.fullName)).toEqual(['Meera Nair']);
  });

  it('writes nothing recognisable to disk', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    const raw = await AsyncStorage.getItem(storageKeyFor('acc_alice', 'vault'));

    expect(raw).not.toBeNull();
    expect(raw).not.toContain('Meera');
    expect(raw).not.toContain('diabetes');
  });
});

describe('signing out', () => {
  it('clears the records from memory', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    closeVault();
    closeVaultInMemory();

    expect(useVaultStore.getState().parents).toEqual([]);
  });

  /**
   * Deliberately not destructive. The rows are unreadable to anyone else, and
   * signing back in a minute later should not mean re-downloading everything.
   */
  it('keeps the records on the device for the next sign-in', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    closeVault();
    closeVaultInMemory();
    await openVaultFor('acc_alice');
    await hydrateVaultForAccount();

    expect(useVaultStore.getState().parents).toHaveLength(1);
  });

  it('writes nothing at all while signed out', async () => {
    closeVault();
    await activeVaultStorage.setItem('vault', JSON.stringify({ state: { parents: [] } }));

    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(currentVaultAccountId()).toBeNull();
  });

  it('reads nothing at all while signed out', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));
    closeVault();

    expect(await activeVaultStorage.getItem('vault')).toBeNull();
  });
});

describe('forgetting an account on this device', () => {
  it('destroys the key and the rows', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    await forgetAccountLocally('acc_alice');

    expect(await hasVaultKey('acc_alice')).toBe(false);
    expect(await AsyncStorage.getItem(storageKeyFor('acc_alice', 'vault'))).toBeNull();
  });

  it('leaves the other account on the phone alone', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));
    await openVaultFor('acc_bob');
    await hydrateVaultForAccount();
    await saveParent(parent('par_2', 'Ravi Nair'));

    await forgetAccountLocally('acc_alice');

    expect(await hasVaultKey('acc_bob')).toBe(true);
    expect(await AsyncStorage.getItem(storageKeyFor('acc_bob', 'vault'))).not.toBeNull();
  });

  /**
   * The key first, so an interruption leaves ciphertext nobody can read rather
   * than a half-deleted readable vault.
   */
  it('leaves anything it could not delete unreadable', async () => {
    await openVaultFor('acc_alice');
    await saveParent(parent('par_1', 'Meera Nair'));

    await forgetAccountLocally('acc_alice');
    // Even if a row had survived, there is no key to open it.
    expect(await hasVaultKey('acc_alice')).toBe(false);
  });
});
