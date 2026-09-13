import { exportFileName, saveRecordExport } from './exportFile';

/**
 * The copy somebody actually keeps.
 *
 * An export that never leaves the app is not a copy anybody has. These prove
 * the two halves of that: a real file is written and offered to the share
 * sheet, and it does not stay on the phone afterwards — a JSON file holding a
 * medical history, sitting in app storage where nothing tracks it, is the exact
 * second copy the export is designed not to create.
 *
 * `expo-file-system` and `expo-sharing` are mocked. This is evidence about the
 * logic, not about a real share sheet on a real phone; PROGRESS.md says so.
 */

// `mock`-prefixed so the jest.mock factory below may close over them.
const mockFiles = new Map<string, string>();
/** What the share sheet was actually given: the uri, and the bytes behind it. */
const mockShared: { uri: string | null; contents: string | null } = { uri: null, contents: null };
let mockSharingAvailable = true;
let mockShareThrows = false;

jest.mock('expo-file-system', () => {
  class MockFile {
    readonly uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = name === undefined ? root : `${root}/${name}`;
    }

    get exists(): boolean {
      return mockFiles.has(this.uri);
    }

    create(): void {
      mockFiles.set(this.uri, '');
    }

    write(contents: string): void {
      mockFiles.set(this.uri, contents);
    }

    delete(): void {
      mockFiles.delete(this.uri);
    }
  }

  return { File: MockFile, Paths: { cache: { uri: 'file:///cache' } } };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => mockSharingAvailable,
  shareAsync: async (uri: string) => {
    if (mockShareThrows) throw new Error('share failed');
    // What the receiving app sees: the file is still there while the sheet is
    // open, which is the property the deletion afterwards depends on.
    mockShared.uri = mockFiles.has(uri) ? uri : null;
    mockShared.contents = mockFiles.get(uri) ?? null;
  },
}));

const record = { patient: { fullName: 'Meera Nair' }, documents: [] };

beforeEach(() => {
  mockFiles.clear();
  mockShared.uri = null;
  mockShared.contents = null;
  mockSharingAvailable = true;
  mockShareThrows = false;
});

describe('naming the file', () => {
  it('uses the person’s name and the day it was taken', () => {
    expect(exportFileName('Meera Nair', '2026-09-08T10:00:00.000Z')).toBe(
      'meera-nair-record-2026-09-08.json',
    );
  });

  /** A name is not a file system's to interpret. */
  it('survives a name with punctuation in it', () => {
    expect(exportFileName('Dr. R. K. Nair-Menon', '2026-09-08T10:00:00.000Z')).toBe(
      'dr-r-k-nair-menon-record-2026-09-08.json',
    );
  });
});

describe('saving a copy', () => {
  it('writes the export and hands it to the share sheet', async () => {
    const result = await saveRecordExport('Meera Nair', '2026-09-08T10:00:00.000Z', record);

    expect(result).toEqual({ outcome: 'shared', fileName: 'meera-nair-record-2026-09-08.json' });
    expect(mockShared.uri).toBe('file:///cache/meera-nair-record-2026-09-08.json');
  });

  it('shares the record itself, readable as JSON', async () => {
    await saveRecordExport('Meera Nair', '2026-09-08T10:00:00.000Z', record);

    // Captured during the share, which is the only moment the file exists.
    expect(JSON.parse(mockShared.contents ?? 'null')).toEqual(record);
  });

  /**
   * Nothing is left behind. A copy of somebody's medical history in app storage
   * is one no deletion path knows about and nobody remembers is there.
   */
  it('leaves no file on the phone once the sheet closes', async () => {
    await saveRecordExport('Meera Nair', '2026-09-08T10:00:00.000Z', record);

    expect([...mockFiles.keys()]).toEqual([]);
  });

  it('removes the file even when sharing fails', async () => {
    mockShareThrows = true;

    const result = await saveRecordExport('Meera Nair', '2026-09-08T10:00:00.000Z', record);

    expect(result.outcome).toBe('failed');
    expect([...mockFiles.keys()]).toEqual([]);
  });

  /** A platform difference, not an error, and it is reported as one. */
  it('says so on a platform with no share sheet', async () => {
    mockSharingAvailable = false;

    expect(await saveRecordExport('Meera Nair', '2026-09-08T10:00:00.000Z', record)).toEqual({
      outcome: 'unavailable',
    });
    expect([...mockFiles.keys()]).toEqual([]);
  });

  /** A file-system path contains the person's name. It never reaches the user. */
  it('does not put the platform’s message on the screen', async () => {
    mockShareThrows = true;

    const result = await saveRecordExport('Meera Nair', '2026-09-08T10:00:00.000Z', record);

    expect(result).toMatchObject({ message: expect.not.stringContaining('share failed') });
  });
});
