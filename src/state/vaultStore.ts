import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { isDemoBuild } from '@/config/env';
import { MOCK_DOCUMENTS, MOCK_SUMMARIES } from '@/mocks/documents';
import { buildMockFollowUps } from '@/mocks/followUps';
import { MOCK_PARENTS } from '@/mocks/parents';
import { activeVaultStorage } from '@/services/storage/activeVault';
import { mergeDocuments } from '@/services/sync/mergeDocuments';
import { mergeFollowUps, type PendingChange } from '@/services/sync/mergeFollowUps';
import type {
  DocumentSummary,
  SummaryCorrection,
  FollowUp,
  FollowUpDraft,
  FollowUpStatus,
  MedicalDocument,
  ParentDraft,
  ParentProfile,
  ProcessingStatus,
} from '@/types/domain';
import { occurrencesForDay } from '@/services/treatment/occurrences';
import type { Observation, VisitQuestion } from '@/types/observations';
import type { DoseEvent, DoseOccurrence, TreatmentSchedule } from '@/types/treatment';
import { byCreatedAtDesc, byDueDateAsc, isOverdue, nowIso } from '@/utils/date';
import { avatarColorFor } from '@/utils/format';
import { createId } from '@/utils/id';

/**
 * The record vault: parents, documents, summaries and follow-ups.
 *
 * One store rather than four, because almost every mutation crosses entities —
 * deleting a parent has to take their documents, summaries and follow-ups with
 * it, and a summary can create a follow-up. Keeping that in one reducer avoids
 * a half-deleted vault.
 *
 * Writes are local-first. TODO(backend): each mutation below gets a matching
 * call from `endpoints`, queued and retried when offline.
 *
 * ## Where this is persisted
 *
 * Encrypted, and namespaced by the signed-in account — see `activeVault.ts`.
 * The store itself knows nothing about accounts: the storage adapter resolves
 * the current one on every call, so signing in as somebody else changes what
 * this store reads without a line here changing.
 *
 * Two consequences worth stating. Nothing is written while signed out. And
 * `hydrateForAccount` must be called after a sign-in, because the middleware
 * hydrates once at construction — when nobody was signed in and there was, by
 * design, nothing to read.
 */

/**
 * A completed pull, in the shape the store applies.
 *
 * Deliberately not `PulledRecords`: that type carries the server's patient
 * payload, and translating it into profiles is the caller's job — the store
 * should not have to know what a `RemotePatient` looks like.
 */
/**
 * What somebody confirms when they say "yes, I am taking this".
 *
 * `times` and `confirmedBy` are required and have no defaults, because those
 * two fields are the whole difference between a medicine a model read on a
 * prescription and a medicine somebody is actually taking.
 */
export interface ScheduleConfirmation {
  readonly patientId: string;
  readonly name: string;
  readonly dosage: string;
  /** `HH:mm`, in `timezone`. Chosen by a person, never parsed from "twice a day". */
  readonly times: string[];
  readonly timezone: string;
  readonly startDate: string;
  readonly endDate: string | null;
  /** The document this was read from, or null when it was typed in. */
  readonly source: TreatmentSchedule['source'];
  readonly confirmedBy: string;
}

export interface ObservationDraft {
  readonly patientId: string;
  readonly text: string;
  /** When it happened, which is not when it was written down. */
  readonly occurredAt: string;
  readonly impact: Observation['impact'];
  readonly recordedBy: string;
  readonly recordedBySelf: boolean;
}

export interface VisitQuestionDraft {
  readonly patientId: string;
  readonly text: string;
  readonly origin: VisitQuestion['origin'];
  readonly source?: VisitQuestion['source'];
  readonly askedBy: string;
  readonly askedBySelf: boolean;
  readonly order?: number;
}

