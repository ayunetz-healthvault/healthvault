import { mergeDocuments, mergeOne } from './mergeDocuments';

import type { MedicalDocument, ProcessingStatus } from '@/types/domain';

/**
 * Whose word to take about a document.
 *
 * The interesting cases are all disagreements: the phone says uploading and the
 * server says nothing has arrived; the phone says failed and the server has
 * since succeeded; the server has stopped returning a record the phone can see.
 * Each of those has one right answer and at least one plausible wrong one.
 */

const doc = (
  id: string,
  status: ProcessingStatus,
  patch: Partial<MedicalDocument> = {},
): MedicalDocument => ({
  id,
  parentId: 'pat_1',
  title: 'Blood test report',
  category: 'lab_report',
  documentDate: '2026-09-01',
  pages: [],
  status,
  uploadProgress: status === 'uploading' ? 40 : 100,
  summaryId: null,
  failureReason: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...patch,
});

const page = { id: 'pag_1', uri: 'file:///vault/1.jpg', kind: 'image' as const, sizeBytes: 10 };

describe('a second device pulling records it has never seen', () => {
  it('takes on every state the server reports', () => {
    const merged = mergeDocuments({
      local: [],
      remoteByPatient: {
        pat_1: [doc('doc_q', 'uploaded'), doc('doc_f', 'failed'), doc('doc_r', 'ready')],
      },
      removedPatientIds: [],
    });

    expect(merged.map((document) => [document.id, document.status])).toEqual([
      ['doc_q', 'uploaded'],
      ['doc_f', 'failed'],
      ['doc_r', 'ready'],
    ]);
  });

  /**
   * Relaunching, or pulling twice, must not produce two of anything. This is
   * the failure people notice first, because it looks like the app duplicated
   * their medical records.
   */
  it('applies the same pull twice without duplicating a document', () => {
    const remoteByPatient = { pat_1: [doc('doc_r', 'ready')] };

    const once = mergeDocuments({ local: [], remoteByPatient, removedPatientIds: [] });
    const twice = mergeDocuments({ local: once, remoteByPatient, removedPatientIds: [] });

    expect(twice).toHaveLength(1);
  });

  /** A document uploaded from this phone comes back under the server's id. */
  it('recognises a document it uploaded rather than filing a second copy', () => {
    const local = doc('doc_local', 'ready', { remoteId: 'doc_server', pages: [page] });

    const merged = mergeDocuments({
      local: [local],
      remoteByPatient: { pat_1: [doc('doc_server', 'ready')] },
      removedPatientIds: [],
    });

    expect(merged).toHaveLength(1);
    // The local id survives, because the pages and the summary hang off it.
    expect(merged[0]).toMatchObject({ id: 'doc_local', remoteId: 'doc_server' });
  });
});

describe('when the phone and the server disagree', () => {
  /**
   * The server is behind by definition while bytes are leaving this device.
   * Taking its word would stall the progress bar the user is watching.
   */
  it('keeps this device’s upload in progress', () => {
    const local = doc('doc_1', 'uploading', { uploadProgress: 40, pages: [page] });

    const [merged] = mergeDocuments({
      local: [local],
      remoteByPatient: { pat_1: [doc('doc_1', 'uploading', { uploadProgress: 0 })] },
      removedPatientIds: [],
    });

    expect(merged).toMatchObject({ status: 'uploading', uploadProgress: 40 });
  });

  /**
   * Once this device is done, the server knows more: it ran the pipeline. A
   * stale local `failed` must not survive a successful re-run elsewhere.
   */
  it('accepts a summary written after this device gave up', () => {
    const local = doc('doc_1', 'failed', { failureReason: 'ocr_failed' });

    const [merged] = mergeDocuments({
      local: [local],
      remoteByPatient: { pat_1: [doc('doc_1', 'ready', { summaryId: 'doc_1' })] },
      removedPatientIds: [],
    });

    expect(merged).toMatchObject({ status: 'ready', failureReason: null });
  });

  /** The originals are the only thing a summary can be checked against. */
  it('never drops the pages held on this phone', () => {
    const local = doc('doc_1', 'ready', { pages: [page] });

    const [merged] = mergeDocuments({
      local: [local],
      remoteByPatient: { pat_1: [doc('doc_1', 'ready')] },
      removedPatientIds: [],
    });

    expect(merged?.pages).toEqual([page]);
  });

  it('keeps a local review note the server has no field for', () => {
    const local = doc('doc_1', 'ready', {
      reviewedAt: '2026-09-02T10:00:00.000Z',
      reviewedBy: 'acc_1',
    });

    const merged = mergeOne(local, doc('doc_1', 'ready'));

    expect(merged).toMatchObject({ reviewedAt: '2026-09-02T10:00:00.000Z', reviewedBy: 'acc_1' });
  });
});

describe('documents the server stops returning', () => {
  /** Withdrawing access has to reach a phone that already holds the data. */
  it('removes the documents of a record this account can no longer reach', () => {
    const merged = mergeDocuments({
      local: [doc('doc_1', 'ready'), doc('doc_2', 'ready', { parentId: 'pat_2' })],
      remoteByPatient: { pat_2: [doc('doc_2', 'ready', { parentId: 'pat_2' })] },
      removedPatientIds: ['pat_1'],
    });

    expect(merged.map((document) => document.id)).toEqual(['doc_2']);
  });

  it('removes a document deleted on another device', () => {
    const merged = mergeDocuments({
      local: [doc('doc_gone', 'ready', { remoteId: 'doc_gone' })],
      remoteByPatient: { pat_1: [] },
      removedPatientIds: [],
    });

    expect(merged).toEqual([]);
  });

  /**
   * A capture that has not been uploaded yet is not a deletion. Dropping it
   * would throw away pages that exist nowhere else.
   */
  it('keeps an unsent capture the server has never heard of', () => {
    const local = doc('doc_draft', 'draft', { pages: [page] });

    const merged = mergeDocuments({
      local: [local],
      remoteByPatient: { pat_1: [] },
      removedPatientIds: [],
    });

    expect(merged).toEqual([local]);
  });

  /**
   * Being offline is not evidence of anything. A patient whose documents were
   * never fetched keeps what the device has.
   */
  it('keeps documents for a record that was not pulled at all', () => {
    const local = doc('doc_1', 'ready');

    const merged = mergeDocuments({
      local: [local],
      remoteByPatient: {},
      removedPatientIds: [],
    });

    expect(merged).toEqual([local]);
  });
});
