import { apiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/errors';

import { config, isBackendEnabled } from '@/config/env';
import type { DocumentPage } from '@/types/domain';

/**
 * Secure document upload.
 *
 * The production design is a **presigned S3 PUT**, and the mock below imitates
 * it step for step so the swap is mechanical:
 *
 *   1. POST /v1/documents/{id}/uploads  ->  Lambda signs one PUT URL per page
 *                                           against the SSE-KMS bucket in
 *                                           ap-south-1, TTL ~15 minutes.
 *   2. PUT <presigned url>              ->  the file goes phone -> S3 directly.
 *                                           Bytes never transit our compute,
 *                                           which is the whole point.
 *   3. POST .../uploads/complete        ->  Lambda records the object keys and
 *                                           pushes a job onto SQS.
 *
 * The client therefore never holds AWS credentials and never needs an S3 SDK.
 *
 * TODO(backend): replace `mockUpload` with `fetch(url, { method: 'PUT', body })`
 * using an `expo-file-system` upload task so progress is real and the transfer
 * survives backgrounding.
 */

export interface PresignedTarget {
  pageId: string;
  /** The S3 object key the page will live at. */
  objectKey: string;
  uploadUrl: string;
  /** Headers S3 requires the PUT to echo — includes the KMS header in prod. */
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadProgress {
  /** 0–100 across the whole document. */
  percent: number;
  pagesCompleted: number;
  pagesTotal: number;
  currentPageId: string | null;
}

export interface UploadResult {
  documentId: string;
  objectKeys: string[];
  /** SQS message id in production; a mock id here. */
  processingJobId: string;
}

export type ProgressListener = (progress: UploadProgress) => void;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Deterministic object key. Prefixed by user then parent so an S3 lifecycle
 * rule (and the account-deletion job) can address one family's data by prefix.
 */
export const buildObjectKey = (input: {
  userId: string;
  parentId: string;
  documentId: string;
  page: DocumentPage;
}): string => {
  const extension = input.page.kind === 'pdf' ? 'pdf' : 'jpg';
  return `users/${input.userId}/parents/${input.parentId}/documents/${input.documentId}/${input.page.id}.${extension}`;
};

const mockPresign = (input: {
  userId: string;
  parentId: string;
  documentId: string;
  pages: DocumentPage[];
}): PresignedTarget[] =>
  input.pages.map((page) => {
    const objectKey = buildObjectKey({ ...input, page });
    return {
      pageId: page.id,
      objectKey,
      uploadUrl: `https://${config.aws.documentsBucket}.s3.${config.aws.region}.amazonaws.com/${objectKey}?X-Amz-Mock-Signature=demo`,
      headers: {
        'Content-Type': page.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
        // Mirrors the bucket policy that will reject unencrypted writes.
        'x-amz-server-side-encryption': 'aws:kms',
      },
      expiresAt: new Date(Date.now() + config.upload.presignTtlSeconds * 1000).toISOString(),
    };
  });

/** Simulates a per-page transfer, reporting progress at a believable cadence. */
const mockUpload = async (
  targets: PresignedTarget[],
  onProgress: ProgressListener | undefined,
  signal: AbortSignal | undefined,
): Promise<void> => {
  const total = targets.length;
  const stepsPerPage = 4;

  for (let index = 0; index < total; index += 1) {
    const target = targets[index];
    if (!target) continue;

    for (let step = 1; step <= stepsPerPage; step += 1) {
      if (signal?.aborted) throw new ApiError('unknown', 'Upload cancelled.');
      await sleep(140);
      const completedFraction = (index + step / stepsPerPage) / total;
      onProgress?.({
        percent: Math.round(completedFraction * 100),
        pagesCompleted: index,
        pagesTotal: total,
        currentPageId: target.pageId,
      });
    }
  }

  onProgress?.({ percent: 100, pagesCompleted: total, pagesTotal: total, currentPageId: null });
};

export const uploadService = {
  /** Step 1 — ask the backend to sign one PUT per page. */
  async requestPresignedTargets(input: {
    userId: string;
    parentId: string;
    documentId: string;
    pages: DocumentPage[];
  }): Promise<PresignedTarget[]> {
    if (isBackendEnabled()) {
      return apiClient.post<PresignedTarget[]>(
        endpoints.documents.presignUpload(input.documentId),
        {
          parentId: input.parentId,
          pages: input.pages.map((page) => ({
            pageId: page.id,
            contentType: page.kind === 'pdf' ? 'application/pdf' : 'image/jpeg',
            sizeBytes: page.sizeBytes,
          })),
        },
      );
    }
    return mockPresign(input);
  },

  /**
   * Steps 1–3 in one call. Screens use this; it is the only entry point they
   * need, and its signature will not change when the backend lands.
   */
  async uploadDocument(input: {
    userId: string;
    parentId: string;
    documentId: string;
    pages: DocumentPage[];
    onProgress?: ProgressListener;
    signal?: AbortSignal;
  }): Promise<UploadResult> {
    const { documentId, pages, onProgress, signal } = input;

    if (pages.length === 0) {
      throw new ApiError('unknown', 'There are no pages to upload.');
    }

    const oversized = pages.find((page) => page.sizeBytes > config.upload.maxUploadBytes);
    if (oversized) {
      throw new ApiError('too_large', `"${oversized.fileName}" is larger than the upload limit.`);
    }

    onProgress?.({ percent: 0, pagesCompleted: 0, pagesTotal: pages.length, currentPageId: null });

    const targets = await uploadService.requestPresignedTargets(input);

    if (isBackendEnabled()) {
      // TODO(backend): PUT each page to `target.uploadUrl` with `target.headers`
      // via expo-file-system's uploadAsync, reporting real byte progress.
      throw new ApiError('unknown', 'Real S3 upload is not implemented yet.');
    }

    await mockUpload(targets, onProgress, signal);

    return {
      documentId,
      objectKeys: targets.map((target) => target.objectKey),
      processingJobId: `job_${documentId}`,
    };
  },

  /** Step 3 — tells the backend every page landed, which enqueues the SQS job. */
  async completeUpload(documentId: string, objectKeys: string[]): Promise<{ jobId: string }> {
    if (isBackendEnabled()) {
      return apiClient.post<{ jobId: string }>(endpoints.documents.completeUpload(documentId), {
        objectKeys,
      });
    }
    return { jobId: `job_${documentId}` };
  },
};
