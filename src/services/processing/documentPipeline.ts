import { summaryService, type ProcessingStage } from '../ai/summaryService';
import { uploadService } from '../upload/uploadService';

import { processDocumentOnBackend } from './devProcessingClient';
import { toDocumentSummary } from './summaryMapper';
import { DocumentProcessingError } from './types';

import { isBackendEnabled } from '@/config/env';
import type { DocumentSummary, MedicalDocument, ParentProfile } from '@/types/domain';

/**
 * The one call a screen makes to get a document processed.
 *
 * It exists so the processing screen does not have to know whether the pages
 * are going to a mock, to the Phase 1 development backend, or eventually to
 * S3 and a queue. Those three have genuinely different shapes — the mock and
 * production upload then poll; the dev backend does it all in one request — and
 * that difference belongs here rather than in a component.
 *
 * The rule from the README still holds: screens never call a network API
 * directly. This is the service they call instead.
 */

export interface PipelineProgress {
  /** 0–100 for the bytes leaving the phone. */
  uploadPercent: number;
  stage: ProcessingStage;
}

export interface RunPipelineInput {
  document: MedicalDocument;
  /** Needed for redaction ground truth on the backend path. */
  parent: ParentProfile | undefined;
  userId: string;
  onUploadProgress?: (percent: number) => void;
  onStage?: (stage: ProcessingStage) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  summary: DocumentSummary;
  /** True when a real backend produced this, false for the seeded/mock path. */
  fromBackend: boolean;
}

/**
 * Maps the backend's fine-grained stages onto the four the app already shows.
 *
 * The backend reports eleven stages (`redacting_pii`, `privacy_check`, …) and
 * the status screen has always shown four. Rather than redesign that screen
 * around implementation detail, the extra stages collapse into the existing
 * vocabulary — the caregiver wants to know it is working, not which regular
 * expression is running.
 */
export const toAppStage = (backendStage: string): ProcessingStage => {
  switch (backendStage) {
    case 'queued':
    case 'validating':
      return 'queued';
    case 'reading_pages':
    case 'normalising_text':
      return 'reading_pages';
    case 'redacting_pii':
    case 'privacy_check':
    case 'extracting_values':
      return 'extracting_values';
    case 'writing_summary':
    case 'validating_summary':
      return 'writing_summary';
    case 'done':
      return 'done';
    default:
      return 'failed';
  }
};

export const runDocumentPipeline = async (input: RunPipelineInput): Promise<PipelineResult> => {
  const { document, parent, userId, onUploadProgress, onStage, signal } = input;

  if (!isBackendEnabled()) {
    // --- Mock path: unchanged behaviour, unchanged services ----------------
    const result = await uploadService.uploadDocument({
      userId,
      parentId: document.parentId,
      documentId: document.id,
      pages: document.pages,
      ...(onUploadProgress === undefined
        ? {}
        : { onProgress: (progress) => onUploadProgress(progress.percent) }),
      ...(signal === undefined ? {} : { signal }),
    });

    await uploadService.completeUpload(document.id, result.objectKeys);

    const summary = await summaryService.processDocument(
      document,
      (state) => onStage?.(state.stage),
      signal,
    );

    return { summary, fromBackend: false };
  }

  // --- Development backend path -------------------------------------------
  if (parent === undefined) {
    // Without the parent there is no name to redact against, and the backend
    // requires one. Failing here is better than sending a document the
    // redactor cannot do its strongest layer on.
    throw new DocumentProcessingError(
      'invalid_file',
      'This document is not linked to a parent profile, so it cannot be processed.',
    );
  }

  onStage?.('queued');

  const response = await processDocumentOnBackend({
    document,
    parent,
    ...(onUploadProgress === undefined ? {} : { onUploadProgress }),
    ...(signal === undefined ? {} : { signal }),
  });

  // The request is synchronous, so the intermediate stages have already
  // happened by the time it returns. They are reported in order anyway so the
  // status screen tells the same story on both paths.
  onStage?.('reading_pages');
  onStage?.('extracting_values');
  onStage?.('writing_summary');

  const summary = toDocumentSummary(response, document);

  onStage?.('done');

  return { summary, fromBackend: true };
};
