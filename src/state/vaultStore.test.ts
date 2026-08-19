import {
  selectDocumentTimeline,
  selectFollowUpsForParent,
  selectOverdueFollowUps,
  selectParentStats,
  selectSummaryForDocument,
  selectUpcomingFollowUps,
  useVaultStore,
  type VaultSnapshot,
} from './vaultStore';

import type { ParentDraft } from '@/types/domain';
import { isoToday } from '@/utils/date';

const draft = (overrides: Partial<ParentDraft> = {}): ParentDraft => ({
  fullName: 'Lakshmi Iyer',
  relationship: 'mother',
  dateOfBirth: '1955-04-18',
  bloodGroup: 'B+',
  city: 'Chennai',
  phone: '',
  conditions: [],
  allergies: [],
  primaryDoctor: '',
  notes: '',
  ...overrides,
});

const snapshot = (): VaultSnapshot => {
  const state = useVaultStore.getState();
  return {
    parents: state.parents,
    documents: state.documents,
    summaries: state.summaries,
    followUps: state.followUps,
  };
};

beforeEach(() => {
  useVaultStore.getState().clearAll();
});

describe('parents', () => {
  it('assigns an id, an avatar colour and timestamps', () => {
    const parent = useVaultStore.getState().addParent(draft());

    expect(parent.id).toMatch(/^par_/);
    expect(parent.avatarColor).toMatch(/^#/);
    expect(parent.createdAt).toBe(parent.updatedAt);
    expect(useVaultStore.getState().parents).toHaveLength(1);
  });

  it('applies a partial update and bumps updatedAt', () => {
    const parent = useVaultStore.getState().addParent(draft());
    useVaultStore.getState().updateParent(parent.id, { city: 'Bengaluru' });

    const updated = useVaultStore.getState().parents[0]!;
    expect(updated.city).toBe('Bengaluru');
    expect(updated.fullName).toBe('Lakshmi Iyer');
  });

  it('takes documents, summaries and follow-ups with it when deleted', () => {
    const store = useVaultStore.getState();
    const parent = store.addParent(draft());
    const other = store.addParent(draft({ fullName: 'Ramesh Iyer' }));

    store.addDocument({
      id: 'doc_1',
      parentId: parent.id,
      title: 'Lab report',
      category: 'lab_report',
      documentDate: '2026-07-12',
      pages: [],
      status: 'ready',
      uploadProgress: 100,
      summaryId: 'sum_1',
      failureReason: null,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    store.addSummary({
      id: 'sum_1',
      documentId: 'doc_1',
      parentId: parent.id,
      overview: '',
      plainLanguageSummary: '',
      findings: [],
      medicines: [],
      instructions: [],
      recommendedDoctorCategory: 'general_physician',
      questionsForDoctor: [],
      confidence: 0.9,
      generatedBy: 'test',
      generatedAt: '2026-07-12T00:00:00.000Z',
    });
    store.addFollowUp({
      parentId: parent.id,
      title: 'Review',
      kind: 'doctor_visit',
      dueDate: isoToday(3),
      dueTime: null,
      notes: '',
      sourceDocumentId: 'doc_1',
      doctorCategory: null,
    });
    store.addFollowUp({
      parentId: other.id,
      title: 'Physio',
      kind: 'physiotherapy',
      dueDate: isoToday(1),
      dueTime: null,
      notes: '',
      sourceDocumentId: null,
      doctorCategory: null,
    });

    useVaultStore.getState().removeParent(parent.id);
    const after = useVaultStore.getState();

    expect(after.parents.map((item) => item.id)).toEqual([other.id]);
    expect(after.documents).toHaveLength(0);
    expect(after.summaries).toHaveLength(0);
    // The other parent's follow-up is untouched.
    expect(after.followUps).toHaveLength(1);
    expect(after.followUps[0]?.parentId).toBe(other.id);
  });
});

describe('documents', () => {
  const seedDocument = (id: string, parentId: string, createdAt: string): void => {
    useVaultStore.getState().addDocument({
      id,
      parentId,
      title: `Document ${id}`,
      category: 'lab_report',
      documentDate: '2026-07-12',
      pages: [],
      status: 'draft',
      uploadProgress: 0,
      summaryId: null,
      failureReason: null,
      createdAt,
      updatedAt: createdAt,
    });
  };

  it('patches status without clobbering the other fields', () => {
    seedDocument('doc_1', 'par_1', '2026-07-12T00:00:00.000Z');
    useVaultStore.getState().updateDocumentStatus('doc_1', 'uploading', { uploadProgress: 40 });

    const document = useVaultStore.getState().documents[0]!;
    expect(document.status).toBe('uploading');
    expect(document.uploadProgress).toBe(40);
    expect(document.summaryId).toBeNull();
    expect(document.title).toBe('Document doc_1');
  });

  it('leaves untouched fields alone when no extras are passed', () => {
    seedDocument('doc_1', 'par_1', '2026-07-12T00:00:00.000Z');
    useVaultStore.getState().updateDocumentStatus('doc_1', 'uploading', { uploadProgress: 60 });
    useVaultStore.getState().updateDocumentStatus('doc_1', 'uploaded');

    expect(useVaultStore.getState().documents[0]?.uploadProgress).toBe(60);
  });

  it('deletes the summary but keeps the follow-up, unlinking it', () => {
    seedDocument('doc_1', 'par_1', '2026-07-12T00:00:00.000Z');
    useVaultStore.getState().addSummary({
      id: 'sum_1',
      documentId: 'doc_1',
      parentId: 'par_1',
      overview: '',
      plainLanguageSummary: '',
      findings: [],
      medicines: [],
      instructions: [],
      recommendedDoctorCategory: 'general_physician',
      questionsForDoctor: [],
      confidence: 0.9,
      generatedBy: 'test',
      generatedAt: '2026-07-12T00:00:00.000Z',
    });
    const followUp = useVaultStore.getState().addFollowUp({
      parentId: 'par_1',
      title: 'Review',
      kind: 'doctor_visit',
      dueDate: isoToday(3),
      dueTime: null,
      notes: '',
      sourceDocumentId: 'doc_1',
      doctorCategory: null,
    });

    useVaultStore.getState().removeDocument('doc_1');
    const after = useVaultStore.getState();

    expect(after.documents).toHaveLength(0);
    expect(after.summaries).toHaveLength(0);
    expect(after.followUps.find((item) => item.id === followUp.id)?.sourceDocumentId).toBeNull();
  });

  it('replaces an existing summary for the same document', () => {
    const base = {
      parentId: 'par_1',
      overview: '',
      plainLanguageSummary: '',
      findings: [],
      medicines: [],
      instructions: [],
      recommendedDoctorCategory: 'general_physician' as const,
      questionsForDoctor: [],
      confidence: 0.9,
      generatedBy: 'test',
      generatedAt: '2026-07-12T00:00:00.000Z',
    };

    useVaultStore.getState().addSummary({ ...base, id: 'sum_1', documentId: 'doc_1' });
    useVaultStore.getState().addSummary({ ...base, id: 'sum_2', documentId: 'doc_1' });

    const summaries = useVaultStore.getState().summaries;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.id).toBe('sum_2');
  });

  it('orders a parent’s timeline newest first', () => {
    seedDocument('doc_old', 'par_1', '2026-01-01T00:00:00.000Z');
    seedDocument('doc_new', 'par_1', '2026-07-01T00:00:00.000Z');
    seedDocument('doc_other', 'par_2', '2026-08-01T00:00:00.000Z');

    expect(selectDocumentTimeline(snapshot(), 'par_1').map((item) => item.id)).toEqual([
      'doc_new',
      'doc_old',
    ]);
  });
});

describe('follow-ups', () => {
  const addFollowUp = (parentId: string, dueDate: string, title = 'Task') =>
    useVaultStore.getState().addFollowUp({
      parentId,
      title,
      kind: 'doctor_visit',
      dueDate,
      dueTime: null,
      notes: '',
      sourceDocumentId: null,
      doctorCategory: null,
    });

  it('defaults a new follow-up to scheduled with no calendar event', () => {
    const followUp = addFollowUp('par_1', isoToday(5));

    expect(followUp.status).toBe('scheduled');
    expect(followUp.calendarEventId).toBeNull();
    expect(followUp.id).toMatch(/^fup_/);
  });

  it('changes status', () => {
    const followUp = addFollowUp('par_1', isoToday(5));
    useVaultStore.getState().setFollowUpStatus(followUp.id, 'completed');

    expect(useVaultStore.getState().followUps[0]?.status).toBe('completed');
  });

  it('attaches and clears a calendar event id', () => {
    const followUp = addFollowUp('par_1', isoToday(5));

    useVaultStore.getState().attachCalendarEvent(followUp.id, 'event-1');
    expect(useVaultStore.getState().followUps[0]?.calendarEventId).toBe('event-1');

    useVaultStore.getState().attachCalendarEvent(followUp.id, null);
    expect(useVaultStore.getState().followUps[0]?.calendarEventId).toBeNull();
  });

  it('lists only scheduled items as upcoming, soonest first', () => {
    addFollowUp('par_1', isoToday(10), 'Later');
    addFollowUp('par_1', isoToday(2), 'Sooner');
    const done = addFollowUp('par_1', isoToday(1), 'Done');
    useVaultStore.getState().setFollowUpStatus(done.id, 'completed');

    expect(selectUpcomingFollowUps(snapshot()).map((item) => item.title)).toEqual([
      'Sooner',
      'Later',
    ]);
  });

  it('honours the upcoming limit', () => {
    addFollowUp('par_1', isoToday(1));
    addFollowUp('par_1', isoToday(2));
    addFollowUp('par_1', isoToday(3));

    expect(selectUpcomingFollowUps(snapshot(), 2)).toHaveLength(2);
  });

  it('counts only past-due scheduled items as overdue', () => {
    addFollowUp('par_1', isoToday(-2), 'Missed refill');
    addFollowUp('par_1', isoToday(3), 'Future visit');
    const doneLate = addFollowUp('par_1', isoToday(-5), 'Already done');
    useVaultStore.getState().setFollowUpStatus(doneLate.id, 'completed');

    expect(selectOverdueFollowUps(snapshot()).map((item) => item.title)).toEqual(['Missed refill']);
  });

  it('scopes follow-ups to one parent', () => {
    addFollowUp('par_1', isoToday(1), 'Mine');
    addFollowUp('par_2', isoToday(1), 'Theirs');

    expect(selectFollowUpsForParent(snapshot(), 'par_1').map((item) => item.title)).toEqual([
      'Mine',
    ]);
  });

  it('removes a follow-up', () => {
    const followUp = addFollowUp('par_1', isoToday(1));
    useVaultStore.getState().removeFollowUp(followUp.id);

    expect(useVaultStore.getState().followUps).toHaveLength(0);
  });
});

describe('selectParentStats', () => {
  it('summarises documents, upcoming and overdue counts', () => {
    const store = useVaultStore.getState();
    const parent = store.addParent(draft());

    store.addDocument({
      id: 'doc_1',
      parentId: parent.id,
      title: 'Report',
      category: 'lab_report',
      documentDate: '2026-07-12',
      pages: [],
      status: 'ready',
      uploadProgress: 100,
      summaryId: null,
      failureReason: null,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });

    const base = {
      parentId: parent.id,
      kind: 'doctor_visit' as const,
      dueTime: null,
      notes: '',
      sourceDocumentId: null,
      doctorCategory: null,
    };
    store.addFollowUp({ ...base, title: 'Overdue', dueDate: isoToday(-1) });
    store.addFollowUp({ ...base, title: 'Soon', dueDate: isoToday(2) });

    const stats = selectParentStats(snapshot(), parent.id);

    expect(stats.documentCount).toBe(1);
    expect(stats.upcomingCount).toBe(2);
    expect(stats.overdueCount).toBe(1);
    // Sorted by due date, so the overdue one is next up.
    expect(stats.nextFollowUp?.title).toBe('Overdue');
  });

  it('reports zeros for a parent with nothing on file', () => {
    const parent = useVaultStore.getState().addParent(draft());

    expect(selectParentStats(snapshot(), parent.id)).toEqual({
      documentCount: 0,
      upcomingCount: 0,
      overdueCount: 0,
      nextFollowUp: undefined,
    });
  });
});

describe('selectSummaryForDocument', () => {
  it('returns undefined when nothing has been summarised', () => {
    expect(selectSummaryForDocument(snapshot(), 'doc_missing')).toBeUndefined();
  });
});

describe('seedDemoData', () => {
  it('populates the vault on a fresh install', () => {
    useVaultStore.setState({
      parents: [],
      documents: [],
      summaries: [],
      followUps: [],
      seeded: false,
    });
    useVaultStore.getState().seedDemoData();

    const state = useVaultStore.getState();
    expect(state.parents.length).toBeGreaterThan(0);
    expect(state.documents.length).toBeGreaterThan(0);
    expect(state.followUps.length).toBeGreaterThan(0);
  });

  it('does not overwrite a vault that already has records', () => {
    useVaultStore.setState({
      parents: [],
      documents: [],
      summaries: [],
      followUps: [],
      seeded: false,
    });
    const parent = useVaultStore.getState().addParent(draft({ fullName: 'Real Person' }));

    useVaultStore.getState().seedDemoData();

    expect(useVaultStore.getState().parents).toEqual([parent]);
  });

  it('reports whether it actually seeded', () => {
    useVaultStore.setState({
      parents: [],
      documents: [],
      summaries: [],
      followUps: [],
      seeded: false,
    });

    expect(useVaultStore.getState().seedDemoData()).toBe(true);
    expect(useVaultStore.getState().seedDemoData()).toBe(false);
  });
});

/**
 * The bug this guards: `seedDemoData` was called on every first launch and
 * gated only on the vault being empty. A live build's first real caregiver
 * would therefore open the app to two parents they had never met, carrying
 * invented medicines and doses. Fictional records are the point of a demo and a
 * safety problem anywhere else.
 */
describe('seeding in a live build', () => {
  const inLiveBuild = <T>(run: (store: typeof import('./vaultStore')) => T): T => {
    const original = { ...process.env };
    let result!: T;

    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_ENV = 'prod';
      process.env.EXPO_PUBLIC_DEMO = 'false';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      result = run(require('./vaultStore') as typeof import('./vaultStore'));
    });

    process.env = original;
    return result;
  };

  it('refuses to put fictional records in a real caregiver’s vault', () => {
    inLiveBuild((store) => {
      store.useVaultStore.setState({
        parents: [],
        documents: [],
        summaries: [],
        followUps: [],
        seeded: false,
      });

      expect(store.useVaultStore.getState().seedDemoData()).toBe(false);

      const state = store.useVaultStore.getState();
      expect(state.parents).toEqual([]);
      expect(state.documents).toEqual([]);
      expect(state.followUps).toEqual([]);
    });
  });

  it('refuses to reset a live vault, which would be data loss', () => {
    inLiveBuild((store) => {
      store.useVaultStore.setState({
        parents: [],
        documents: [],
        summaries: [],
        followUps: [],
        seeded: false,
      });
      const parent = store.useVaultStore.getState().addParent(draft({ fullName: 'Real Person' }));

      expect(store.useVaultStore.getState().resetDemoData()).toBe(false);
      expect(store.useVaultStore.getState().parents).toEqual([parent]);
    });
  });
});

describe('resetDemoData', () => {
  it('puts the vault back for the next demonstration', () => {
    useVaultStore.setState({
      parents: [],
      documents: [],
      summaries: [],
      followUps: [],
      seeded: false,
    });
    useVaultStore.getState().addParent(draft({ fullName: 'Added During The Demo' }));

    expect(useVaultStore.getState().resetDemoData()).toBe(true);

    const names = useVaultStore.getState().parents.map((parent) => parent.fullName);
    expect(names).not.toContain('Added During The Demo');
    expect(names.length).toBeGreaterThan(0);
  });
});
