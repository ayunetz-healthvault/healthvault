import { buildObjectKey, uploadService } from './uploadService';

import { config } from '@/config/env';
import { ApiError } from '@/services/api/errors';
import type { DocumentPage } from '@/types/domain';

const page = (overrides: Partial<DocumentPage> = {}): DocumentPage => ({
  id: 'pag_1',
  uri: 'file:///cache/page-1.jpg',
  kind: 'image',
  source: 'scan',
  fileName: 'page-1.jpg',
  sizeBytes: 120_000,
  width: 1240,
  height: 1754,
  capturedAt: '2026-07-30T10:00:00.000Z',
  ...overrides,
});

const baseInput = {
  userId: 'usr_1',
  parentId: 'par_1',
  documentId: 'doc_1',
};

describe('buildObjectKey', () => {
  it('namespaces by user then parent so a family can be deleted by prefix', () => {
    expect(buildObjectKey({ ...baseInput, page: page() })).toBe(
      'users/usr_1/parents/par_1/documents/doc_1/pag_1.jpg',
    );
  });

  it('uses a pdf extension for PDF pages', () => {
    expect(buildObjectKey({ ...baseInput, page: page({ kind: 'pdf' }) })).toMatch(/\.pdf$/);
  });
});

describe('requestPresignedTargets', () => {
  it('returns one signed target per page', async () => {
    const pages = [page({ id: 'pag_1' }), page({ id: 'pag_2' })];
    const targets = await uploadService.requestPresignedTargets({ ...baseInput, pages });

    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.pageId)).toEqual(['pag_1', 'pag_2']);
  });

  it('points at the configured Mumbai bucket', async () => {
    const [target] = await uploadService.requestPresignedTargets({
      ...baseInput,
      pages: [page()],
    });

    expect(target?.uploadUrl).toContain(config.aws.documentsBucket);
    expect(target?.uploadUrl).toContain(config.aws.region);
  });

  it('demands server-side KMS encryption on the PUT', async () => {
    const [target] = await uploadService.requestPresignedTargets({
      ...baseInput,
      pages: [page()],
    });

    expect(target?.headers['x-amz-server-side-encryption']).toBe('aws:kms');
  });

  it('sets an expiry in the future', async () => {
    const [target] = await uploadService.requestPresignedTargets({
      ...baseInput,
      pages: [page()],
    });

    expect(new Date(target!.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('uploadDocument', () => {
  it('rejects an empty document', async () => {
    await expect(uploadService.uploadDocument({ ...baseInput, pages: [] })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('rejects a page over the size limit before uploading anything', async () => {
    const oversized = page({ sizeBytes: config.upload.maxUploadBytes + 1, fileName: 'huge.pdf' });
    const onProgress = jest.fn();

    await expect(
      uploadService.uploadDocument({ ...baseInput, pages: [oversized], onProgress }),
    ).rejects.toMatchObject({ kind: 'too_large' });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('reports monotonic progress and finishes at 100', async () => {
    const percentages: number[] = [];

    const result = await uploadService.uploadDocument({
      ...baseInput,
      pages: [page({ id: 'pag_1' }), page({ id: 'pag_2' })],
      onProgress: (progress) => percentages.push(progress.percent),
    });

    expect(percentages[0]).toBe(0);
    expect(percentages.at(-1)).toBe(100);
    expect([...percentages].sort((a, b) => a - b)).toEqual(percentages);
    expect(result.objectKeys).toHaveLength(2);
    expect(result.processingJobId).toBe('job_doc_1');
  });

  it('aborts partway through when signalled', async () => {
    const controller = new AbortController();
    const promise = uploadService.uploadDocument({
      ...baseInput,
      pages: [page({ id: 'pag_1' }), page({ id: 'pag_2' })],
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });
});

describe('completeUpload', () => {
  it('returns a job id derived from the document', async () => {
    await expect(uploadService.completeUpload('doc_1', ['key-1'])).resolves.toEqual({
      jobId: 'job_doc_1',
    });
  });
});