export interface AppliedPull {
  readonly parents: ParentProfile[];
  readonly documentsByPatient: Record<string, MedicalDocument[]>;
  /** Keyed by the server's document id. */
  readonly summaries: Record<string, DocumentSummary>;
  /** The shared task list, keyed by patient. */
  readonly followUpsByPatient: Record<string, FollowUp[]>;
  /**
   * Follow-up changes still queued on this device, or `unknown` when the outbox
   * could not be read.
   *
   * The pull must not overwrite those: the outbox is holding the only copy of
   * what somebody just did, and the server's row is the state before they did
   * it. A pending *delete* has no local row at all, which is why the operation
   * travels with the id — see `mergeFollowUps`.
   */
  readonly pendingFollowUps: readonly PendingChange[] | 'unknown';
  readonly removedPatientIds: string[];
}

interface VaultState {
  parents: ParentProfile[];
  documents: MedicalDocument[];
  summaries: DocumentSummary[];
  followUps: FollowUp[];
  /**
   * Medicines somebody has confirmed they are taking.
   *
   * Never written by the summary pipeline. A medicine a model read off a
   * prescription is a `MedicineMention`; it becomes a schedule only when a
   * person confirms it, with times they chose — see `confirmSchedule`.
   */
  schedules: TreatmentSchedule[];
  /**
   * What somebody noticed, in their own words.
   *
   * Never classified, never mapped to a clinical term. See
   * `types/observations.ts` for why there is no severity scale here.
   */
  observations: Observation[];
  /** Questions to ask at the next visit, including suggestions once accepted. */
  visitQuestions: VisitQuestion[];
  /**
   * What happened to each dose. Append-only, including undo.
   *
   * "Did my mother take her tablet this morning" is a question about the
   * record, and a record that can be quietly erased cannot answer it.
   */
  doseEvents: DoseEvent[];
  /**
   * When this device last confirmed the record against the server.
   *
   * Null means never — a demonstration build, or an account that has not been
   * online since signing in. Shown wherever the app presents the record as a
   * whole (the visit list especially), because a list assembled from a week-old
   * copy may be missing whatever a sibling added since, and a page that looks
   * complete while quietly omitting that is worse than no page.
   */
  lastPulledAt: string | null;
  seeded: boolean;

  // --- Seed -----------------------------------------------------------------
  /**
   * Loads the fictional demonstration records.
   *
   * Refuses outright in a live build, and is a no-op once the vault has
   * content. Returns whether it seeded, so a caller can tell "already had
   * records" from "not a demo build".
   */
  seedDemoData: () => boolean;
  /** Wipes the vault and reloads the demonstration records. Demo builds only. */
  resetDemoData: () => boolean;
  clearAll: () => void;

  // --- Parents --------------------------------------------------------------
  addParent: (draft: ParentDraft) => ParentProfile;
  updateParent: (id: string, patch: Partial<ParentDraft>) => void;
  removeParent: (id: string) => void;

  // --- Documents ------------------------------------------------------------
  addDocument: (document: MedicalDocument) => void;
  /**
   * Records the id the server issued for a document this device uploaded.
   *
   * Without it the next pull sees an id it does not recognise and files a
   * second copy of the same report.
   */
  attachRemoteId: (id: string, remoteId: string) => void;
  updateDocumentStatus: (
    id: string,
    status: ProcessingStatus,
    extra?: { uploadProgress?: number; summaryId?: string | null; failureReason?: string | null },
  ) => void;
  removeDocument: (id: string) => void;

  // --- Summaries ------------------------------------------------------------
  addSummary: (summary: DocumentSummary) => void;
  /**
   * Appends a correction to a summary.
   *
   * Appends, and never edits `summary`. A person saying "the date is 3
   * September, not 9 March" is a *second* fact about the document, and losing
   * the first means nobody can tell whether the model was wrong or they were.
   */
  addCorrection: (documentId: string, correction: SummaryCorrection) => void;
  /** Records that a person checked this version against the original. */
  markSummaryReviewed: (documentId: string, reviewedBy: string, version: number) => void;

