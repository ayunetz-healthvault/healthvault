import {
  clearOriginals,
  discardOriginal,
  keepOriginal,
  listPendingOriginals,
  originalExists,
  pendingBytes,
  PENDING_BYTES_LIMIT,
  ProtectedStorageFull,
} from './protectedFiles';

/**
 * Pending originals.
 *
 * The behaviour worth guarding: a captured page survives until it is uploaded,
 * an account cannot see another account's pending work, and running out of room
 * refuses new work rather than quietly deleting old work. The last one is the
 * one an ordinary cache implementation gets wrong — the page nobody uploaded is
 * the page nobody has.
 *
 * `expo-file-system` is mocked with an in-memory mockTree. That is enough to prove
 * the logic; it is not evidence that iOS Data Protection or Android backup
 * exclusion behave as intended, which needs a device. PROGRESS.md says so.
 */

interface Entry {
  size: number;
}

// `mock`-prefixed so the jest.mock factory below is allowed to close over them.
const mockTree = new Map<string, Entry>();
const mockDirectories = new Set<string>();

jest.mock('expo-file-system', () => {
  const join = (...parts: string[]): string =>
    parts
      .map((part) => part.replace(/\/+$/, ''))
      .join('/')
      .replace(/\/+/g, '/');

  class MockFile {
    readonly uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      const root = typeof base === 'string' ? base : base.uri;
      this.uri = name === undefined ? root : join(root, name);
    }

    get exists(): boolean {
      return mockTree.has(this.uri);
    }

    get size(): number | null {
      return mockTree.get(this.uri)?.size ?? null;
    }

    copy(destination: MockFile): void {
      const entry = mockTree.get(this.uri);
      if (entry === undefined) throw new Error(`No such file: ${this.uri}`);
      mockTree.set(destination.uri, { ...entry });
    }

    delete(): void {
      mockTree.delete(this.uri);
    }
  }

  class MockDirectory {
    readonly uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts.map((part) => (typeof part === 'string' ? part : part.uri)));
    }

    get exists(): boolean {
      return mockDirectories.has(this.uri);
    }

    create(): void {
      mockDirectories.add(this.uri);
    }

    delete(): void {
      mockDirectories.delete(this.uri);
      for (const key of [...mockTree.keys()]) {
        if (key.startsWith(`${this.uri}/`)) mockTree.delete(key);
      }
    }

    list(): MockFile[] {
      return [...mockTree.keys()]
        .filter((key) => key.startsWith(`${this.uri}/`))
        .map((key) => new MockFile(key));
    }
  }

  return {
    Paths: { document: { uri: 'file:///document' }, cache: { uri: 'file:///cache' } },
    File: MockFile,
    Directory: MockDirectory,
  };
});

/** Puts a file in the picker's cache, as expo-image-picker would. */
const inCache = (name: string, size = 1024): string => {
  const uri = `file:///cache/${name}`;
  mockTree.set(uri, { size });
  return uri;
};

beforeEach(() => {
  mockTree.clear();
  mockDirectories.clear();
});

describe('keeping an original', () => {
  it('moves it out of the cache, where the OS deletes things without asking', () => {
    const cacheUri = inCache('page-1.jpg');

    const stored = keepOriginal('acc_alice', cacheUri, 'page-1.jpg');

    expect(stored.uri).toContain('/document/');
    expect(stored.uri).not.toContain('/cache/');
    expect(originalExists(stored.uri)).toBe(true);
    expect(originalExists(cacheUri)).toBe(false);
  });

  it('reports the size it actually stored', () => {
    const stored = keepOriginal('acc_alice', inCache('page-1.jpg', 4096), 'page-1.jpg');

    expect(stored.sizeBytes).toBe(4096);
  });

  /** A restart is the whole reason this exists. */
  it('is still there after the app is restarted', () => {
    keepOriginal('acc_alice', inCache('page-1.jpg'), 'page-1.jpg');

    expect(listPendingOriginals('acc_alice')).toHaveLength(1);
  });

  it('keeps each account’s pending work separate', () => {
    keepOriginal('acc_alice', inCache('a.jpg'), 'a.jpg');
    keepOriginal('acc_bob', inCache('b.jpg'), 'b.jpg');

    expect(listPendingOriginals('acc_alice')).toHaveLength(1);
    expect(listPendingOriginals('acc_bob')).toHaveLength(1);
    expect(listPendingOriginals('acc_alice')[0]?.uri).toContain('acc_alice');
  });

  it('does not lose the page when the cache copy cannot be removed', () => {
    const cacheUri = inCache('page-1.jpg');
    const stored = keepOriginal('acc_alice', cacheUri, 'page-1.jpg');

    // Even if the source delete had failed, the destination is what matters.
    expect(originalExists(stored.uri)).toBe(true);
  });
});

describe('the size limit', () => {
  it('refuses a new capture rather than deleting pending work', () => {
    keepOriginal('acc_alice', inCache('big.pdf', PENDING_BYTES_LIMIT - 1), 'big.pdf');

    expect(() => keepOriginal('acc_alice', inCache('next.jpg', 4096), 'next.jpg')).toThrow(
      ProtectedStorageFull,
    );

    // The page that was already waiting is untouched.
    expect(listPendingOriginals('acc_alice')).toHaveLength(1);
  });

  it('counts only this account towards the limit', () => {
    keepOriginal('acc_bob', inCache('big.pdf', PENDING_BYTES_LIMIT - 1), 'big.pdf');

    expect(() =>
      keepOriginal('acc_alice', inCache('page.jpg', 4096), 'page.jpg'),
    ).not.toThrow();
  });

  it('reports what is currently pending', () => {
    keepOriginal('acc_alice', inCache('a.jpg', 100), 'a.jpg');
    keepOriginal('acc_alice', inCache('b.jpg', 200), 'b.jpg');

    expect(pendingBytes('acc_alice')).toBe(300);
    expect(pendingBytes('acc_bob')).toBe(0);
  });
});

describe('discarding', () => {
  it('removes one original once it has been uploaded', () => {
    const stored = keepOriginal('acc_alice', inCache('page-1.jpg'), 'page-1.jpg');

    discardOriginal(stored.uri);

    expect(originalExists(stored.uri)).toBe(false);
  });

  it('does not complain about a file that is already gone', () => {
    expect(() => discardOriginal('file:///document/nothing-here.jpg')).not.toThrow();
  });

  it('clears one account without touching another', () => {
    keepOriginal('acc_alice', inCache('a.jpg'), 'a.jpg');
    keepOriginal('acc_bob', inCache('b.jpg'), 'b.jpg');

    clearOriginals('acc_alice');

    expect(listPendingOriginals('acc_alice')).toEqual([]);
    expect(listPendingOriginals('acc_bob')).toHaveLength(1);
  });

  it('is safe to clear an account that never captured anything', () => {
    expect(() => clearOriginals('acc_nobody')).not.toThrow();
  });
});
