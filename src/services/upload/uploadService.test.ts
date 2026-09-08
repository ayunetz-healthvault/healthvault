import AsyncStorage from '@react-native-async-storage/async-storage';

import { uploadService } from './uploadService';
import { createUploadSessions } from './uploadSession';

import { ApiError } from '@/services/api/errors';
import { destroyVaultKey } from '@/services/storage/vaultCrypto';
import type { DocumentPage } from '@/types/domain';

/**
 * Getting a document into the record, and finishing one that was interrupted.
 *
 * The tests that matter are the resume cases. A parent photographs a discharge
 * summary in a hospital corridor, three pages go up, and the phone is put away.
 * What must not happen on the next launch is starting over, sending a page
 * twice, or filing the remaining pages against a document that was never
 * created.
 */

const ACCOUNT = 'acc_alice';
const PATIENT = 'pat_1';
const LOCAL_ID = 'doc_local_1';

let uploaded: { url: string; method: string }[];
let uploadStatus: number;
let missingFiles: Set<string>;

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///document' }, cache: { uri: 'file:///cache' } },
  Directory: jest.fn(),
  File: class {
    // A plain field rather than a parameter property: Babel's jest.mock
    // transform reads `readonly uri` in the constructor signature as an
    // out-of-scope reference and refuses the factory.
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return !mockMissingFiles.has(this.uri);
    }

    async upload(url: string, options: { httpMethod: string }): Promise<{ status: number }> {
      mockUploaded.push({ url, method: options.httpMethod });
      return { status: mockUploadStatus() };
    }
  },
}));

// `mock`-prefixed so the factory above may close over them.
const mockUploaded: { url: string; method: string }[] = [];
const mockMissingFiles = new Set<string>();
const mockUploadStatus = (): number => uploadStatus;

jest.mock('@/config/env', () => ({
  config: {
    environment: 'local',
    aws: { region: 'ap-south-1', documentsBucket: 'b' },
    api: { baseUrl: 'https://api.test.invalid', timeoutMs: 5000, processingTimeoutMs: 5000 },
    upload: { presignTtlSeconds: 900, maxUploadBytes: 10 * 1024 * 1024 },
    cognito: { userPoolId: '', appClientId: '', domain: '', redirectUri: '' },
    features: { aiSummary: true, calendarSync: true, biometricLock: true },
    sentryDsn: null,
  },
  isBackendEnabled: () => true,
  isDemoBuild: () => false,
}));

const page = (id: string, sizeBytes = 1024): DocumentPage => ({
  id,
  uri: `file:///document/${id}.jpg`,
  kind: 'image',
  source: 'camera',
  fileName: `${id}.jpg`,
  sizeBytes,
  width: 1000,
  height: 1400,
  capturedAt: '2026-09-08T10:00:00.000Z',
});

const fetchMock = jest.fn();

/** Answers the three API calls in order: create, presign, complete. */
const serverAnswers = (options: { alreadyQueued?: boolean } = {}): void => {
  fetchMock.mockImplementation(async (url: string) => {
    const body =
      typeof url === 'string' && url.includes('/uploads/complete')
        ? { alreadyQueued: options.alreadyQueued ?? false }
        : typeof url === 'string' && url.includes('/uploads')
          ? {
              uploads: [1, 2, 3].map((number) => ({
                page: number,
                key: `patients/${PATIENT}/documents/doc_server_1/pages/00${number}`,
                url: `https://objects.test.invalid/page-${number}`,
                expiresInSeconds: 900,
                headers: { 'Content-Type': 'image/jpeg' },
              })),
            }
          : { document: { documentId: 'doc_server_1' } };

    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  });
};

