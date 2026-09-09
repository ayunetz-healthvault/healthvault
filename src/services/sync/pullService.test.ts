import { pullIntoVault } from './pullService';

import { setTokenProvider } from '@/services/api/client';
import {
  selectSummaryForDocument,
  useVaultStore,
  vaultSnapshot,
  type VaultSnapshot,
} from '@/state/vaultStore';

/**
 * The journey the review asked for, end to end and synthetic throughout.
 *
 * One family record, three reports in three different states, and a *second*
 * account that has never seen any of them. What that account is shown after a
 * refresh is the whole question: a queued report must not read as finished, a
 * failed one must not read as finished, and the one that genuinely finished
 * must be openable — not a status badge with nothing behind it.
 *
 * Then the grant is withdrawn, and the same refresh has to take the records
 * away again.
 */

jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  isBackendEnabled: () => true,
  isDemoBuild: () => false,
}));

/**
 * The outbox this device is holding, as the pull sees it.
 *
 * Set per test. `null` is "nobody is signed in", which is the default here and
 * genuinely means nothing can be waiting; a queue that throws is the case that
 * must not be read as "nothing is waiting".
 */
let mockOutbox: (() => Promise<unknown[]>) | null = null;

jest.mock('./pushService', () => ({
  ...jest.requireActual('./pushService'),
  currentSyncService: () => (mockOutbox === null ? null : { outbox: { all: mockOutbox } }),
}));

const fetchMock = jest.fn();

const patient = {
  patient: {
    patientId: 'pat_1',
    fullName: 'Meera Nair',
    relationship: 'mother',
    city: 'Kochi',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  role: 'viewer' as const,
};

const document = (
  documentId: string,
  title: string,
  processing: { status: string; failureCode?: string } | null,
  hasSummary = false,
) => ({
  documentId,
  parentId: 'pat_1',
  title,
  category: 'lab_report',
  documentDate: '2026-09-01',
  pageCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  processing,
  hasSummary,
});

const summaryBody = {
  documentId: 'doc_done',
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
};

const followUp = (followUpId: string, title: string, status: string) => ({
  followUpId,
  parentId: 'pat_1',
  title,
  kind: 'doctor_visit',
  dueDate: '2026-10-01',
  dueTime: null,
  notes: '',
  status,
  origin: 'manual',
  sourceDocumentId: null,
  doctorCategory: 'nephrologist',
  calendarEventId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

/**
 * A whole synthetic server: the patient list, its documents, its summaries and
 * the family's shared task list.
 */
const serve = (options: {
  reachable: boolean;
  followUps?: unknown[];
  observations?: unknown[];
  treatments?: unknown[];
  doseEvents?: unknown[];
}): void => {
  fetchMock.mockImplementation(async (requested: string) => {
    const url = String(requested);
    const ok = (body: unknown) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    });

    if (url.endsWith('/v1/patients')) return ok({ patients: options.reachable ? [patient] : [] });

    if (url.endsWith('/documents')) {
      if (!options.reachable) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          text: async () => JSON.stringify({ code: 'not_found' }),
        };
      }
      return ok({
        documents: [
          document('doc_queued', 'Chest X-ray', { status: 'queued' }),
          document('doc_failed', 'Old prescription', {
            status: 'failed',
            failureCode: 'ocr_failed',
          }),
          document('doc_done', 'Kidney panel', { status: 'ready' }, true),
        ],
      });
    }

    if (url.endsWith('/follow-ups')) {
      if (!options.reachable) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          text: async () => JSON.stringify({ code: 'not_found' }),
        };
      }
      return ok({
        followUps: options.followUps ?? [followUp('fup_clinic', 'Eye clinic', 'scheduled')],
      });
    }

    if (url.endsWith('/observations')) return ok({ observations: options.observations ?? [] });
    if (url.endsWith('/treatments')) return ok({ treatments: options.treatments ?? [] });
    if (url.endsWith('/dose-events')) return ok({ doseEvents: options.doseEvents ?? [] });

    if (url.endsWith('/doc_done/summary')) return ok({ summary: summaryBody });

    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => JSON.stringify({ code: 'not_found' }),
    };
  });
};

