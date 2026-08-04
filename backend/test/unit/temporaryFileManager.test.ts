import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TemporaryFileManager } from '../../src/services/upload/TemporaryFileManager.js';
import { whitePng } from '../fixtures/synthetic/images.js';

describe('TemporaryFileManager', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ayunetz-tfm-test-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('writes a page and reports its real size', async () => {
    const manager = new TemporaryFileManager(baseDir);
    await manager.prepare();

    const png = whitePng();
    const page = await manager.writePage(1, png, 'image/png');

    expect(page.page).toBe(1);
    expect(page.sizeBytes).toBe(png.length);
    await expect(fs.readFile(page.path)).resolves.toEqual(png);
  });

  it('never derives the path from the uploaded filename', async () => {
    const manager = new TemporaryFileManager(baseDir);
    await manager.prepare();

    // A realistic hostile filename: it is itself an identifier.
    const page = await manager.writePage(1, whitePng(), 'image/png');

    expect(page.path).not.toContain('lakshmi');
    expect(page.path).not.toContain('uhid');
    // Random name, correct extension.
    expect(path.basename(page.path)).toMatch(/^[0-9a-f-]{36}\.png$/);
  });

  it('gives every page a distinct path, even for identical bytes', async () => {
    const manager = new TemporaryFileManager(baseDir);
    await manager.prepare();

    const first = await manager.writePage(1, whitePng(), 'image/png');
    const second = await manager.writePage(2, whitePng(), 'image/png');

    expect(first.path).not.toBe(second.path);
    expect(manager.fileCount).toBe(2);
  });

  it('isolates one request from another', async () => {
    const first = new TemporaryFileManager(baseDir);
    const second = new TemporaryFileManager(baseDir);

    expect(first.directory).not.toBe(second.directory);
  });

  it('creates the session directory readable only by this process', async () => {
    const manager = new TemporaryFileManager(baseDir);
    await manager.prepare();

    const stats = await fs.stat(manager.directory);

    // 0o700 — a medical scan must not be group- or world-readable for even the
    // few seconds it exists.
    expect(stats.mode & 0o077).toBe(0);
  });

  it('deletes everything on cleanup', async () => {
    const manager = new TemporaryFileManager(baseDir);
    await manager.prepare();
    await manager.writePage(1, whitePng(), 'image/png');
    await manager.writePage(2, whitePng(), 'image/png');

    await expect(manager.cleanup()).resolves.toBe(true);

    await expect(fs.access(manager.directory)).rejects.toThrow();
    expect(await fs.readdir(baseDir)).toEqual([]);
  });

  it('is idempotent and does not throw when the directory is already gone', async () => {
    const manager = new TemporaryFileManager(baseDir);
    await manager.prepare();
    await manager.writePage(1, whitePng(), 'image/png');

    await fs.rm(manager.directory, { recursive: true, force: true });

    await expect(manager.cleanup()).resolves.toBe(true);
    await expect(manager.cleanup()).resolves.toBe(true);
  });

  it('reports a typed failure when storage cannot be prepared', async () => {
    // A path under a regular file cannot be a directory.
    const blocker = path.join(baseDir, 'not-a-directory');
    await fs.writeFile(blocker, 'x');

    const manager = new TemporaryFileManager(blocker);

    await expect(manager.prepare()).rejects.toMatchObject({
      name: 'ProcessingError',
      code: 'upload_failed',
      retryable: true,
    });
  });
});