  // --- Treatment ------------------------------------------------------------
  /**
   * Turns a confirmed medicine into a schedule.
   *
   * Takes `confirmedBy` because there is no such thing as a schedule nobody
   * confirmed: the argument is required so a caller cannot create one by
   * omission. Supersedes any live schedule for the same medicine rather than
   * editing it, so the previous instructions stay readable.
   */
  confirmSchedule: (draft: ScheduleConfirmation) => TreatmentSchedule;
  /** Stops a schedule without deleting it. */
  supersedeSchedule: (scheduleId: string) => void;
  /** Records a dose event. Ignores null, which is what a no-op tap produces. */
  appendDoseEvent: (event: DoseEvent | null) => void;

  // --- Observations and questions -------------------------------------------
  addObservation: (draft: ObservationDraft) => Observation;
  updateObservation: (id: string, patch: { text?: string; impact?: Observation['impact'] }) => void;
  removeObservation: (id: string) => void;
  /**
   * Adds a question.
   *
   * `origin` is required, and `accepted_suggestion` means exactly that: a
   * person read the summariser's suggestion and chose to ask it. There is no
   * path that adds a suggestion without somebody accepting it.
   */
  addVisitQuestion: (draft: VisitQuestionDraft) => VisitQuestion;
  removeVisitQuestion: (id: string) => void;

  // --- Sync -----------------------------------------------------------------
  /**
   * Applies what the server returned to what this device holds.
   *
   * The merge rules live in `mergeDocuments`, deliberately outside the store:
   * deciding whether the phone or the server is right about a given document is
   * the part worth testing, and it does not need a store to be tested.
   */
  applyPulledRecords: (pulled: AppliedPull) => void;

  // --- Follow-ups -----------------------------------------------------------
  addFollowUp: (draft: FollowUpDraft) => FollowUp;
  updateFollowUp: (id: string, patch: Partial<FollowUp>) => void;
  setFollowUpStatus: (id: string, status: FollowUpStatus) => void;
  removeFollowUp: (id: string) => void;
}

