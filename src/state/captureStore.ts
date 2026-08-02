import { create } from 'zustand';

import type { DocumentCategory, DocumentPage } from '@/types/domain';
import { isoToday } from '@/utils/date';

/**
 * The document currently being captured.
 *
 * Intentionally *not* persisted: it holds `file://` URIs into the cache
 * directory, which the OS is free to evict. A half-finished capture that
 * survives a restart with dead image paths is worse than no draft at all.
 */

interface CaptureState {
  parentId: string | null;
  title: string;
  category: DocumentCategory;
  documentDate: string;
  pages: DocumentPage[];

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
};

export const useCaptureStore = create<CaptureState>()((set) => ({
  ...emptyState,

  start: (parentId) => set({ ...emptyState, parentId, documentDate: isoToday() }),

  setMeta: (patch) => set(patch),

  addPages: (pages) => set((state) => ({ pages: [...state.pages, ...pages] })),

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