const snapshot = (): VaultSnapshot => vaultSnapshot();

beforeEach(() => {
  mockOutbox = null;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  setTokenProvider(async () => 'token');
  useVaultStore.getState().clearAll();
});

describe('a second account refreshing a shared record', () => {
  it('brings in the record and every document in it', async () => {
    serve({ reachable: true });

    const result = await pullIntoVault();

    expect(result).toMatchObject({ outcome: 'applied', patients: 1, documents: 3 });
    expect(snapshot().parents.map((parent) => parent.fullName)).toEqual(['Meera Nair']);
  });

  it('shows each report in the state the server says it is in', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    const byId = new Map(snapshot().documents.map((item) => [item.id, item]));

    expect(byId.get('doc_queued')).toMatchObject({ status: 'uploaded', summaryId: null });
    expect(byId.get('doc_failed')).toMatchObject({ status: 'failed', summaryId: null });
    expect(byId.get('doc_done')).toMatchObject({ status: 'ready', summaryId: 'doc_done' });
  });

  /**
   * The check the review asked for by name. A `ready` badge is worth nothing
   * if the screen behind it has no summary to render.
   */
  it('can actually open the completed summary', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    const summary = selectSummaryForDocument(snapshot(), 'doc_done');

    expect(summary).toBeDefined();
    expect(summary?.overview).toBe('Kidney function is stable.');
  });

  /** Relaunch, or simply pull again: the same records, not twice as many. */
  it('is unchanged by a second refresh', async () => {
    serve({ reachable: true });
    await pullIntoVault();
    await pullIntoVault();

    expect(snapshot().documents).toHaveLength(3);
    expect(snapshot().summaries).toHaveLength(1);
  });

  it('takes the record away once access is withdrawn', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    serve({ reachable: false });
    await pullIntoVault();

    const after = snapshot();
    expect(after.parents).toEqual([]);
    expect(after.documents).toEqual([]);
    // The summary goes with it. A revoked record that leaves its summary behind
    // has not really been revoked.
    expect(after.summaries).toEqual([]);
  });

  /**
   * A refresh that could not reach the server changes nothing — and says so,
   * so the screen can tell the user what they are looking at may be stale
   * rather than silently presenting yesterday's records as today's.
   */
  it('leaves the cached records alone when the server cannot be reached', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    fetchMock.mockRejectedValue(new Error('offline'));
    const result = await pullIntoVault();

    expect(result.outcome).toBe('failed');
    expect(snapshot().documents).toHaveLength(3);
  });
});

/**
 * The shared task list, which is the thing two people actually coordinate with.
 *
 * The journey below is the one the review asked for: one account creates a
 * task, the other sees it, completes it, and the first sees the completion.
 * Everything here goes through a fake `fetch`; nothing has been near a real
 * server, and `docs/koode/PROGRESS.md` says so.
 */
describe('follow-ups arriving from another family member', () => {
  it('appears on this phone after a refresh', async () => {
    serve({ reachable: true });

    await pullIntoVault();

    expect(snapshot().followUps.map((entry) => ({ id: entry.id, status: entry.status }))).toEqual([
      { id: 'fup_clinic', status: 'scheduled' },
    ]);
  });

  /** The completion is the fact that stops two people going to one appointment. */
  it('shows the completion the other person recorded', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    serve({
      reachable: true,
      followUps: [followUp('fup_clinic', 'Eye clinic', 'completed')],
    });
    await pullIntoVault();

    expect(snapshot().followUps[0]).toMatchObject({ id: 'fup_clinic', status: 'completed' });
  });

  it('removes one the other person deleted', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    serve({ reachable: true, followUps: [] });
    await pullIntoVault();

    expect(snapshot().followUps).toEqual([]);
  });

  it('does not accumulate duplicates across refreshes', async () => {
    serve({ reachable: true });
    await pullIntoVault();
    await pullIntoVault();

    expect(snapshot().followUps).toHaveLength(1);
  });

  it('takes the tasks away with the record when access is withdrawn', async () => {
    serve({ reachable: true });
    await pullIntoVault();

    serve({ reachable: false });
    await pullIntoVault();

    expect(snapshot().followUps).toEqual([]);
  });
});

