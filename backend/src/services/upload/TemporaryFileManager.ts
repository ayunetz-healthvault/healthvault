import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ProcessingError, type TemporaryPage } from '../../types/processing.js';

import type { SupportedMimeType } from './FileValidator.js';

/**
 * Temporary page storage.
 *
 * Pages exist on disk only for the seconds it takes to OCR them. Two rules:
 *
 * 1. **The path is random.** It is never derived from the uploaded filename,
 *    the document id or the patient. A filename on a medical scan often *is*
 *    an identifier, and a predictable path is a path another process can guess.
 * 2. **Cleanup is unconditional.** Callers must use `finally`, and `cleanup()`
 *    never throws — a failure to delete must not mask the original error, and
 *    must not stop the response being sent.
 */

const EXTENSION: Record<SupportedMimeType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

export class TemporaryFileManager {
  /** Directory for one request. Removed wholesale by `cleanup()`. */
  private readonly sessionDir: string;
  private readonly written: string[] = [];
  private cleanedUp = false;

  constructor(baseDir: string) {
    this.sessionDir = path.join(baseDir, `doc-${randomUUID()}`);
  }

  /** Exposed for assertions in tests; not part of any response or log line. */
  get directory(): string {
    return this.sessionDir;
  }

  get fileCount(): number {
    return this.written.length;
  }

  async prepare(): Promise<void> {
    try {
      // 0o700: this process only. The default umask would let group and other
      // read a medical scan for as long as it exists.
      await fs.mkdir(this.sessionDir, { recursive: true, mode: 0o700 });
    } catch (cause) {
      throw new ProcessingError('upload_failed', 'Could not prepare temporary storage.', {
        retryable: true,
        cause,
      });
    }
  }

  /**
   * Writes one page under a fresh random name.
   *
   * @param page 1-based page number, preserved in the returned record so the
   *   ordering the caller sent survives even though the filenames do not.
   */
  async writePage(
    page: number,
    buffer: Buffer,
    mimeType: SupportedMimeType,
  ): Promise<TemporaryPage> {
    const filePath = path.join(this.sessionDir, `${randomUUID()}${EXTENSION[mimeType]}`);

    try {
      await fs.writeFile(filePath, buffer, { mode: 0o600 });
    } catch (cause) {
      throw new ProcessingError('upload_failed', `Could not store page ${page}.`, {
        retryable: true,
        details: { page },
        cause,
      });
    }

    this.written.push(filePath);

    return { page, path: filePath, mimeType, sizeBytes: buffer.length };
  }

  /**
   * Removes everything this request wrote.
   *
   * Idempotent and silent by contract. It returns whether it believes the
   * directory is gone so a caller *can* assert on it in a test, but production
   * code should call it and move on.
   */
  async cleanup(): Promise<boolean> {
    if (this.cleanedUp) {
      return true;
    }

    try {
      await fs.rm(this.sessionDir, { recursive: true, force: true });
      this.cleanedUp = true;
      this.written.length = 0;
      return true;
    } catch {
      // Deliberately swallowed. The error would name a path, and there is
      // nothing useful a caller can do about it mid-request. A stale temp
      // directory is an operational problem, not a request-level one.
      return false;
    }
  }
}
