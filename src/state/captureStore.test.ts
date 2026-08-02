import { isCaptureReady, reorderPages, useCaptureStore } from './captureStore';

import type { DocumentPage } from '@/types/domain';

const page = (id: string): DocumentPage => ({
  id,
  uri: `file:///cache/${id}.jpg`,
  kind: 'image',
  source: 'scan',
  fileName: `${id}.jpg`,
  sizeBytes: 100_000,
  width: 1000,
  height: 1400,
  capturedAt: '2026-07-30T10:00:00.000Z',
});

const ids = (pages: DocumentPage[]): string[] => pages.map((item) => item.id);

describe('reorderPages', () => {
  const pages = [page('a'), page('b'), page('c')];

  it('moves a page up', () => {
    expect(ids(reorderPages(pages, 'b', -1))).toEqual(['b', 'a', 'c']);
  });

  it('moves a page down', () => {
    expect(ids(reorderPages(pages, 'b', 1))).toEqual(['a', 'c', 'b']);
  });

  it('will not move the first page above the top', () => {
    expect(reorderPages(pages, 'a', -1)).toBe(pages);
  });

  it('will not move the last page below the bottom', () => {
    expect(reorderPages(pages, 'c', 1)).toBe(pages);
  });

  it('ignores an unknown page id', () => {
    expect(reorderPages(pages, 'zz', 1)).toBe(pages);
  });

  it('does not mutate the input', () => {
    const original = [page('a'), page('b')];
    reorderPages(original, 'a', 1);
    expect(ids(original)).toEqual(['a', 'b']);
  });
});

describe('isCaptureReady', () => {
  it('is ready with a parent, a title and at least one page', () => {
    expect(isCaptureReady({ parentId: 'par_1', title: 'Lab report', pages: [page('a')] })).toBe(
      true,
    );
  });

  it.each([
    ['no parent', { parentId: null, title: 'Lab report', pages: [page('a')] }],
    ['no title', { parentId: 'par_1', title: '   ', pages: [page('a')] }],
    ['no pages', { parentId: 'par_1', title: 'Lab report', pages: [] }],
  ])('is not ready with %s', (_label, state) => {
    expect(isCaptureReady(state)).toBe(false);
  });
});

describe('useCaptureStore', () => {
  beforeEach(() => {
    useCaptureStore.getState().reset();
  });

  it('starts a draft against a parent', () => {
    useCaptureStore.getState().start('par_1');

    const state = useCaptureStore.getState();
    expect(state.parentId).toBe('par_1');
    expect(state.pages).toEqual([]);
    expect(state.title).toBe('');
  });

  it('appends pages in capture order', () => {
    const store = useCaptureStore.getState();
    store.start('par_1');
    store.addPages([page('a')]);
    store.addPages([page('b'), page('c')]);

    expect(ids(useCaptureStore.getState().pages)).toEqual(['a', 'b', 'c']);
  });

  it('replaces a page in place, keeping its position — this is "retake"', () => {
    const store = useCaptureStore.getState();
    store.start('par_1');
    store.addPages([page('a'), page('b'), page('c')]);

    store.replacePage('b', page('b-new'));

    expect(ids(useCaptureStore.getState().pages)).toEqual(['a', 'b-new', 'c']);
  });

  it('removes a page', () => {
    const store = useCaptureStore.getState();
    store.start('par_1');
    store.addPages([page('a'), page('b')]);

    store.removePage('a');

    expect(ids(useCaptureStore.getState().pages)).toEqual(['b']);
  });

  it('moves a page through the store', () => {
    const store = useCaptureStore.getState();
    store.start('par_1');
    store.addPages([page('a'), page('b')]);

    store.movePage('a', 1);

    expect(ids(useCaptureStore.getState().pages)).toEqual(['b', 'a']);
  });

  it('updates metadata without touching the pages', () => {
    const store = useCaptureStore.getState();
    store.start('par_1');
    store.addPages([page('a')]);

    store.setMeta({ title: 'Diabetes panel', category: 'prescription' });

    const state = useCaptureStore.getState();
    expect(state.title).toBe('Diabetes panel');
    expect(state.category).toBe('prescription');
    expect(state.pages).toHaveLength(1);
  });

  it('clears everything on reset', () => {
    const store = useCaptureStore.getState();
    store.start('par_1');
    store.addPages([page('a')]);
    store.setMeta({ title: 'Something' });

    store.reset();

    const state = useCaptureStore.getState();
    expect(state.parentId).toBeNull();
    expect(state.pages).toEqual([]);
    expect(state.title).toBe('');
  });
});