/**
 * Deleting a task, and the pull that used to undo it.
 *
 * The screen removes the follow-up locally and then queues the DELETE, so
 * between the tap and the request reaching the server there is no local row at
 * all. The pull saw the server's copy, decided this device had never seen it,
 * and added it back — the person deleted an appointment, watched it disappear,
 * and found it on their screen again after the next refresh.
 */
describe('a follow-up deleted while the phone is offline', () => {
  const stillQueued = [
    { entity: 'follow_up', entityId: 'fup_clinic', operation: 'delete' },
  ];

  it('does not reappear on a pull while its deletion is queued', async () => {
    serve({ reachable: true });
    mockOutbox = async () => [];
    await pullIntoVault();
    expect(snapshot().followUps).toHaveLength(1);

    // Deleted here; the request has not reached the server, so the server still
    // returns it.
    useVaultStore.getState().removeFollowUp('fup_clinic');
    mockOutbox = async () => stillQueued;
    await pullIntoVault();

    expect(snapshot().followUps).toEqual([]);
  });

  it('stays gone across a failed send and another pull', async () => {
    serve({ reachable: true });
    mockOutbox = async () => [];
    await pullIntoVault();

    useVaultStore.getState().removeFollowUp('fup_clinic');
    mockOutbox = async () => stillQueued;
    await pullIntoVault();
    // The send failed and the change is still queued; refreshing again must not
    // be the thing that brings it back.
    await pullIntoVault();

    expect(snapshot().followUps).toEqual([]);
  });

  it('is finally settled by the server once the delete lands', async () => {
    serve({ reachable: true });
    mockOutbox = async () => [];
    await pullIntoVault();

    useVaultStore.getState().removeFollowUp('fup_clinic');
    mockOutbox = async () => stillQueued;
    await pullIntoVault();

    // The DELETE reaches the server and leaves the queue.
    serve({ reachable: true, followUps: [] });
    mockOutbox = async () => [];
    await pullIntoVault();

    expect(snapshot().followUps).toEqual([]);
  });

  /**
   * And an outbox that cannot be read is not an empty one. Reading a queue
   * error as "no local changes" is exactly how the deletion above comes back.
   */
  it('changes nothing when the queue cannot be read', async () => {
    serve({ reachable: true });
    mockOutbox = async () => [];
    await pullIntoVault();

    useVaultStore.getState().removeFollowUp('fup_clinic');
    mockOutbox = async () => {
      throw new Error('the outbox could not be decrypted');
    };
    const outcome = await pullIntoVault();

    // The rest of the pull still applies; only the tasks are left alone.
    expect(outcome.outcome).toBe('applied');
    expect(snapshot().followUps).toEqual([]);
    expect(snapshot().documents).toHaveLength(3);
  });
});

/**
 * The two-carer journey these records exist for.
 *
 * One person writes down what they saw and records the tablet; the other opens
 * the app and sees both. Until now all of it stayed on the first phone, which
 * made "shared care" true of documents and false of everything a carer
 * actually does in a day.
 */
