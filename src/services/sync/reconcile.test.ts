import { pullRecords, toParentProfile } from './reconcile';

import { setTokenProvider } from '@/services/api/client';
import type { ParentProfile } from '@/types/domain';

/**
 * Reading the shared record back.
 *
 * Two behaviours carry the story. A record the server no longer returns is
 * removed from the device — that is the only way revocation reaches a phone
 * that already has the data. And a pull never blanks what the user typed but
 * the server does not yet hold.
 */

const fetchMock = jest.fn();

const patient = (patientId: string, fullName: string) => ({
  patient: {
    patientId,
    fullName,
    relationship: 'mother',
    city: 'Kochi',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  role: 'manager' as const,
});

/** A summary body in the shape the pipeline writes and the server stores. */
const storedSummary = (documentId: string) => ({
  documentId,
  pipelineVersion: 'test-1',
  createdAt: '2026-09-02T00:00:00.000Z',
  summary: {
    overview: 'Kidney function is stable.',
    plainLanguageSummary: 'The numbers look much the same as last time.',
    findings: [],
    medicines: [],
    instructions: [],
    questionsForDoctor: [],
    recommendedDoctorCategory: 'nephrologist',
    confidence: 0.9,
    pipelineVersion: 'test-1',
  },
  privacy: {
    redactionApplied: true,
    possiblePiiRemaining: false,
    redactedEntityCounts: { patientName: 2 },
    pipelineVersion: 'test-1',
  },
});

/** Answers the list call, per-patient document calls and summary reads. */
const server = (
  patients: ReturnType<typeof patient>[],
  documents: Record<string, unknown[]> = {},
  failing: Record<string, number> = {},
  summaries: Record<string, unknown> = {},
  followUps: Record<string, unknown[]> = {},
): void => {
  fetchMock.mockImplementation(async (requested: string) => {
    const url = String(requested);

    for (const [patientId, status] of Object.entries(failing)) {
      if (url.includes(`/patients/${patientId}/documents`)) {
        return {
          ok: false,
          status,
          headers: { get: () => null },
          text: async () => JSON.stringify({ code: 'not_found' }),
        };
      }
    }

    const summaryMatch = /\/documents\/([^/]+)\/summary$/.exec(url);
    if (summaryMatch) {
      const stored = summaries[summaryMatch[1] as string];
      if (stored === undefined) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          text: async () => JSON.stringify({ code: 'not_found' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ summary: stored }),
      };
    }

    const followUpMatch = /\/patients\/([^/]+)\/follow-ups$/.exec(url);
    if (followUpMatch) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({ followUps: followUps[followUpMatch[1] as string] ?? [] }),
      };
    }

    const documentMatch = /\/patients\/([^/]+)\/documents$/.exec(url);
    const body = documentMatch
      ? { documents: documents[documentMatch[1] as string] ?? [] }
      : { patients };

    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  });
};

/** A server document, with the processing fields the list route now returns. */
const remoteDocument = (
  documentId: string,
  processing: { status: string; failureCode?: string } | null,
  hasSummary = false,
) => ({
  documentId,
  parentId: 'pat_1',
  title: 'Blood test report',
  category: 'lab_report',
  documentDate: '2026-09-01',
  pageCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  processing,
  hasSummary,
});

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
});

