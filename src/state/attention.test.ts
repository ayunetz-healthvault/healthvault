import { countAttentionItems, selectAttentionItems } from './attention';
import type { VaultSnapshot } from './vaultStore';

import type { FollowUp, MedicalDocument } from '@/types/domain';

const NOW = new Date('2026-09-08T09:00:00.000Z');

const followUp = (patch: Partial<FollowUp> & Pick<FollowUp, 'id' | 'parentId'>): FollowUp => ({
  title: 'Review appointment',
  kind: 'doctor_visit',
  dueDate: '2026-09-20',
  dueTime: null,
  notes: '',
  status: 'scheduled',
  sourceDocumentId: null,
  doctorCategory: null,
  calendarEventId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...patch,
});

const document = (
  patch: Partial<MedicalDocument> & Pick<MedicalDocument, 'id' | 'parentId'>,
): MedicalDocument => ({
  title: 'Blood test report',
  category: 'lab_report',
  documentDate: '2026-09-01',
  pages: [],
  status: 'ready',
  uploadProgress: 100,
  summaryId: 'sum_1',
  failureReason: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...patch,
});

const snapshot = (patch: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  parents: [],
  documents: [],
  summaries: [],
  followUps: [],
  schedules: [],
  doseEvents: [],
  ...patch,
});

describe('selectAttentionItems', () => {
  it('lists a follow-up whose due date has passed', () => {
    const state = snapshot({
      followUps: [followUp({ id: 'f1', parentId: 'p1', dueDate: '2026-09-01' })],
    });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([
      expect.objectContaining({ kind: 'overdue_follow_up', parentId: 'p1', route: '/follow-up/f1' }),
    ]);
  });

  it('leaves a follow-up that is merely upcoming alone', () => {
    const state = snapshot({
      followUps: [followUp({ id: 'f1', parentId: 'p1', dueDate: '2026-10-01' })],
    });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([]);
  });

  it('ignores a passed date on a follow-up somebody already completed', () => {
    const state = snapshot({
      followUps: [
        followUp({ id: 'f1', parentId: 'p1', dueDate: '2026-09-01', status: 'completed' }),
        followUp({ id: 'f2', parentId: 'p1', dueDate: '2026-09-01', status: 'cancelled' }),
      ],
    });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([]);
  });

  it('lists a document whose processing failed', () => {
    const state = snapshot({
      documents: [
        document({ id: 'd1', parentId: 'p1', status: 'failed', failureReason: 'Page unreadable' }),
      ],
    });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([
      expect.objectContaining({ kind: 'document_failed', route: '/document/d1' }),
    ]);
  });

  it('does not repeat the pipeline failure text, which can name the document', () => {
    const state = snapshot({
      documents: [
        document({
          id: 'd1',
          parentId: 'p1',
          status: 'failed',
          failureReason: 'Page 2 of meera-nair-report.pdf could not be read',
        }),
      ],
    });

    expect(selectAttentionItems(state, { now: NOW })[0]?.detail).not.toContain('meera');
  });

  it('lists a ready summary nobody has checked yet', () => {
    const state = snapshot({ documents: [document({ id: 'd1', parentId: 'p1' })] });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([
      expect.objectContaining({ kind: 'document_needs_review' }),
    ]);
  });

  it('drops a summary once somebody has checked it', () => {
    const state = snapshot({
      documents: [
        document({ id: 'd1', parentId: 'p1', reviewedAt: '2026-09-05T10:00:00.000Z' }),
      ],
    });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([]);
  });

  it('treats a document written before review existed as unreviewed', () => {
    // `reviewedAt` absent entirely, as on every record seeded before KOO-01.
    const state = snapshot({ documents: [document({ id: 'd1', parentId: 'p1' })] });

    expect(selectAttentionItems(state, { now: NOW })).toHaveLength(1);
  });

  it('says nothing about a document still uploading or processing', () => {
    const state = snapshot({
      documents: [
        document({ id: 'd1', parentId: 'p1', status: 'uploading', summaryId: null }),
        document({ id: 'd2', parentId: 'p1', status: 'processing', summaryId: null }),
        document({ id: 'd3', parentId: 'p1', status: 'draft', summaryId: null }),
      ],
    });

    expect(selectAttentionItems(state, { now: NOW })).toEqual([]);
  });

  it('puts a passed date above a failure, and a failure above an unchecked summary', () => {
    const state = snapshot({
      documents: [
        document({ id: 'd1', parentId: 'p1' }),
        document({ id: 'd2', parentId: 'p1', status: 'failed', summaryId: null }),
      ],
      followUps: [followUp({ id: 'f1', parentId: 'p1', dueDate: '2026-09-01' })],
    });

    expect(selectAttentionItems(state, { now: NOW }).map((item) => item.kind)).toEqual([
      'overdue_follow_up',
      'document_failed',
      'document_needs_review',
    ]);
  });

  it('restricts to one record when asked', () => {
    const state = snapshot({
      followUps: [
        followUp({ id: 'f1', parentId: 'p1', dueDate: '2026-09-01' }),
        followUp({ id: 'f2', parentId: 'p2', dueDate: '2026-09-01' }),
      ],
    });

    expect(selectAttentionItems(state, { parentId: 'p2', now: NOW })).toEqual([
      expect.objectContaining({ parentId: 'p2' }),
    ]);
  });

  /**
   * The rule the whole product turns on: absence is not an event. A record with
   * nothing in it produces an empty list, never a reassurance and never an
   * alarm.
   */
  it('reports an empty record as nothing to do, not as anything about health', () => {
    expect(selectAttentionItems(snapshot(), { now: NOW })).toEqual([]);
    expect(countAttentionItems(snapshot(), 'p1', NOW)).toBe(0);
  });

  it('gives every item a stable id so a list can key on it', () => {
    const state = snapshot({
      documents: [document({ id: 'd1', parentId: 'p1' })],
      followUps: [followUp({ id: 'f1', parentId: 'p1', dueDate: '2026-09-01' })],
    });

    const first = selectAttentionItems(state, { now: NOW }).map((item) => item.id);
    const second = selectAttentionItems(state, { now: NOW }).map((item) => item.id);

    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
  });
});

describe('countAttentionItems', () => {
  it('counts only the named record', () => {
    const state = snapshot({
      documents: [document({ id: 'd1', parentId: 'p1' }), document({ id: 'd2', parentId: 'p2' })],
    });

    expect(countAttentionItems(state, 'p1', NOW)).toBe(1);
  });
});
