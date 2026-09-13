import {
  decryptWithKey,
  describeKeyLoss,
  destroyVaultKey,
  encryptWithKey,
  hasVaultKey,
  isEncryptedEnvelope,
  vaultKeyFor,
  VaultCryptoError,
} from './vaultCrypto';

import { SECURE_KEYS, secureStorage } from './secureStorage';

/**
 * Record encryption.
 *
 * The assertions to care about are the ones that show a *wrong* key fails
 * rather than producing something plausible, and that a fixture value cannot be
 * found in what gets written to disk. The rest of this file is the mechanics
 * those two rest on.
 */

beforeEach(async () => {
  await secureStorage.clearAll();
  await destroyVaultKey('acc_alice');
  await destroyVaultKey('acc_bob');
});

describe('vault keys', () => {
  it('creates a key on first use and returns the same one afterwards', async () => {
    const first = await vaultKeyFor('acc_alice');
    const second = await vaultKeyFor('acc_alice');

    expect(first).toHaveLength(32);
    expect([...second]).toEqual([...first]);
  });

  /** Two accounts on one phone must not be able to read each other's cache. */
  it('gives different accounts different keys', async () => {
    const alice = await vaultKeyFor('acc_alice');
    const bob = await vaultKeyFor('acc_bob');

    expect([...alice]).not.toEqual([...bob]);
  });

  it('reports whether an account has a key yet', async () => {
    expect(await hasVaultKey('acc_alice')).toBe(false);
    await vaultKeyFor('acc_alice');
    expect(await hasVaultKey('acc_alice')).toBe(true);
  });

  it('destroys one account’s key without touching another’s', async () => {
    await vaultKeyFor('acc_alice');
    await vaultKeyFor('acc_bob');

    await destroyVaultKey('acc_alice');

    expect(await hasVaultKey('acc_alice')).toBe(false);
    expect(await hasVaultKey('acc_bob')).toBe(true);
  });

  /**
   * Signing out of one account on a shared phone must not wipe the other's
   * cached records.
   */
  it('survives the sign-out clear, which only removes session credentials', async () => {
    await vaultKeyFor('acc_alice');
    await secureStorage.set(SECURE_KEYS.idToken, 'token');

    await secureStorage.clearAll();

    expect(await secureStorage.get(SECURE_KEYS.idToken)).toBeNull();
    expect(await hasVaultKey('acc_alice')).toBe(true);
  });

  it('refuses a stored key of the wrong length rather than replacing it', async () => {
    await secureStorage.set(`${SECURE_KEYS.vaultKeyPrefix}acc_alice`, 'dG9vLXNob3J0');

    await expect(vaultKeyFor('acc_alice')).rejects.toMatchObject({ code: 'no_key' });
  });
});

describe('encrypt and decrypt', () => {
  const plaintext = JSON.stringify({
    parents: [{ fullName: 'Meera Nair', conditions: ['Type 2 diabetes'] }],
  });

  it('round-trips a record', async () => {
    const key = await vaultKeyFor('acc_alice');

    expect(decryptWithKey(key, encryptWithKey(key, plaintext))).toBe(plaintext);
  });

  /** The assertion this whole module exists for. */
  it('leaves no fixture value readable in what would be written to disk', async () => {
    const key = await vaultKeyFor('acc_alice');
    const envelope = encryptWithKey(key, plaintext);

    expect(envelope).not.toContain('Meera');
    expect(envelope).not.toContain('diabetes');
    expect(envelope).not.toContain('parents');
  });

  it('produces a different envelope every time, so equal records are not equal on disk', async () => {
    const key = await vaultKeyFor('acc_alice');

    expect(encryptWithKey(key, plaintext)).not.toBe(encryptWithKey(key, plaintext));
  });

  /**
   * Not "returns nonsense" — fails. A cipher without authentication would
   * decrypt to something, and something plausible in place of a medicine list
   * is far worse than an error.
   */
  it('fails rather than returning a plausible value under the wrong key', async () => {
    const alice = await vaultKeyFor('acc_alice');
    const bob = await vaultKeyFor('acc_bob');
    const envelope = encryptWithKey(alice, plaintext);

    expect(() => decryptWithKey(bob, envelope)).toThrow(VaultCryptoError);
    expect(() => decryptWithKey(bob, envelope)).toThrow(/could not be decrypted/i);
  });

  it('detects a tampered ciphertext', async () => {
    const key = await vaultKeyFor('acc_alice');
    const envelope = encryptWithKey(key, plaintext);
    const [version, nonce, ciphertext] = envelope.split('.') as [string, string, string];

    // Flip one character of the ciphertext.
    const flipped = `${ciphertext.slice(0, -2)}${ciphertext.at(-2) === 'A' ? 'B' : 'A'}${ciphertext.at(-1)}`;

    expect(() => decryptWithKey(key, `${version}.${nonce}.${flipped}`)).toThrow(VaultCryptoError);
  });

  it('rejects a value that is not an envelope at all', async () => {
    const key = await vaultKeyFor('acc_alice');

    expect(() => decryptWithKey(key, '{"parents":[]}')).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
  });

  /** A value from a newer build must fail loudly, not be treated as corrupt. */
  it('names an envelope version it cannot read', async () => {
    const key = await vaultKeyFor('acc_alice');
    const envelope = encryptWithKey(key, plaintext);

    expect(() => decryptWithKey(key, envelope.replace(/^v1\./, 'v99.'))).toThrow(
      expect.objectContaining({ code: 'unsupported_version' }),
    );
  });

  it('round-trips an empty value and a large one', async () => {
    const key = await vaultKeyFor('acc_alice');
    const large = JSON.stringify({ notes: 'x'.repeat(200_000) });

    expect(decryptWithKey(key, encryptWithKey(key, ''))).toBe('');
    expect(decryptWithKey(key, encryptWithKey(key, large))).toBe(large);
  });

  it('round-trips non-ASCII text, which health records contain', async () => {
    const key = await vaultKeyFor('acc_alice');
    const malayalam = JSON.stringify({ note: 'ഡോക്ടറെ കാണണം', name: 'Meera Nair' });

    expect(decryptWithKey(key, encryptWithKey(key, malayalam))).toBe(malayalam);
  });
});

describe('isEncryptedEnvelope', () => {
  it('recognises its own output and rejects plaintext JSON', async () => {
    const key = await vaultKeyFor('acc_alice');

    expect(isEncryptedEnvelope(encryptWithKey(key, '{}'))).toBe(true);
    expect(isEncryptedEnvelope('{"parents":[]}')).toBe(false);
    expect(isEncryptedEnvelope('')).toBe(false);
  });
});

describe('describeKeyLoss', () => {
  /**
   * The wording is the promise. "Your records are lost" would be false — the
   * backend still has them — and a blank success state would be worse.
   */
  it('says what is actually gone, and what is not', () => {
    const message = describeKeyLoss();

    expect(message).toMatch(/download again/i);
    expect(message).toMatch(/had not finished syncing/i);
    expect(message).not.toMatch(/your records are lost/i);
  });
});
