import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Handing somebody the copy of their record they just asked for.
 *
 * A copy that exists only in memory, or only inside the app's own storage, is
 * not a copy anybody has: the point of an export is that it leaves — into
 * Files, Drive, an email to a doctor — and until it does, the right to a copy
 * has not actually been honoured. The screen used to say the file "is not built
 * yet", which was at least honest; this is the thing it was waiting for.
 *
 * ## Why the file is written to cache and deleted afterwards
 *
 * The share sheet needs a real file on disk, so one is written. It is then
 * removed as soon as the sheet closes, because a JSON file containing
 * somebody's entire medical history sitting in app storage is a second copy of
 * the record — one nobody remembers is there, that no deletion path knows
 * about, and that the export's whole design otherwise avoids (the server hands
 * it back inline for exactly this reason; see `routes/v1/privacyRights.ts`).
 *
 * Cache rather than the documents directory for the same reason: if this
 * process dies between writing and deleting, the operating system reclaims it.
 */

export type SavedExport =
  /** The share sheet was shown and has closed. Where it went is the OS's business. */
  | { readonly outcome: 'shared'; readonly fileName: string }
  /**
   * No share sheet on this platform — the web build.
   *
   * Named separately from a failure so the screen can say something true rather
   * than reporting an error for a platform difference.
   */
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'failed'; readonly message: string };

/** `Meera Nair` → `meera-nair`, so the file name gives nothing else away. */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'record';

export const exportFileName = (fullName: string, exportedAt: string): string =>
  `${slug(fullName)}-record-${exportedAt.slice(0, 10)}.json`;

/**
 * Writes the export and offers it to whatever the person wants to keep it in.
 *
 * Takes the assembled export rather than fetching it, so the network failure
 * and the file failure stay separate: a person whose export was assembled and
 * then could not be written has a different problem from one who never reached
 * the server, and telling them apart is the difference between "try again" and
 * "free up some space".
 */
export const saveRecordExport = async (
  fullName: string,
  exportedAt: string,
  payload: unknown,
): Promise<SavedExport> => {
  const fileName = exportFileName(fullName, exportedAt);
  let file: File | null = null;

  try {
    file = new File(Paths.cache, fileName);
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(payload, null, 2));

    if (!(await Sharing.isAvailableAsync())) {
      return { outcome: 'unavailable' };
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save a copy of this record',
      UTI: 'public.json',
    });

    return { outcome: 'shared', fileName };
  } catch (error) {
    /**
     * The message is this app's, never the platform's.
     *
     * A file-system error can quote a path, and a path here contains the
     * person's name — see ADR-001.
     */
    void error;
    return {
      outcome: 'failed',
      message: 'The copy could not be saved to this phone. Nothing has changed.',
    };
  } finally {
    /**
     * Deleted as soon as the sheet closes, whichever way it went.
     *
     * On iOS the share promise settles after the sheet is dismissed, by which
     * point the receiving app has taken its own copy; on Android the same is
     * true of anything that accepted the file. What is left behind here would
     * be a copy of a medical record nothing tracks.
     */
    try {
      if (file?.exists === true) file.delete();
    } catch {
      // Nothing useful to say or do: the cache directory is the OS's to reclaim.
    }
  }
};