const upload = (pages: DocumentPage[]): Promise<unknown> =>
  uploadService.uploadDocument({
    accountId: ACCOUNT,
    patientId: PATIENT,
    localDocumentId: LOCAL_ID,
    title: 'Blood test report',
    category: 'lab_report',
    documentDate: '2026-09-01',
    pages,
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  await destroyVaultKey(ACCOUNT);
  uploaded = mockUploaded;
  uploaded.length = 0;
  mockMissingFiles.clear();
  missingFiles = mockMissingFiles;
  uploadStatus = 200;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('a clean upload', () => {
  it('creates the record, sends every page, then completes', async () => {
    serverAnswers();

    const result = await upload([page('pag_1'), page('pag_2')]);

    expect(result).toMatchObject({ serverDocumentId: 'doc_server_1', queued: true });
    expect(uploaded).toHaveLength(2);
    expect(uploaded.every((entry) => entry.method === 'PUT')).toBe(true);
  });

  it('sends the bytes straight to the object store, not through the API', async () => {
    serverAnswers();

    await upload([page('pag_1')]);

    expect(uploaded[0]?.url).toContain('objects.test.invalid');
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('objects.test.invalid');
    }
  });

  /** A locally generated id is not a cloud id. */
  it('records the id the server gave the document', async () => {
    serverAnswers();

    await upload([page('pag_1')]);

    expect(await createUploadSessions(ACCOUNT).get(LOCAL_ID)).toMatchObject({
      serverDocumentId: 'doc_server_1',
    });
  });

  it('reports progress that reaches every page', async () => {
    serverAnswers();
    const seen: number[] = [];

    await uploadService.uploadDocument({
      accountId: ACCOUNT,
      patientId: PATIENT,
      localDocumentId: LOCAL_ID,
      title: 'Report',
      category: 'lab_report',
      documentDate: '2026-09-01',
      pages: [page('pag_1'), page('pag_2')],
      onProgress: (progress) => seen.push(progress.percent),
    });

    expect(seen.at(-1)).toBe(100);
  });
});

describe('resuming after the app was closed', () => {
  it('does not create the document a second time', async () => {
    serverAnswers();
    const sessions = createUploadSessions(ACCOUNT);
    await sessions.start({ localDocumentId: LOCAL_ID, patientId: PATIENT, pageCount: 2 });
    await sessions.attachServerId(LOCAL_ID, 'doc_server_1');

    await upload([page('pag_1'), page('pag_2')]);

    const creates = fetchMock.mock.calls.filter(
      (call) => String(call[0]).endsWith('/documents') && (call[1] as { method: string }).method === 'POST',
    );
    expect(creates).toHaveLength(0);
  });

  /** Re-sending is wasted bytes on a connection that already struggled once. */
  it('sends only the pages that had not landed', async () => {
    serverAnswers();
    const sessions = createUploadSessions(ACCOUNT);
    await sessions.start({ localDocumentId: LOCAL_ID, patientId: PATIENT, pageCount: 3 });
    await sessions.attachServerId(LOCAL_ID, 'doc_server_1');
    await sessions.markPageUploaded(LOCAL_ID, 1);
    await sessions.markPageUploaded(LOCAL_ID, 2);

    await upload([page('pag_1'), page('pag_2'), page('pag_3')]);

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.url).toContain('page-3');
  });

  it('asks for fresh URLs rather than reusing ones that have expired', async () => {
    serverAnswers();
    await upload([page('pag_1')]);

    const presignCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith('/uploads'),
    );
    // Requested during the upload, never persisted for later.
    expect(presignCalls).toHaveLength(1);
    const stored = JSON.stringify(await createUploadSessions(ACCOUNT).all());
    expect(stored).not.toContain('objects.test.invalid');
  });

  it('lists an interrupted upload so the user can be told', async () => {
    const sessions = createUploadSessions(ACCOUNT);
    await sessions.start({ localDocumentId: LOCAL_ID, patientId: PATIENT, pageCount: 2 });

    expect(await uploadService.resumable(ACCOUNT)).toHaveLength(1);
  });

  it('stops listing an upload once it finished', async () => {
    serverAnswers();
    await upload([page('pag_1')]);

    expect(await uploadService.resumable(ACCOUNT)).toEqual([]);
  });

  it('does not count another account’s interrupted uploads', async () => {
    const sessions = createUploadSessions(ACCOUNT);
    await sessions.start({ localDocumentId: LOCAL_ID, patientId: PATIENT, pageCount: 1 });

    expect(await uploadService.resumable('acc_bob')).toEqual([]);
  });
});

describe('when something goes wrong', () => {
  /**
   * Assuming success would complete a document with a missing page, and the
   * summary would silently omit whatever was on it.
   */
  it('does not mark a page uploaded when the store refused it', async () => {
    serverAnswers();
    uploadStatus = 403;

    await expect(upload([page('pag_1')])).rejects.toBeInstanceOf(ApiError);

    expect(await createUploadSessions(ACCOUNT).get(LOCAL_ID)).toMatchObject({
      uploadedPages: [],
    });
  });

  it('keeps the pages it did send when a later one fails', async () => {
    serverAnswers();
    const pages = [page('pag_1'), page('pag_2')];
    missingFiles.add(pages[1]?.uri as string);

    await expect(upload(pages)).rejects.toBeInstanceOf(ApiError);

    expect(await createUploadSessions(ACCOUNT).get(LOCAL_ID)).toMatchObject({
      uploadedPages: [1],
    });
  });

  it('says so plainly when a page is no longer on the phone', async () => {
    serverAnswers();
    const pages = [page('pag_1')];
    missingFiles.add(pages[0]?.uri as string);

    await expect(upload(pages)).rejects.toMatchObject({
      kind: 'not_found',
      message: expect.stringMatching(/no longer on this phone/i),
    });
  });

  it('refuses a page larger than the upload limit', async () => {
    serverAnswers();

    await expect(upload([page('pag_1', 50 * 1024 * 1024)])).rejects.toMatchObject({
      kind: 'too_large',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses more pages than the backend accepts, before calling it', async () => {
    serverAnswers();
    const pages = Array.from({ length: 11 }, (_, index) => page(`pag_${index}`));

    await expect(upload(pages)).rejects.toMatchObject({ kind: 'too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a document with no pages', async () => {
    await expect(upload([])).rejects.toBeInstanceOf(ApiError);
  });

  it('reports a repeated completion as already queued rather than as new', async () => {
    serverAnswers({ alreadyQueued: true });

    expect(await upload([page('pag_1')])).toMatchObject({ queued: false });
  });
});