/** The one name the persist middleware and the hydration path must agree on. */
export const VAULT_STORAGE_KEY = 'vault';

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      parents: [],
      documents: [],
      summaries: [],
      followUps: [],
      schedules: [],
      doseEvents: [],
      observations: [],
      visitQuestions: [],
      lastPulledAt: null,
      seeded: false,

      seedDemoData: () => {
        /**
         * The guard that matters is `isDemoBuild()`.
         *
         * Without it this ran on every first launch, so the first real
         * caregiver to install a live build would open the app and find two
         * parents they have never met, with medicines and dosages attached.
         * Fictional records are safe in a demo and are a serious problem
         * anywhere else — a person could act on a dose that was invented to
         * fill a screenshot.
         */
        if (!isDemoBuild()) return false;
        if (get().seeded || get().parents.length > 0) return false;

        set({
          parents: [...MOCK_PARENTS],
          documents: [...MOCK_DOCUMENTS],
          summaries: [...MOCK_SUMMARIES],
          followUps: buildMockFollowUps(),
          seeded: true,
        });
        return true;
      },

      resetDemoData: () => {
        // For the second demo of the day: put the vault back exactly as the
        // first one found it, including anything the audience added.
        if (!isDemoBuild()) return false;

        set({
          parents: [...MOCK_PARENTS],
          documents: [...MOCK_DOCUMENTS],
          summaries: [...MOCK_SUMMARIES],
          followUps: buildMockFollowUps(),
          seeded: true,
        });
        return true;
      },

      clearAll: () =>
        set({
          parents: [],
          documents: [],
          summaries: [],
          followUps: [],
          schedules: [],
          doseEvents: [],
          observations: [],
          visitQuestions: [],
          lastPulledAt: null,
          seeded: true,
        }),

      // --- Parents ------------------------------------------------------------
      addParent: (draft) => {
        const timestamp = nowIso();
        const parent: ParentProfile = {
          ...draft,
          id: createId('par'),
          avatarColor: draft.avatarColor ?? avatarColorFor(draft.fullName),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        set((state) => ({ parents: [...state.parents, parent] }));
        return parent;
      },

      updateParent: (id, patch) =>
        set((state) => ({
          parents: state.parents.map((parent) =>
            parent.id === id ? { ...parent, ...patch, updatedAt: nowIso() } : parent,
          ),
        })),

      removeParent: (id) =>
        set((state) => {
          const documentIds = new Set(
            state.documents.filter((doc) => doc.parentId === id).map((doc) => doc.id),
          );
          return {
            parents: state.parents.filter((parent) => parent.id !== id),
            documents: state.documents.filter((doc) => doc.parentId !== id),
            summaries: state.summaries.filter((summary) => !documentIds.has(summary.documentId)),
            followUps: state.followUps.filter((followUp) => followUp.parentId !== id),
          };
        }),

      // --- Documents ----------------------------------------------------------
      addDocument: (document) => set((state) => ({ documents: [document, ...state.documents] })),

      attachRemoteId: (id, remoteId) =>
        set((state) => ({
          documents: state.documents.map((doc) => (doc.id === id ? { ...doc, remoteId } : doc)),
        })),

      updateDocumentStatus: (id, status, extra = {}) =>
        set((state) => ({
          documents: state.documents.map((doc) =>
            doc.id === id
              ? {
                  ...doc,
                  status,
                  updatedAt: nowIso(),
                  ...(extra.uploadProgress === undefined
                    ? {}
                    : { uploadProgress: extra.uploadProgress }),
                  ...(extra.summaryId === undefined ? {} : { summaryId: extra.summaryId }),
                  ...(extra.failureReason === undefined
                    ? {}
                    : { failureReason: extra.failureReason }),
                }
              : doc,
          ),
        })),

      removeDocument: (id) =>
        set((state) => ({
          documents: state.documents.filter((doc) => doc.id !== id),
          summaries: state.summaries.filter((summary) => summary.documentId !== id),
          // Follow-ups outlive their source document — the appointment still
          // matters even if the report is deleted — so only the link is cut.
          followUps: state.followUps.map((followUp) =>
            followUp.sourceDocumentId === id ? { ...followUp, sourceDocumentId: null } : followUp,
          ),
        })),

      // --- Summaries ----------------------------------------------------------
      addSummary: (summary) =>
        set((state) => ({
          summaries: [
            ...state.summaries.filter((existing) => existing.documentId !== summary.documentId),
            summary,
          ],
        })),

      // --- Follow-ups ---------------------------------------------------------
      applyPulledRecords: ({
        parents,
        documentsByPatient,
        summaries,
        followUpsByPatient,
        pendingFollowUps,
        removedPatientIds,
      }) =>
        set((state) => {
          const removed = new Set(removedPatientIds);

          const documents = mergeDocuments({
            local: state.documents,
            remoteByPatient: documentsByPatient,
            removedPatientIds,
          });

          const keptDocumentIds = new Set(documents.map((doc) => doc.id));
          const byId = new Map(state.parents.map((parent) => [parent.id, parent]));
          for (const parent of parents) byId.set(parent.id, parent);
          for (const patientId of removed) byId.delete(patientId);

          /**
           * A pulled summary is filed under the id the *local* record uses,
           * which is not always the server's — a document this device uploaded
           * keeps its local id. Looking it up here rather than at the fetch
           * keeps `reconcile` free of the store.
           */
          const localIdFor = new Map(
            documents.flatMap((doc) => (doc.remoteId ? [[doc.remoteId, doc.id] as const] : [])),
          );

          const pulledSummaries = Object.entries(summaries).flatMap(
            ([remoteDocumentId, summary]) => {
              const documentId = localIdFor.get(remoteDocumentId) ?? remoteDocumentId;
              if (!keptDocumentIds.has(documentId)) return [];
              return [{ ...summary, documentId }];
            },
          );

          const pulledFor = new Set(pulledSummaries.map((summary) => summary.documentId));

          return {
            // Set only here, where a pull actually succeeded. A failed refresh
            // must never move this forward — that is the whole point of it.
            lastPulledAt: nowIso(),
            parents: [...byId.values()],
            documents,
            summaries: [
              // A revoked or deleted record takes its summaries with it, and a
              // freshly pulled summary replaces the copy this device had.
              ...state.summaries.filter(
                (summary) =>
                  keptDocumentIds.has(summary.documentId) && !pulledFor.has(summary.documentId),
              ),
              ...pulledSummaries,
            ],
            followUps: mergeFollowUps({
              local: state.followUps,
              remoteByPatient: followUpsByPatient,
              removedPatientIds,
              pending: pendingFollowUps,
            }),
          };
        }),

      addCorrection: (documentId, correction) =>
        set((state) => ({
          summaries: state.summaries.map((summary) =>
            summary.documentId === documentId
              ? { ...summary, corrections: [...(summary.corrections ?? []), correction] }
              : summary,
          ),
        })),

      markSummaryReviewed: (documentId, reviewedBy, version) => {
        const timestamp = nowIso();

        set((state) => ({
          summaries: state.summaries.map((summary) =>
            summary.documentId === documentId
              ? {
                  ...summary,
                  reviewedAt: timestamp,
                  reviewedBy,
                  reviewedVersion: version,
                }
              : summary,
          ),
          // Mirrored onto the document so a list can show which summaries
          // nobody has checked without loading every summary.
          documents: state.documents.map((document) =>
            document.id === documentId
              ? { ...document, reviewedAt: timestamp, reviewedBy, updatedAt: timestamp }
              : document,
          ),
        }));
      },

      confirmSchedule: (draft) => {
        const timestamp = nowIso();

        const schedule: TreatmentSchedule = {
          id: createId('trt'),
          patientId: draft.patientId,
          name: draft.name,
          dosage: draft.dosage,
          times: [...draft.times].sort(),
          timezone: draft.timezone,
          startDate: draft.startDate,
          endDate: draft.endDate,
          provenance: draft.source === null ? 'manual' : 'from_document',
          source: draft.source,
          /**
           * Both required by the type, and both come from the caller. There is
           * no default here on purpose: a schedule nobody confirmed is a
           * reading of a document, and this app must not turn one into
           * reminders to take a drug.
           */
          confirmedBy: draft.confirmedBy,
          confirmedAt: timestamp,
          supersededAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          schedules: [
            /**
             * A live schedule for the same medicine is superseded, not edited.
             * Somebody whose dose changed from 500 mg to 250 mg has a history
             * worth keeping — and the doses already recorded against the old
             * schedule stay attached to what was actually being taken then.
             */
            ...state.schedules.map((existing) =>
              existing.patientId === draft.patientId &&
              existing.supersededAt === null &&
              existing.name.trim().toLowerCase() === draft.name.trim().toLowerCase()
                ? { ...existing, supersededAt: timestamp, updatedAt: timestamp }
                : existing,
            ),
            schedule,
          ],
        }));

        return schedule;
      },

      supersedeSchedule: (scheduleId) =>
        set((state) => ({
          schedules: state.schedules.map((schedule) =>
            schedule.id === scheduleId && schedule.supersededAt === null
              ? { ...schedule, supersededAt: nowIso(), updatedAt: nowIso() }
              : schedule,
          ),
        })),

      /**
       * Null is accepted and ignored.
       *
       * `recordDose` returns null when the tap would change nothing — the same
       * dose already in the same state. Handling that here means no screen has
       * to remember to check, which is how a double tap becomes two entries for
       * one tablet.
       */
      appendDoseEvent: (event) =>
        set((state) => (event === null ? state : { doseEvents: [...state.doseEvents, event] })),

      addObservation: (draft) => {
        const timestamp = nowIso();

        const observation: Observation = {
          id: createId('obs'),
          patientId: draft.patientId,
          // Stored exactly as written. Trimmed only of surrounding whitespace —
          // never normalised, never mapped to a term. See the type.
          text: draft.text.trim(),
          occurredAt: draft.occurredAt,
          impact: draft.impact,
          recordedBy: draft.recordedBy,
          recordedBySelf: draft.recordedBySelf,
          recordedAt: timestamp,
          version: 1,
          updatedAt: timestamp,
        };

        set((state) => ({ observations: [...state.observations, observation] }));
        return observation;
      },

      updateObservation: (id, patch) =>
        set((state) => ({
          observations: state.observations.map((observation) =>
            observation.id === id
              ? {
                  ...observation,
                  ...(patch.text === undefined ? {} : { text: patch.text.trim() }),
                  ...(patch.impact === undefined ? {} : { impact: patch.impact }),
                  // Bumped so a concurrent change is a conflict, not a race.
                  version: observation.version + 1,
                  updatedAt: nowIso(),
                }
              : observation,
          ),
        })),

      removeObservation: (id) =>
        set((state) => ({
          observations: state.observations.filter((observation) => observation.id !== id),
        })),

      addVisitQuestion: (draft) => {
        const timestamp = nowIso();

        const question: VisitQuestion = {
          id: createId('obs'),
          patientId: draft.patientId,
          text: draft.text.trim(),
          origin: draft.origin,
          source: draft.source ?? null,
          askedBy: draft.askedBy,
          askedBySelf: draft.askedBySelf,
          createdAt: timestamp,
          order: draft.order ?? 0,
          version: 1,
          updatedAt: timestamp,
        };

        set((state) => ({ visitQuestions: [...state.visitQuestions, question] }));
        return question;
      },

      removeVisitQuestion: (id) =>
        set((state) => ({
          visitQuestions: state.visitQuestions.filter((question) => question.id !== id),
        })),

      addFollowUp: (draft) => {
        const timestamp = nowIso();
        const followUp: FollowUp = {
          ...draft,
          id: createId('fup'),
          status: draft.status ?? 'scheduled',
          calendarEventId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        set((state) => ({ followUps: [...state.followUps, followUp] }));
        return followUp;
      },

      updateFollowUp: (id, patch) =>
        set((state) => ({
          followUps: state.followUps.map((followUp) =>
            followUp.id === id ? { ...followUp, ...patch, updatedAt: nowIso() } : followUp,
          ),
        })),

      setFollowUpStatus: (id, status) => get().updateFollowUp(id, { status }),

      removeFollowUp: (id) =>
        set((state) => ({ followUps: state.followUps.filter((followUp) => followUp.id !== id) })),
    }),
    {
      name: VAULT_STORAGE_KEY,
      storage: createJSONStorage(() => activeVaultStorage),
    },
  ),
);

