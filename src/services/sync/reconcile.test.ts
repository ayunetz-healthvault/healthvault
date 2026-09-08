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

/** Answers the list call and then per-patient document calls. */
const server = (
  patients: ReturnType<typeof patient>[],
  documents: Record<string, unknown[]> = {},
  failing: Record<string, number> = {},
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