describe('pulling records', () => {
  it('returns every record the account can reach', async () => {
    server([patient('pat_1', 'Meera Nair'), patient('pat_2', 'Ravi Nair')]);

    const pulled = await pullRecords([]);

    expect(pulled.patients.map((entry) => entry.patient.fullName)).toEqual([
      'Meera Nair',
      'Ravi Nair',
    ]);
  });

  it('fetches each record’s documents', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [
        {
          documentId: 'doc_1',
          parentId: 'pat_1',
          title: 'Blood test report',
          category: 'lab_report',
          documentDate: '2026-09-01',
          pageCount: 2,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });

    const pulled = await pullRecords([]);

    expect(pulled.documentsByPatient.pat_1).toHaveLength(1);
    expect(pulled.documentsByPatient.pat_1?.[0]).toMatchObject({
      id: 'doc_1',
      title: 'Blood test report',
    });
  });

  /**
   * The only way revocation reaches a phone that already has the data. Exactly
   * as strong as "the next time this device is online", which the UI says.
   */
  it('reports a cached record the server no longer returns', async () => {
    server([patient('pat_1', 'Meera Nair')]);

    const pulled = await pullRecords(['pat_1', 'pat_revoked']);

    expect(pulled.removedPatientIds).toEqual(['pat_revoked']);
  });

  it('reports nothing removed when everything is still reachable', async () => {
    server([patient('pat_1', 'Meera Nair')]);

    expect((await pullRecords(['pat_1'])).removedPatientIds).toEqual([]);
  });

  /**
   * A grant withdrawn between the list call and the document call must not stop
   * the rest of the family from updating.
   */
  it('carries on when one record becomes unreachable mid-pull', async () => {
    server(
      [patient('pat_1', 'Meera Nair'), patient('pat_2', 'Ravi Nair')],
      {},
      { pat_1: 404 },
    );

    const pulled = await pullRecords([]);

    expect(pulled.patients.map((entry) => entry.patient.patientId)).toEqual(['pat_2']);
    expect(pulled.removedPatientIds).toEqual([]);
  });

  it('treats a record that became forbidden as removed when it was cached', async () => {
    server([patient('pat_1', 'Meera Nair')], {}, { pat_1: 403 });

    expect((await pullRecords(['pat_1'])).removedPatientIds).toEqual(['pat_1']);
  });

  it('lets a real failure through rather than silently returning less', async () => {
    server([patient('pat_1', 'Meera Nair')], {}, { pat_1: 500 });

    await expect(pullRecords([])).rejects.toMatchObject({ kind: 'server' });
  });
});

/**
 * The states a document can be in, and what a second device is told.
 *
 * This suite exists because of a defect, not a feature: every pulled document
 * used to be mapped to `ready` with no summary and no failure. A caregiver on
 * a second phone saw a report that had failed to process listed as finished,
 * opened it, and found nothing — with no way to tell that nothing was coming.
 *
 * Each case below is one state a real record spends time in, so none of them
 * can quietly collapse back into "ready" again.
 */
describe('a second device pulling a record mid-pipeline', () => {
  it('shows a queued report as waiting, not finished', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_queued', { status: 'queued' })],
    });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    expect(document).toMatchObject({ status: 'uploaded', summaryId: null, failureReason: null });
  });

  it('shows a report still being read as being read', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_working', { status: 'processing' })],
    });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    expect(document?.status).toBe('processing');
  });

  it('shows a report another device is still uploading as unfinished', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_partial', { status: 'awaiting_upload' })],
    });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    // Not 100%: this device knows nothing about that upload's real progress.
    expect(document).toMatchObject({ status: 'uploading', uploadProgress: 0 });
  });

  it('carries a failure across, with the code and no summary', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_failed', { status: 'failed', failureCode: 'ocr_failed' })],
    });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    expect(document).toMatchObject({
      status: 'failed',
      summaryId: null,
      failureReason: 'ocr_failed',
    });
  });

  /**
   * The state the app had no word for, which is how it ended up as `ready`.
   * Nothing went wrong that a retry would fix, and no summary is coming.
   */
  it('shows a report set aside for a person as needing one', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_manual', { status: 'manual_review' })],
    });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    expect(document).toMatchObject({ status: 'needs_review', summaryId: null });
  });

  it('does not claim a document is finished when nothing has processed it', async () => {
    server([patient('pat_1', 'Meera Nair')], { pat_1: [remoteDocument('doc_new', null)] });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    expect(document?.status).not.toBe('ready');
    expect(document?.summaryId).toBeNull();
  });

  /**
   * A server contradicting itself — ready, but no summary row. The client is
   * not the place to resolve that, but it is the place to refuse to send
   * somebody to an empty screen.
   */
  it('refuses to call a document ready when there is no summary behind it', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_odd', { status: 'ready' }, false)],
    });

    const [document] = (await pullRecords([])).documentsByPatient.pat_1 ?? [];

    expect(document).toMatchObject({ status: 'needs_review', summaryId: null });
  });
});