describe('daily care arriving from the other carer', () => {
  const remoteNote = {
    observationId: 'obs_1',
    parentId: 'pat_1',
    text: 'Very unsteady on the stairs this morning',
    occurredAt: '2026-09-09T02:00:00.000Z',
    impact: 'a_lot',
    recordedBy: 'acc_bob',
    recordedBySelf: false,
    recordedAt: '2026-09-09T02:30:00.000Z',
    version: 1,
    updatedAt: '2026-09-09T02:30:00.000Z',
  };

  const remoteMedicine = {
    scheduleId: 'trt_1',
    parentId: 'pat_1',
    name: 'Metformin',
    dosage: '500 mg',
    times: ['20:00', '08:00'],
    timezone: 'Asia/Kolkata',
    startDate: '2026-09-01',
    endDate: null,
    provenance: 'manual',
    confirmedBy: 'acc_bob',
    confirmedAt: '2026-09-01T00:00:00.000Z',
    supersededAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const remoteDose = {
    eventId: 'dse_1',
    parentId: 'pat_1',
    scheduleId: 'trt_1',
    occurrenceKey: 'trt_1#2026-09-09#08:00',
    occurrenceAt: '2026-09-09T02:30:00.000Z',
    state: 'taken',
    recordedAt: '2026-09-09T02:35:00.000Z',
    recordedBy: 'acc_bob',
    recordedBySelf: false,
    supersedesEventId: null,
    undo: false,
    createdAt: '2026-09-09T02:35:00.000Z',
  };

  it('shows the note the other person wrote, in their words', async () => {
    serve({ reachable: true, observations: [remoteNote] });

    await pullIntoVault();

    expect(snapshot().observations).toHaveLength(1);
    expect(snapshot().observations[0]).toMatchObject({
      text: 'Very unsteady on the stairs this morning',
      impact: 'a_lot',
      recordedBySelf: false,
    });
  });

  it('shows the medicine they confirmed, with the confirmation intact', async () => {
    serve({ reachable: true, treatments: [remoteMedicine] });

    await pullIntoVault();

    expect(snapshot().schedules[0]).toMatchObject({
      name: 'Metformin',
      // Sorted, so the first dose of the day really is first.
      times: ['08:00', '20:00'],
      confirmedBy: 'acc_bob',
    });
  });

  /** The fact that stops two people giving the same tablet twice. */
  it('shows the dose they recorded', async () => {
    serve({ reachable: true, treatments: [remoteMedicine], doseEvents: [remoteDose] });

    await pullIntoVault();

    expect(snapshot().doseEvents[0]).toMatchObject({
      occurrenceKey: 'trt_1#2026-09-09#08:00',
      state: 'taken',
      recordedBySelf: false,
    });
  });

  /**
   * A dose event this phone recorded and has not sent must survive the pull.
   * Losing one would delete a dose somebody recorded, which is the single
   * thing an append-only record must never do.
   */
  it('keeps a dose recorded here that the server has not seen', async () => {
    serve({ reachable: true, treatments: [remoteMedicine], doseEvents: [remoteDose] });
    useVaultStore.setState({
      doseEvents: [
        {
          id: 'dse_local',
          patientId: 'pat_1',
          scheduleId: 'trt_1',
          occurrenceKey: 'trt_1#2026-09-09#20:00',
          occurrenceAt: '2026-09-09T14:30:00.000Z',
          state: 'taken',
          recordedAt: '2026-09-09T14:35:00.000Z',
          recordedBy: 'usr_me',
          recordedBySelf: true,
          supersedesEventId: null,
          undo: false,
          createdAt: '2026-09-09T14:35:00.000Z',
        },
      ],
    });

    await pullIntoVault();

    expect(snapshot().doseEvents.map((event) => event.id).sort()).toEqual(['dse_1', 'dse_local']);
  });

  it('does not accumulate duplicates across refreshes', async () => {
    serve({
      reachable: true,
      observations: [remoteNote],
      treatments: [remoteMedicine],
      doseEvents: [remoteDose],
    });

    await pullIntoVault();
    await pullIntoVault();

    expect(snapshot().observations).toHaveLength(1);
    expect(snapshot().schedules).toHaveLength(1);
    expect(snapshot().doseEvents).toHaveLength(1);
  });

  it('takes all three away with the record when access is withdrawn', async () => {
    serve({
      reachable: true,
      observations: [remoteNote],
      treatments: [remoteMedicine],
      doseEvents: [remoteDose],
    });
    await pullIntoVault();

    serve({ reachable: false });
    await pullIntoVault();

    expect(snapshot().observations).toEqual([]);
    expect(snapshot().schedules).toEqual([]);
    expect(snapshot().doseEvents).toEqual([]);
  });
});
