import { createEncryptedStore } from '@/services/storage/encryptedStore';
import { nowIso } from '@/utils/date';

/**
 * What is known about an upload that has not finished.
 *
 * Persisted, encrypted, per account — because the thing this exists to survive
 * is the app being closed. A parent photographs a discharge summary in a
 * hospital corridor, the upload gets three pages in, and the phone is put away.
 * Without this the next launch has bytes on disk, a record in `awaiting_upload`
 * and no idea which pages already landed, so the only safe move is to start
 * again or give up.
 */

const SESSIONS_KEY = 'upload-sessions';

export interface UploadSession {
  /**
   * The id the **server** gave this document.
   *
   * Not the local one. A locally generated id is not a cloud id, and treating
   * it as one is how a resumed upload files pages against a document that does
   * not exist. Null until the create call has succeeded, which is exactly the
   * state a resume needs to distinguish.
   */
  readonly serverDocumentId: string | null;
  readonly localDocumentId: string;
  readonly patientId: string;
  /** Page numbers confirmed to be in the object store. */
  readonly uploadedPages: number[];
  readonly pageCount: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** Set once the completion call has been acknowledged. */
  readonly completedAt?: string | undefined;
}

export interface UploadSessions {
  all(): Promise<UploadSession[]>;
  get(localDocumentId: string): Promise<UploadSession | null>;
  start(input: {
    localDocumentId: string;
    patientId: string;
    pageCount: number;
  }): Promise<UploadSession>;
  /** Records the server's id for this document, once it has one. */
  attachServerId(localDocumentId: string, serverDocumentId: string): Promise<void>;
  markPageUploaded(localDocumentId: string, page: number): Promise<void>;
  markComplete(localDocumentId: string): Promise<void>;
  discard(localDocumentId: string): Promise<void>;
  /** Sessions that still have work outstanding. Drives resume on launch. */
  unfinished(): Promise<UploadSession[]>;
}

export const createUploadSessions = (accountId: string): UploadSessions => {
  const store = createEncryptedStore(accountId);

  const read = async (): Promise<UploadSession[]> =>
    (await store.read<UploadSession[]>(SESSIONS_KEY)) ?? [];
  const write = async (sessions: UploadSession[]): Promise<void> => {
    await store.write(SESSIONS_KEY, sessions);
  };

  const update = async (
    localDocumentId: string,
    change: (session: UploadSession) => UploadSession,
  ): Promise<void> => {
    const sessions = await read();
    const index = sessions.findIndex((session) => session.localDocumentId === localDocumentId);
    if (index === -1) return;
    const next = change(sessions[index] as UploadSession);
    await write(sessions.map((session, at) => (at === index ? next : session)));
  };

  return {
    all: read,

    async get(localDocumentId) {
      return (
        (await read()).find((session) => session.localDocumentId === localDocumentId) ?? null
      );
    },

    async start({ localDocumentId, patientId, pageCount }) {
      const existing = await this.get(localDocumentId);
      // Resuming, not restarting. Returning the existing session is what keeps
      // already-uploaded pages from being sent a second time.
      if (existing !== null) return existing;

      const session: UploadSession = {
        serverDocumentId: null,
        localDocumentId,
        patientId,
        uploadedPages: [],
        pageCount,
        startedAt: nowIso(),
        updatedAt: nowIso(),
      };
      await write([...(await read()), session]);
      return session;
    },

    async attachServerId(localDocumentId, serverDocumentId) {
      await update(localDocumentId, (session) => ({
        ...session,
        serverDocumentId,
        updatedAt: nowIso(),
      }));
    },

    async markPageUploaded(localDocumentId, page) {
      await update(localDocumentId, (session) => ({
        ...session,
        // A set, so a retried page does not appear twice and make the count
        // exceed `pageCount`.
        uploadedPages: [...new Set([...session.uploadedPages, page])].sort((a, b) => a - b),
        updatedAt: nowIso(),
      }));
    },

    async markComplete(localDocumentId) {
      await update(localDocumentId, (session) => ({
        ...session,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      }));
    },

    async discard(localDocumentId) {
      await write(
        (await read()).filter((session) => session.localDocumentId !== localDocumentId),
      );
    },

    async unfinished() {
      return (await read()).filter((session) => session.completedAt === undefined);
    },
  };
};