describe('pulling a completed summary', () => {
  it('fetches the summary so the finished report can actually be opened', async () => {
    server(
      [patient('pat_1', 'Meera Nair')],
      { pat_1: [remoteDocument('doc_done', { status: 'ready' }, true)] },
      {},
      { doc_done: storedSummary('doc_done') },
    );

    const pulled = await pullRecords([]);
    const [document] = pulled.documentsByPatient.pat_1 ?? [];

    expect(document).toMatchObject({ status: 'ready', summaryId: 'doc_done' });
    expect(pulled.summariesByDocumentId.doc_done).toMatchObject({
      documentId: 'doc_done',
      overview: 'Kidney function is stable.',
    });
  });

  /** The caveat travels with the summary, so both phones show the same one. */
  it('keeps the redaction result that was recorded for that run', async () => {
    server(
      [patient('pat_1', 'Meera Nair')],
      { pat_1: [remoteDocument('doc_done', { status: 'ready' }, true)] },
      {},
      { doc_done: storedSummary('doc_done') },
    );

    const pulled = await pullRecords([]);

    expect(pulled.summariesByDocumentId.doc_done?.privacy).toMatchObject({
      redactionApplied: true,
      possiblePiiRemaining: false,
    });
  });

  it('does not refetch a summary this device already holds', async () => {
    server(
      [patient('pat_1', 'Meera Nair')],
      { pat_1: [remoteDocument('doc_done', { status: 'ready' }, true)] },
      {},
      { doc_done: storedSummary('doc_done') },
    );

    await pullRecords([], { cachedSummaryDocumentIds: ['doc_done'] });

    const summaryCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith('/summary'),
    );
    expect(summaryCalls).toHaveLength(0);
  });

  /**
   * A summary that cannot be read is not allowed to fail the whole pull. The
   * document still arrives and still says what state the server thinks it is
   * in — the phone failing to read it is a different fact from it not existing.
   */
  it('still returns the document when its summary cannot be fetched', async () => {
    server([patient('pat_1', 'Meera Nair')], {
      pat_1: [remoteDocument('doc_done', { status: 'ready' }, true)],
    });

    const pulled = await pullRecords([]);

    expect(pulled.documentsByPatient.pat_1).toHaveLength(1);
    expect(pulled.summariesByDocumentId).toEqual({});
  });
});