/**
 * Re-reads the vault for whoever is signed in now.
 *
 * The persist middleware hydrates exactly once, when the store is created —
 * which happens at import time, before anybody has signed in and while the
 * storage adapter is correctly refusing to read anything. Without this call the
 * vault would stay empty for the whole session.
 *
 * ## Why it checks storage before touching state
 *
 * The obvious implementation — clear the store, then rehydrate — destroys the
 * records it is trying to load. The persist middleware writes on *every* state
 * change, so clearing first saves an empty vault over the stored one, and the
 * rehydrate that follows reads back what the clear just wrote. It only appeared
 * to work because the write and the read race, and the read usually won.
 *
 * So: look first. If the account has something stored, rehydrate reads it with
 * no destructive write in front of it. If it has nothing, the store is emptied
 * — which is the case that matters for account switching, because otherwise the
 * previous account's records would simply stay in memory.
 */
export const hydrateVaultForAccount = async (): Promise<void> => {
  const stored = await activeVaultStorage.getItem(VAULT_STORAGE_KEY);

  if (stored === null) {
    closeVaultInMemory();
    return;
  }

  await useVaultStore.persist.rehydrate();
};

/**
 * Empties the vault in memory.
 *
 * **Detach the storage first.** The persist middleware writes on every state
 * change, so calling this while the vault is still open for an account saves an
 * empty vault over that account's records — a sign-out that silently deletes
 * everything on the device. `closeVault()` then `closeVaultInMemory()`, in that
 * order, every time.
 *
 * With the storage detached the rows stay where they are, encrypted under a key
 * only that account has, so signing back in a minute later does not mean
 * re-downloading every record. `forgetAccountLocally` is the destructive form.
 */
