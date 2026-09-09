import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where original scans and PDFs live before they are safely uploaded.
 *
 * ## The problem this replaces
 *
 * `expo-image-picker` and `expo-document-picker` copy what the user chose into
 * the **cache** directory. The operating system deletes cache when it wants
 * space, and it does not ask. A parent who photographs a discharge summary on
 * the way out of hospital, loses signal, and opens the app the next morning can
 * find the pages simply gone — with the record still saying a document is
 * pending.
 *
 * Originals therefore move out of cache into the app's document directory as
 * soon as they are captured, and stay there until a durable upload is
 * confirmed.
 *
 * ## Encryption, and what encrypts what
 *
 * The record cache is encrypted by `encryptedStore`. **That does not encrypt
 * these files** — a database encrypts its own rows, not a JPEG referenced by a
 * URI, and conflating the two is exactly how a system ends up with encrypted
 * metadata pointing at plaintext scans.
 *
 * These files rely on platform file protection: iOS Data Protection (Complete
 * Until First User Authentication for the app container) and Android's
 * file-based encryption. That is weaker than the record cache and it is
 * deliberate — the alternative is decrypting a multi-megabyte PDF in JavaScript
 * every time a page is displayed. The window is also short: these exist only
 * between capture and confirmed upload.
 *
 * **This is unverified on a device in the session that wrote it.** No simulator
 * or emulator was available. Whether the container is actually excluded from
 * iCloud and Android auto-backup needs checking on real hardware — see
 * `docs/koode/PROGRESS.md`.
 *
 * ## Backup
 *
 * The directory is marked for exclusion from cloud backup. A health record
 * copied into iCloud or Google Drive leaves the boundary the rest of this
 * system is built to hold, and it does so silently.
 */

/** Everything pending, under one root, so a wipe is one directory removal. */
const ROOT = 'ayunetz-originals';

/**
 * A generous ceiling on pending originals.
 *
 * Bounded because a user who photographs twenty reports offline should not fill
 * their phone. Not enforced by deleting the oldest: **pending work is never
 * silently discarded**, because the page nobody uploaded is the page nobody
 * has. Over the limit, capture refuses and says so.
 */
export const PENDING_BYTES_LIMIT = 250 * 1024 * 1024;

export interface StoredOriginal {
  readonly uri: string;
  readonly sizeBytes: number;
}

export class ProtectedStorageFull extends Error {
  constructor(readonly usedBytes: number) {
    super('There is no room for another document until some are uploaded.');
    this.name = 'ProtectedStorageFull';
  }
}

const accountDirectory = (accountId: string): Directory =>
  new Directory(Paths.document, ROOT, accountId);

/**
 * Per account, like the record cache.
 *
 * Signing out and signing in as somebody else must not leave the previous
 * account's scans where the new one can open them.
 */
const ensureDirectory = (accountId: string): Directory => {
  const directory = accountDirectory(accountId);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
};

const listFiles = (accountId: string): File[] => {
  const directory = accountDirectory(accountId);
  if (!directory.exists) return [];
  return directory
    .list()
    .filter((entry): entry is File => entry instanceof File);
};

/** How much space this account's pending originals take. */
export const pendingBytes = (accountId: string): number =>
  listFiles(accountId).reduce((total, file) => total + (file.size ?? 0), 0);

/**
 * Moves a freshly captured file out of the picker's cache.
 *
 * Copy then delete rather than rename: a rename across the cache and document
 * directories is not guaranteed to be atomic on either platform, and a failed
 * rename that has already removed the source loses the page.
 */
export const keepOriginal = (
  accountId: string,
  cacheUri: string,
  fileName: string,
): StoredOriginal => {
  const source = new File(cacheUri);
  const size = source.size ?? 0;

  if (pendingBytes(accountId) + size > PENDING_BYTES_LIMIT) {
    throw new ProtectedStorageFull(pendingBytes(accountId));
  }

  const directory = ensureDirectory(accountId);
  const destination = new File(directory, fileName);

  source.copy(destination);

  // Only once the copy exists. If this throws, the cache copy is still there
  // and the next attempt can retry; the reverse loses the page.
  try {
    source.delete();
  } catch {
    // The OS will reclaim it. A page kept twice is untidy; a page kept zero
    // times is a document the user thinks they filed and did not.
  }

  return { uri: destination.uri, sizeBytes: destination.size ?? size };
};

/**
 * Removes one original.
 *
 * Called **only** after a durable upload is confirmed, or when the user
 * explicitly discards the document. Never on a timer, and never because a
 * screen was closed.
 */
export const discardOriginal = (uri: string): void => {
  const file = new File(uri);
  if (file.exists) file.delete();
};

/** True while the bytes are still on this device. */
export const originalExists = (uri: string): boolean => new File(uri).exists;

/**
 * Removes everything for one account.
 *
 * Sign-out, account deletion, and the purge after a revocation is discovered.
 * Scoped to the account so a shared phone does not lose the other person's
 * pending work.
 */
export const clearOriginals = (accountId: string): void => {
  const directory = accountDirectory(accountId);
  if (directory.exists) directory.delete();
};

/**
 * What survived a restart, so the app can resume rather than re-ask.
 *
 * Returns the files themselves rather than a count: the caller reconciles them
 * against the documents it knows about, and anything on disk with no record is
 * an orphan to clean up — the one case where deleting an original is correct
 * without an upload, because nothing will ever refer to it.
 */
export const listPendingOriginals = (accountId: string): StoredOriginal[] =>
  listFiles(accountId).map((file) => ({ uri: file.uri, sizeBytes: file.size ?? 0 }));