describe('mapping a record onto the local shape', () => {
  const remote = {
    patientId: 'pat_1',
    fullName: 'Meera Nair',
    relationship: 'mother',
    city: 'Kochi',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('creates a usable profile from nothing', async () => {
    expect(toParentProfile(remote, undefined)).toMatchObject({
      id: 'pat_1',
      fullName: 'Meera Nair',
      city: 'Kochi',
    });
  });

  /**
   * Conditions, allergies and the doctor's name are still only local. Blanking
   * them on every sync would destroy what the user typed.
   */
  it('keeps what the server does not hold', async () => {
    const existing: ParentProfile = {
      id: 'pat_1',
      fullName: 'Old name',
      relationship: 'mother',
      dateOfBirth: '1957-04-02',
      bloodGroup: 'O+',
      city: 'Chennai',
      phone: '+91 90000 00000',
      conditions: ['Type 2 diabetes'],
      allergies: ['Penicillin'],
      primaryDoctor: 'Dr Priya',
      notes: 'Prefers morning appointments',
      avatarColor: '#145B48',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const merged = toParentProfile(remote, existing);

    expect(merged).toMatchObject({
      // Taken from the server, which is authoritative for these.
      fullName: 'Meera Nair',
      city: 'Kochi',
      // Kept, because the server does not hold them.
      conditions: ['Type 2 diabetes'],
      allergies: ['Penicillin'],
      primaryDoctor: 'Dr Priya',
      notes: 'Prefers morning appointments',
      phone: '+91 90000 00000',
    });
  });
});

/**
 * The shared task list, coming down.
 *
 * A follow-up is the record that exists because somebody else has to act on it,
 * and the pull did not fetch them at all: a task created on one phone appeared
 * on no other, however long anybody waited. The endpoint had been there the
 * whole time.
 */
describe('pulling the family’s follow-ups', () => {
  const remoteFollowUp = (followUpId: string, overrides: Record<string, unknown> = {}) => ({
    followUpId,
    parentId: 'pat_1',
    title: 'Eye clinic',
    kind: 'doctor_visit',
    dueDate: '2026-10-01',
    dueTime: '10:30',
    notes: 'Fasting not needed',
    status: 'scheduled',
    origin: 'manual',
    sourceDocumentId: null,
    doctorCategory: 'ophthalmologist',
    calendarEventId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });

  it('brings back the tasks another person created', async () => {
    server([patient('pat_1', 'Meera Nair')], {}, {}, {}, { pat_1: [remoteFollowUp('fup_1')] });

    const pulled = await pullRecords([]);

    expect(pulled.followUpsByPatient.pat_1).toEqual([
      expect.objectContaining({
        id: 'fup_1',
        parentId: 'pat_1',
        title: 'Eye clinic',
        kind: 'doctor_visit',
        dueTime: '10:30',
        status: 'scheduled',
      }),
    ]);
  });

  it('carries a completed task across as completed', async () => {
    server(
      [patient('pat_1', 'Meera Nair')],
      {},
      {},
      {},
      { pat_1: [remoteFollowUp('fup_1', { status: 'completed' })] },
    );

    const pulled = await pullRecords([]);

    expect(pulled.followUpsByPatient.pat_1?.[0]?.status).toBe('completed');
  });

  /**
   * A status this app has no label for must never be read as done. Somebody
   * would see a tick against an appointment nobody has been to.
   */
  it('reads a status it does not recognise as still scheduled', async () => {
    server(
      [patient('pat_1', 'Meera Nair')],
      {},
      {},
      {},
      { pat_1: [remoteFollowUp('fup_1', { status: 'rescheduled_by_clinic' })] },
    );

    const pulled = await pullRecords([]);

    expect(pulled.followUpsByPatient.pat_1?.[0]?.status).toBe('scheduled');
  });

  it('reads a kind it does not recognise as other', async () => {
    server(
      [patient('pat_1', 'Meera Nair')],
      {},
      {},
      {},
      { pat_1: [remoteFollowUp('fup_1', { kind: 'dialysis' })] },
    );

    expect((await pullRecords([])).followUpsByPatient.pat_1?.[0]?.kind).toBe('other');
  });

  /**
   * A record that went away mid-pull takes its tasks with it, and leaves
   * nothing half-pulled behind — a patient whose documents arrived and whose
   * follow-ups did not is a partial view of a record this account can no longer
   * reach.
   */
  it('drops a record that became unreachable while it was being read', async () => {
    server(
      [patient('pat_1', 'Meera Nair'), patient('pat_2', 'Ravi Nair')],
      { pat_1: [], pat_2: [] },
      { pat_2: 404 },
      {},
      { pat_1: [remoteFollowUp('fup_1')] },
    );

    const pulled = await pullRecords(['pat_1', 'pat_2']);

    expect(pulled.followUpsByPatient.pat_2).toBeUndefined();
    expect(pulled.documentsByPatient.pat_2).toBeUndefined();
    expect(pulled.removedPatientIds).toEqual(['pat_2']);
  });
});
