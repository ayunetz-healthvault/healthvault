import { File } from 'expo-file-system';

import { createUploadSessions, type UploadSession } from './uploadSession';
import { apiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/errors';

import { config, isBackendEnabled } from '@/config/env';
import type { DocumentPage } from '@/types/domain';

/**
 * Getting a document from the phone into the record.
 *
 *   1. POST /v1/patients/{id}/documents           the record, first, so nothing
 *                                                 is uploaded with nowhere to
 *                                                 live
 *   2. POST .../uploads                           one presigned PUT per page
 *   3. PUT <presigned url>                        phone → object store, direct
 *   4. POST .../uploads/complete                  verify, then enqueue
 *
 * Bytes never transit the API. That removes a whole class of accident — no scan
 * of a prescription in a request log, a heap dump or a proxy cache — and means
 * the client holds no credential that can write anywhere but the keys it was
 * given.
 *
 * ## What makes this resumable
 *
 * Three things, and none of them is retry logic:
 *
 * - **The bytes are somewhere durable.** `protectedFiles` moved them out of the
 *   picker's cache at capture time, so they are still there tomorrow.
 * - **The server's document id is recorded** as soon as it exists. A locally
 *   generated id is not a cloud id, and treating it as one files the resumed
 *   pages against a document that was never created.
 * - **Each page is marked as it lands.** A resume asks for URLs for the pages
 *   that are missing, not for all of them.
 *
 * Together they mean the app can be killed at any point and the next launch
 * picks up where it stopped, without re-uploading or duplicating anything.
 */

export interface PresignedTarget {
  page: number;
  key: string;
  url: string;
  expiresInSeconds: number;
  /** Headers the store requires the PUT to echo for the signature to match. */
  headers: Record<string, string>;
}

export interface UploadProgress {
  /** 0–100 across the whole document. */
  percent: number;
  pagesCompleted: number;
  pagesTotal: number;
  currentPage: number | null;
}

export interface UploadResult {
  /** The server's id. Everything after this point uses it, not the local one. */
  serverDocumentId: string;
  pagesUploaded: number;
  queued: boolean;
}

export type ProgressListener = (progress: UploadProgress) => void;

/**
 * The page limit, in one place.
 *
 * The backend enforces ten and rejects anything else. Duplicating the number
 * without saying where it comes from is how the two drift and a user gets a
 * server error after filling in a form.
 */
export const MAX_PAGES = 10;

const contentTypeFor = (page: DocumentPage): 'application/pdf' | 'image/jpeg' =>
  page.kind === 'pdf' ? 'application/pdf' : 'image/jpeg';

export interface UploadInput {
  accountId: string;
  patientId: string;
  /** The document id this device generated while the pages were being taken. */
  localDocumentId: string;
  title: string;
  category: string;
  documentDate: string;
  pages: DocumentPage[];
  onProgress?: ProgressListener | undefined;
  signal?: AbortSignal | undefined;
}

const reportProgress = (
  onProgress: ProgressListener | undefined,
  session: UploadSession,
  currentPage: number | null,
): void => {
  onProgress?.({
    percent: Math.round((session.uploadedPages.length / session.pageCount) * 100),
    pagesCompleted: session.uploadedPages.length,
    pagesTotal: session.pageCount,
    currentPage,
  });
};

export const uploadService = {
  /**
   * Uploads a document, or finishes one that was interrupted.
   *
   * Idempotent by construction rather than by a retry wrapper: every step
   * checks what the session already knows before doing anything.
   */
  async uploadDocument(input: UploadInput): Promise<UploadResult> {
    const { accountId, patientId, localDocumentId, pages, onProgress, signal } = input;

    if (pages.length === 0) throw new ApiError('unknown', 'There are no pages to upload.');
    if (pages.length > MAX_PAGES) {
      throw new ApiError('too_large', `A document can have at most ${MAX_PAGES} pages.`);
    }

    const oversized = pages.find((page) => page.sizeBytes > config.upload.maxUploadBytes);
    if (oversized) {
      // The filename is the user's own and they are looking at it; it does not
      // go anywhere but this screen.
      throw new ApiError('too_large', `“${oversized.fileName}” is larger than the upload limit.`);
    }

    if (!isBackendEnabled()) {
      throw new ApiError(
        'unknown',
        'This build has no server configured, so documents cannot be uploaded.',
      );
    }

    const sessions = createUploadSessions(accountId);
    let session = await sessions.start({
      localDocumentId,
      patientId,
      pageCount: pages.length,
    });

    // --- 1. The record ------------------------------------------------------
    if (session.serverDocumentId === null) {
      const created = await apiClient.post<{ document: { documentId: string } }>(
        endpoints.documents.create(patientId),
        {
          title: input.title,
          category: input.category,
          documentDate: input.documentDate,
          pageCount: pages.length,
        },
      );
      await sessions.attachServerId(localDocumentId, created.document.documentId);
      session = (await sessions.get(localDocumentId)) as UploadSession;
    }

    const serverDocumentId = session.serverDocumentId as string;
    reportProgress(onProgress, session, null);

    // --- 2 & 3. The pages that are still missing ----------------------------
    const outstanding = pages
      .map((page, index) => ({ page, number: index + 1 }))
      .filter(({ number }) => !session.uploadedPages.includes(number));

    if (outstanding.length > 0) {
      /**
       * URLs are requested for the outstanding pages only, and requested *now*
       * rather than reused from a previous attempt.
       *
       * A presigned URL is valid for minutes. One saved with the session and
       * replayed tomorrow is expired, and the PUT fails with a signature error
       * that looks nothing like "ask again" — so they are never persisted.
       */
      const { uploads } = await apiClient.post<{ uploads: PresignedTarget[] }>(
        endpoints.documents.presignUpload(patientId, serverDocumentId),
        {
          pages: outstanding.map(({ page, number }) => ({
            page: number,
            contentType: contentTypeFor(page),
          })),
        },
      );

      for (const { page, number } of outstanding) {
        if (signal?.aborted) throw new ApiError('unknown', 'Upload cancelled.');

        const target = uploads.find((upload) => upload.page === number);
        if (target === undefined) {
          throw new ApiError('unknown', 'The server did not offer a place for every page.');
        }

        const file = new File(page.uri);
        if (!file.exists) {
          throw new ApiError(
            'not_found',
            'One of the pages is no longer on this phone. Take it again.',
          );
        }

        const response = await file.upload(target.url, {
          httpMethod: 'PUT',
          headers: target.headers,
          mimeType: contentTypeFor(page),
        });

        if (response.status < 200 || response.status >= 300) {
          // Left un-marked, so a retry sends this page again. The alternative —
          // assuming success — completes a document with a missing page and
          // produces a summary that silently omits whatever was on it.
          throw new ApiError('unknown', 'A page did not finish uploading. Try again.');
        }

        await sessions.markPageUploaded(localDocumentId, number);
        session = (await sessions.get(localDocumentId)) as UploadSession;
        reportProgress(onProgress, session, number);
      }
    }

    // --- 4. Tell the server, which verifies and enqueues --------------------
    /**
     * The completion call is where the server checks every page actually
     * arrived. It is safe to repeat: a second call is answered with
     * `alreadyQueued` rather than queuing the document twice.
     */
    const completed = await apiClient.post<{ alreadyQueued: boolean }>(
      endpoints.documents.completeUpload(patientId, serverDocumentId),
    );

    await sessions.markComplete(localDocumentId);

    return {
      serverDocumentId,
      pagesUploaded: pages.length,
      queued: !completed.alreadyQueued,
    };
  },

  /**
   * Uploads that were interrupted and can be picked up again.
   *
   * Read on launch. Anything here has bytes on disk and a record that thinks it
   * is still uploading, and the user should be told rather than left to notice
   * a document that never appeared.
   */
  async resumable(accountId: string): Promise<UploadSession[]> {
    return createUploadSessions(accountId).unfinished();
  },

  /** Forgets an upload the user abandoned. Bytes are removed separately. */
  async abandon(accountId: string, localDocumentId: string): Promise<void> {
    await createUploadSessions(accountId).discard(localDocumentId);
  },
};
