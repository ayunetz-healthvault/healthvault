# ADR-006 — On-Device Record Encryption and Account Partitioning

- **Status:** Accepted for KOO-04. Unverified on a device — see "Consequences".
- **Date:** 2026-09-08
- **Owners:** Ayunetz Health Vault
- **Decision type:** Client security and storage
- **Supersedes:** the `TODO(security)` in `src/services/storage/persistence.ts`

## Context

Records were persisted with zustand's `persist` middleware over AsyncStorage.
Two problems, and the second is the worse one.

**AsyncStorage is plaintext.** On Android it is a SQLite file in the app's data
directory; on iOS a plist. Anything that can read the file system — a rooted or
jailbroken device, an unencrypted backup, a forensic image — reads the parents,
the conditions, the medicine names.

**The keys were global.** `ayunetz.v1.parents` and the rest were not namespaced
by account, so two accounts on one phone shared one cache. Signing out cleared
the session and left the records; the next account signed in and saw them. That
is not a subtle bug, and with shared family records arriving in KOO-03 it stops
being hypothetical.

There is also a standing confusion worth ending: the app lock is not encryption.
It gates the UI and encrypts nothing, and the settings screen now says so.

## Decision

### 1. XChaCha20-Poly1305, from `@noble/ciphers`

Expo ships no symmetric cipher — `expo-crypto` does digests and random bytes —
so this needs a dependency.

`@noble/ciphers` is audited, has no dependencies of its own, and is pure
TypeScript. That last part decides it: this is a managed Expo project with no
`android/` or `ios/` directory, and a native module such as
`react-native-quick-crypto` would force a prebuild. Records are JSON of a few
kilobytes; the speed difference does not matter and the build change does.

Authenticated encryption, so a modified ciphertext fails rather than decrypting
to something plausible — the failure mode that matters when the plaintext is
somebody's medicine list. XChaCha rather than ChaCha for the 192-bit nonce:
nonces are random per write, and at 96 bits a birthday collision after a few
million writes is a real number.

### 2. One key per account, in SecureStore, generated on the device

`ayunetz.vault.key.<accountId>`, 32 bytes from the CSPRNG. SecureStore holds
**keys, not payloads** — the Keychain and Keystore are small and slow, which is
right for 32 bytes and wrong for a document.

Per account, so switching accounts on a shared phone cannot read the previous
one's cache even if a row survived: the wrong key produces an authentication
failure, not a plausible plaintext.

**No escrow and no recovery.** A key recoverable from a server is a key the
server can read the records with. The consequence is stated in the UI by
`describeKeyLoss`, and it is not "your records are lost" — the backend still
has them. What is actually lost is anything that had not synced.

### 3. Keys namespaced by account; only the contents are secret

`ayunetz.<accountId>.v2.<name>`. The name is legible in a storage dump — it
says an account has parent records — and that is the trade for being able to
enumerate and clear one account's rows without decrypting them. The contents are
what must not leak.

### 4. Migration verifies before it deletes

Each legacy row is encrypted, written, **read back and compared**, and only then
is the plaintext removed. A migration that deletes on the strength of a
successful `setItem` will one day delete a row whose write silently failed.

On failure the plaintext stays. A partial migration is recoverable; a partial
deletion is not.

### 5. Files are protected separately, and differently

Originals move out of the picker's **cache** — which the OS empties without
asking — into the document directory, per account, on capture rather than on
upload.

**Database encryption does not encrypt a file referenced by a URI.** These rely
on platform file protection (iOS Data Protection, Android FBE) rather than the
record key, because decrypting a multi-megabyte PDF in JavaScript on every page
view is not viable. The exposure window is bounded: they exist only between
capture and confirmed upload.

Pending originals are **bounded but never silently evicted**. Over the limit,
capture refuses and says so. The page nobody uploaded is the page nobody has.

### 6. Detach before clearing, and the ordering bug that proves it

The persist middleware writes on *every* state change. Two orderings look
identical and one destroys data:

- **Sign-out** must `closeVault()` (detach the storage) and then clear memory.
  The reverse saves an empty vault over the account's records — a sign-out that
  silently deletes everything on the device.
- **Hydration** must read storage *before* touching state. "Clear, then
  rehydrate" writes an empty vault and then reads back what it just wrote. It
  appeared to work only because the write and the read race, and the read
  usually won.

Both were written the wrong way round first and caught by
`accountSwitch.test.ts`. They are recorded here because neither is obvious and
both are one refactor away from returning.

## Consequences

**Unverified on a device.** No simulator or emulator was available in the
session that implemented this. What is proven: the cipher round-trips, a wrong
key fails rather than returning plausible data, fixture values do not appear in
what is written, one account cannot read another's rows, the migration keeps
plaintext when the encrypted copy does not read back, and pending originals
survive a restart — 47 tests over an in-memory file system and AsyncStorage's
own mock.

What is **not** proven, and stays open: that SecureStore is backed by the
Secure Enclave / StrongBox as expected on real hardware; that the originals
directory is genuinely excluded from iCloud and Android auto-backup; and that
Data Protection behaves as assumed while the device is locked. Expo Go is not
evidence for any of these — a development client is a different container with
different entitlements.

**Web is not secure and never was.** `secureStorage` falls back to
`localStorage` on web behind a loud warning, so on web the vault key is
readable by any script on the origin. Web is a development preview; the README
and that warning both say so.

**A stronger option was left on the table.** SQLCipher via `op-sqlite` would
encrypt at the database layer and handle large records better. It requires a
prebuild and a native dependency, and it should be revisited if the vault grows
past what a JSON blob should hold — which is a scale problem this does not have
yet.