export const closeVaultInMemory = (): void => {
  useVaultStore.setState({
    parents: [],
    documents: [],
    summaries: [],
    followUps: [],
    schedules: [],
    doseEvents: [],
    observations: [],
    visitQuestions: [],
    lastPulledAt: null,
    seeded: false,
  });
};

// ---------------------------------------------------------------------------
// Selectors
//
// Plain functions over state rather than hooks, so they are trivially testable
// and can be reused outside React.
// ---------------------------------------------------------------------------

export interface VaultSnapshot {
  parents: ParentProfile[];
  documents: MedicalDocument[];
  summaries: DocumentSummary[];
  followUps: FollowUp[];
  schedules: TreatmentSchedule[];
  doseEvents: DoseEvent[];
  observations: Observation[];
  visitQuestions: VisitQuestion[];
  lastPulledAt: string | null;
}

/**
 * The whole vault, for screens that need to run several selectors together.
 *
 * `useShallow` is not optional here. A selector that builds a fresh object is
 * compared with `Object.is` by default, so it looks changed on every store
 * read — which renders, which reads, which renders. That is an infinite loop,
 * and React surfaces it as "Maximum update depth exceeded".
 *
 * Always reach for this rather than hand-rolling the selector at a call site.
 */
export const useVaultSnapshot = (): VaultSnapshot =>
  useVaultStore(
    useShallow((state) => ({
      parents: state.parents,
      documents: state.documents,
      summaries: state.summaries,
      followUps: state.followUps,
      schedules: state.schedules,
      doseEvents: state.doseEvents,
      observations: state.observations,
      visitQuestions: state.visitQuestions,
      lastPulledAt: state.lastPulledAt,
    })),
  );

