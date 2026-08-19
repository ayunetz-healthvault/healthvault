import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { isDemoBuild } from '@/config/env';
import { MOCK_DOCUMENTS, MOCK_SUMMARIES } from '@/mocks/documents';
import { buildMockFollowUps } from '@/mocks/followUps';
import { MOCK_PARENTS } from '@/mocks/parents';
import { STORAGE_KEYS } from '@/services/storage/persistence';
import type {
  DocumentSummary,
  FollowUp,
  FollowUpDraft,
  FollowUpStatus,
  MedicalDocument,
  ParentDraft,
  ParentProfile,
  ProcessingStatus,
} from '@/types/domain';
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
 */

interface VaultState {
  parents: ParentProfile[];
  documents: MedicalDocument[];
  summaries: DocumentSummary[];
  followUps: FollowUp[];
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
  updateDocumentStatus: (
    id: string,
    status: ProcessingStatus,
    extra?: { uploadProgress?: number; summaryId?: string | null; failureReason?: string | null },
  ) => void;
  removeDocument: (id: string) => void;

  // --- Summaries ------------------------------------------------------------
  addSummary: (summary: DocumentSummary) => void;

  // --- Follow-ups -----------------------------------------------------------
  addFollowUp: (draft: FollowUpDraft) => FollowUp;
  updateFollowUp: (id: string, patch: Partial<FollowUp>) => void;
  setFollowUpStatus: (id: string, status: FollowUpStatus) => void;
  attachCalendarEvent: (id: string, eventId: string | null) => void;
  removeFollowUp: (id: string) => void;
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      parents: [],
      documents: [],
      summaries: [],
      followUps: [],
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
        set({ parents: [], documents: [], summaries: [], followUps: [], seeded: true }),

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

      attachCalendarEvent: (id, eventId) => get().updateFollowUp(id, { calendarEventId: eventId }),

      removeFollowUp: (id) =>
        set((state) => ({ followUps: state.followUps.filter((followUp) => followUp.id !== id) })),
    }),
    {
      name: STORAGE_KEYS.parents,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

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
    })),
  );

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
