import { create } from 'zustand';

import { protectPages } from '@/services/capture/captureService';
import { currentVaultAccountId } from '@/services/storage/activeVault';
import { ProtectedStorageFull } from '@/services/storage/protectedFiles';
import type { DocumentCategory, DocumentPage } from '@/types/domain';
import { isoToday } from '@/utils/date';

/**
 * The document currently being captured.
 *
 * Intentionally *not* persisted. The *bytes* are: `addPages` moves every page
 * into protected storage as it arrives, so a captured report survives a
 * restart. What is not worth keeping is this draft — a title half typed and a
 * date not yet chosen — and reconstructing it from the files on disk is the
 * job of the pending-upload reconciliation, not of a serialised form.
 */

interface CaptureState {
  parentId: string | null;
  title: string;
  category: DocumentCategory;
  documentDate: string;
  pages: DocumentPage[];
  /**
   * Set when pages could not be moved somewhere durable.
   *
   * Shown rather than thrown: the pages are still usable, and the user needs to
   * know they are fragile — not to lose them to an exception.
   */
  storageWarning: string | null;

  start: (parentId: string) => void;
  setMeta: (patch: { title?: string; category?: DocumentCategory; documentDate?: string }) => void;
  addPages: (pages: DocumentPage[]) => void;
  /** Replaces a page in place — the "retake" action in the review screen. */
  replacePage: (pageId: string, replacement: DocumentPage) => void;
  removePage: (pageId: string) => void;
  /** Moves a page by `offset` (-1 up, +1 down), clamped to the list bounds. */
  movePage: (pageId: string, offset: number) => void;
  reset: () => void;
}

const emptyState = {
  parentId: null as string | null,
  title: '',
  category: 'lab_report' as DocumentCategory,
  documentDate: isoToday(),
  pages: [] as DocumentPage[],
  storageWarning: null as string | null,
};

export const useCaptureStore = create<CaptureState>()((set) => ({
  ...emptyState,

  start: (parentId) => set({ ...emptyState, parentId, documentDate: isoToday() }),

  setMeta: (patch) => set(patch),

  /**
   * Adds pages, moving their bytes somewhere durable first.
   *
   * The protection happens here rather than in each of the three screens that
   * capture pages, so none of them can forget it. See `protectPages` for why
   * the picker's cache is not a safe place to leave a medical report.
   *
   * Running out of room does not throw: the pages are kept on their cache URIs
   * — still usable for the next few minutes — and `storageWarning` says so, so
   * the review screen can tell the user to upload what is waiting. Losing the
   * page outright would be the worse failure.
   */
  addPages: (pages) => {
    const accountId = currentVaultAccountId();
    if (accountId === null) {
      set((state) => ({ pages: [...state.pages, ...pages] }));
      return;
    }

    try {
      const protectedPages = protectPages(accountId, pages);
      set((state) => ({ pages: [...state.pages, ...protectedPages], storageWarning: null }));
    } catch (error) {
      set((state) => ({
        pages: [...state.pages, ...pages],
        storageWarning:
          error instanceof ProtectedStorageFull
            ? 'There is no room for more documents on this phone until the ones waiting have been uploaded.'
            : 'These pages could not be saved securely on this phone yet. Upload them before closing the app.',
      }));
    }
  },

  replacePage: (pageId, replacement) =>
    set((state) => ({
      pages: state.pages.map((page) => (page.id === pageId ? replacement : page)),
    })),

  removePage: (pageId) =>
    set((state) => ({ pages: state.pages.filter((page) => page.id !== pageId) })),

  movePage: (pageId, offset) =>
    set((state) => ({ pages: reorderPages(state.pages, pageId, offset) })),

  reset: () => set({ ...emptyState, documentDate: isoToday() }),
}));

/**
 * Pure reorder helper. Exported so the ordering rules can be tested without a
 * store — this is the bit users notice when it is wrong.
 */
export const reorderPages = (
  pages: DocumentPage[],
  pageId: string,
  offset: number,
): DocumentPage[] => {
  const index = pages.findIndex((page) => page.id === pageId);
  if (index === -1) return pages;

  const target = index + offset;
  if (target < 0 || target >= pages.length) return pages;

  const next = [...pages];
  const [moved] = next.splice(index, 1);
  if (!moved) return pages;
  next.splice(target, 0, moved);
  return next;
};

/** A capture is ready to upload once it has a parent, a title and a page. */
export const isCaptureReady = (state: {
  parentId: string | null;
  title: string;
  pages: DocumentPage[];
}): boolean => state.parentId !== null && state.title.trim().length > 0 && state.pages.length > 0;