/**
 * The current vault as a plain snapshot, outside React.
 *
 * For tests and for services that need to read the vault without a hook.
 * Exported mainly so the field list lives in one place: every caller that built
 * its own object had to be edited each time the vault grew, which is churn that
 * teaches nobody anything.
 */
export const vaultSnapshot = (): VaultSnapshot => {
  const state = useVaultStore.getState();
  return {
    parents: state.parents,
    documents: state.documents,
    summaries: state.summaries,
    followUps: state.followUps,
    schedules: state.schedules,
    doseEvents: state.doseEvents,
    observations: state.observations,
    visitQuestions: state.visitQuestions,
    lastPulledAt: state.lastPulledAt,
  };
};

export const selectParent = (state: VaultSnapshot, parentId: string): ParentProfile | undefined =>
  state.parents.find((parent) => parent.id === parentId);

export const selectDocument = (
  state: VaultSnapshot,
  documentId: string,
): MedicalDocument | undefined => state.documents.find((doc) => doc.id === documentId);

export const selectSummaryForDocument = (
  state: VaultSnapshot,
  documentId: string,
): DocumentSummary | undefined =>
  state.summaries.find((summary) => summary.documentId === documentId);

/** A parent's documents, newest first — this is the profile timeline. */
export const selectDocumentTimeline = (state: VaultSnapshot, parentId: string): MedicalDocument[] =>
  state.documents.filter((doc) => doc.parentId === parentId).sort(byCreatedAtDesc);

export const selectFollowUpsForParent = (state: VaultSnapshot, parentId: string): FollowUp[] =>
  state.followUps.filter((followUp) => followUp.parentId === parentId).sort(byDueDateAsc);

/** Everything still outstanding, soonest first. Drives the dashboard. */
export const selectUpcomingFollowUps = (state: VaultSnapshot, limit?: number): FollowUp[] => {
  const upcoming = state.followUps
    .filter((followUp) => followUp.status === 'scheduled')
    .sort(byDueDateAsc);
  return limit === undefined ? upcoming : upcoming.slice(0, limit);
};

export const selectOverdueFollowUps = (state: VaultSnapshot): FollowUp[] =>
  state.followUps
    .filter((followUp) => followUp.status === 'scheduled' && isOverdue(followUp.dueDate))
    .sort(byDueDateAsc);

export interface ParentSummaryStats {
  documentCount: number;
  upcomingCount: number;
  overdueCount: number;
  nextFollowUp: FollowUp | undefined;
}

/** The numbers shown on a parent card. */
export const selectParentStats = (state: VaultSnapshot, parentId: string): ParentSummaryStats => {
  const followUps = selectFollowUpsForParent(state, parentId).filter(
    (followUp) => followUp.status === 'scheduled',
  );
  return {
    documentCount: state.documents.filter((doc) => doc.parentId === parentId).length,
    upcomingCount: followUps.length,
    overdueCount: followUps.filter((followUp) => isOverdue(followUp.dueDate)).length,
    nextFollowUp: followUps[0],
  };
};

// ---------------------------------------------------------------------------
// Treatment selectors
//
// The occurrence logic itself lives in `services/treatment/occurrences.ts` and
// is pure; these only narrow the vault down to one person's records before
// handing it over.
// ---------------------------------------------------------------------------

/** The schedules currently in force for one person. */
export const selectLiveSchedules = (
  state: VaultSnapshot,
  patientId: string,
): TreatmentSchedule[] =>
  state.schedules.filter(
    (schedule) => schedule.patientId === patientId && schedule.supersededAt === null,
  );

/**
 * Every schedule for one person, superseded ones included.
 *
 * For the medicines list, which shows what somebody used to take as well as
 * what they take now — a doctor asking "when did she stop the 500?" needs it.
 */
export const selectAllSchedules = (
  state: VaultSnapshot,
  patientId: string,
): TreatmentSchedule[] => state.schedules.filter((schedule) => schedule.patientId === patientId);

/**
 * The doses due for one person on one local date.
 *
 * `localDate` is passed in rather than read from the clock so a screen renders
 * the same thing in a test at any hour, and so the *patient's* date is used
 * rather than the reader's — a daughter in Berlin opening this at 22:00 is
 * looking at her mother's tomorrow.
 */
export const selectDosesForDay = (
  state: VaultSnapshot,
  patientId: string,
  localDate: string,
): DoseOccurrence[] =>
  occurrencesForDay(selectLiveSchedules(state, patientId), doseEventsFor(state, patientId), localDate);

const doseEventsFor = (state: VaultSnapshot, patientId: string): DoseEvent[] =>
  state.doseEvents.filter((event) => event.patientId === patientId);

/** One follow-up by id, wherever it belongs. */
export const selectFollowUp = (state: VaultSnapshot, followUpId: string): FollowUp | undefined =>
  state.followUps.find((followUp) => followUp.id === followUpId);

/** One person's observations, newest first — the order a visit list wants. */
export const selectObservations = (state: VaultSnapshot, patientId: string): Observation[] =>
  state.observations
    .filter((observation) => observation.patientId === patientId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

/** One person's questions, in the order the family put them. */
export const selectVisitQuestions = (state: VaultSnapshot, patientId: string): VisitQuestion[] =>
  state.visitQuestions
    .filter((question) => question.patientId === patientId)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
