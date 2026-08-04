import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import {
  ProcessingError,
  emptyRedactionCounts,
  type DocumentProcessingRequest,
  type DocumentProcessor,
  type ProcessDocumentResponse,
} from '../../src/types/processing.js';
import { gifBytes, jpegHeaderOnly, pdfBytes, whitePng } from '../fixtures/synthetic/images.js';
import { buildMultipart, type MultipartFilePart } from '../helpers/multipart.js';

import type { FastifyInstance } from 'fastify';

const URL = '/dev/process-document';

/** A filename that is itself an identifier — must never come back or be logged. */
const HOSTILE_FILENAME = 'lakshmi-iyer-uhid-4471-dob-1955.jpg';

const validFields = [
  { name: 'parentId', value: 'par_synthetic_1' },
  { name: 'documentId', value: 'doc_synthetic_1' },
  { name: 'category', value: 'lab_report' },
  { name: 'patientName', value: 'Synthetic Testpatient' },
];

const pngPart = (name = 'pages', filename = 'page-1.png'): MultipartFilePart => ({
  name,
  filename,
  contentType: 'image/png',
  content: whitePng(),
});

const okResponse = (documentId: string): ProcessDocumentResponse => ({
  documentId,
  processingStatus: 'ready',
  summary: {},
  privacy: {
    redactionApplied: true,
    possiblePiiRemaining: false,
    redactedEntityCounts: emptyRedactionCounts(),
    pipelineVersion: 'redaction-test',
  },
});

describe('POST /dev/process-document', () => {
  let tempDir: string;
  let app: FastifyInstance;
  let logLines: string[];
  let received: DocumentProcessingRequest[];

  /** Records what the pipeline was handed, and whether the files still exist. */
  const recordingProcessor = (
    behaviour: (request: DocumentProcessingRequest) => Promise<ProcessDocumentResponse>,
  ): DocumentProcessor => ({
    process: async (request) => {
      received.push(request);
      return behaviour(request);
    },
  });

  const startApp = (processor: DocumentProcessor): FastifyInstance => {
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk));
        callback();
      },
    });

    return buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        // Trace, so the assertions about logging see everything this service
        // is capable of writing, not just what it writes at info.
        LOG_LEVEL: 'trace',
        PROCESSING_TEMP_DIR: tempDir,
        MAX_DOCUMENT_PAGES: '10',
        MAX_PAGE_BYTES: String(1024 * 1024),
      }),
      processor,
      logStream,
    });
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ayunetz-route-test-'));
    logLines = [];
    received = [];
  });

  afterEach(async () => {
    await app?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** Nothing this request wrote may survive it. */
  const expectTempDirEmpty = async (): Promise<void> => {
    expect(await fs.readdir(tempDir)).toEqual([]);
  };

  describe('accepted input', () => {
    it('accepts a PNG page and passes it to the pipeline', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const { headers, payload } = buildMultipart(validFields, [pngPart()]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(200);
      expect(response.json().processingStatus).toBe('ready');
      expect(received[0]?.pages).toHaveLength(1);
      expect(received[0]?.pages[0]?.mimeType).toBe('image/png');
    });

    it('accepts a JPG page', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const { headers, payload } = buildMultipart(validFields, [
        { name: 'pages', filename: 'p1.jpg', contentType: 'image/jpeg', content: jpegHeaderOnly() },
      ]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(200);
      expect(received[0]?.pages[0]?.mimeType).toBe('image/jpeg');
    });

    it('preserves page order and numbers pages from one', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const { headers, payload } = buildMultipart(validFields, [
        pngPart('pages', 'a.png'),
        pngPart('pages', 'b.png'),
        pngPart('pages', 'c.png'),
      ]);
      await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(received[0]?.pages.map((page) => page.page)).toEqual([1, 2, 3]);
    });

    it('collects repeated fields into lists', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const { headers, payload } = buildMultipart(
        [
          ...validFields,
          { name: 'patientNameAliases', value: 'S. Testpatient' },
          { name: 'patientNameAliases', value: 'Testpatient, Synthetic' },
          { name: 'knownPatientIds', value: 'UHID-000000' },
          { name: 'patientCity', value: 'Chennai' },
        ],
        [pngPart()],
      );
      await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(received[0]?.patient.aliases).toEqual(['S. Testpatient', 'Testpatient, Synthetic']);
      expect(received[0]?.patient.knownPatientIds).toEqual(['UHID-000000']);
      expect(received[0]?.patient.city).toBe('Chennai');
    });

    it('hands the pipeline files that exist on disk, then removes them', async () => {
      const seenOnDisk: boolean[] = [];

      app = startApp(
        recordingProcessor(async (request) => {
          for (const page of request.pages) {
            seenOnDisk.push(
              await fs
                .access(page.path)
                .then(() => true)
                .catch(() => false),
            );
          }
          return okResponse(request.documentId);
        }),
      );

      const { headers, payload } = buildMultipart(validFields, [pngPart(), pngPart()]);
      await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(seenOnDisk).toEqual([true, true]);
      await expectTempDirEmpty();
    });
  });

  describe('rejected input', () => {
    const expectRefusal = async (
      files: MultipartFilePart[],
      fields = validFields,
    ): Promise<ReturnType<typeof JSON.parse>> => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const { headers, payload } = buildMultipart(fields, files);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('invalid_file');
      // Nothing downstream may run on input we refused.
      expect(received).toHaveLength(0);
      await expectTempDirEmpty();

      return response.json();
    };

    it('rejects a PDF disguised as a JPEG', async () => {
      // PDFs are accepted now, but the bytes and the declared type must still
      // agree — a mismatch is a signal worth refusing on regardless of format.
      const body = await expectRefusal([
        { name: 'pages', filename: 'p1.jpg', contentType: 'image/jpeg', content: pdfBytes() },
      ]);

      expect(body.message).toContain('does not match its declared file type');
    });

    it('rejects a PNG announced as a JPEG', async () => {
      const body = await expectRefusal([
        { name: 'pages', filename: 'p1.jpg', contentType: 'image/jpeg', content: whitePng() },
      ]);

      expect(body.message).toContain('does not match its declared file type');
    });

    it('rejects an unsupported image format', async () => {
      await expectRefusal([
        { name: 'pages', filename: 'p1.gif', contentType: 'image/gif', content: gifBytes() },
      ]);
    });

    it('rejects an empty file', async () => {
      const body = await expectRefusal([
        { name: 'pages', filename: 'p1.png', contentType: 'image/png', content: Buffer.alloc(0) },
      ]);

      expect(body.message).toContain('empty');
    });

    it('rejects a request with no pages at all', async () => {
      const body = await expectRefusal([]);

      expect(body.message).toContain('No pages');
    });

    it('rejects an eleventh page', async () => {
      const body = await expectRefusal(
        Array.from({ length: 11 }, (_, index) => pngPart('pages', `p${index}.png`)),
      );

      expect(body.message).toContain('at most 10 pages');
    });

    it('rejects a page over the size limit', async () => {
      const oversized = Buffer.concat([whitePng(), Buffer.alloc(2 * 1024 * 1024)]);
      const body = await expectRefusal([
        { name: 'pages', filename: 'big.png', contentType: 'image/png', content: oversized },
      ]);

      expect(body.message).toContain('larger than');
    });

    it('rejects missing required fields, naming the fields but never the values', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const { headers, payload } = buildMultipart(
        [
          { name: 'parentId', value: 'par_synthetic_1' },
          { name: 'patientName', value: 'Synthetic Testpatient' },
        ],
        [pngPart()],
      );
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });
      const body = response.json();

      expect(response.statusCode).toBe(400);
      expect(body.details.fields).toContain('documentId');
      expect(body.details.fields).toContain('category');
      expect(response.body).not.toContain('Synthetic Testpatient');
      await expectTempDirEmpty();
    });

    it('rejects a request that is not multipart', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      const response = await app.inject({
        method: 'POST',
        url: URL,
        headers: { 'content-type': 'application/json' },
        payload: { parentId: 'par_1' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('invalid_file');
    });
  });

  describe('temporary file cleanup', () => {
    it('deletes pages after a downstream pipeline failure', async () => {
      const paths: string[] = [];

      app = startApp(
        recordingProcessor(async (request) => {
          paths.push(...request.pages.map((page) => page.path));
          throw new ProcessingError('ocr_failed', 'The pages could not be read.');
        }),
      );

      const { headers, payload } = buildMultipart(validFields, [pngPart(), pngPart()]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('ocr_failed');
      expect(paths).toHaveLength(2);
      for (const filePath of paths) {
        await expect(fs.access(filePath)).rejects.toThrow();
      }
      await expectTempDirEmpty();
    });

    it('deletes pages after an unexpected crash in the pipeline', async () => {
      app = startApp(
        recordingProcessor(() => {
          // Not a ProcessingError: the kind of failure nobody planned for.
          throw new Error('tesseract worker died reading page 2 of amma-report.png');
        }),
      );

      const { headers, payload } = buildMultipart(validFields, [pngPart()]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(500);
      await expectTempDirEmpty();
    });

    it('deletes pages after a privacy stop', async () => {
      app = startApp(
        recordingProcessor(() => {
          throw new ProcessingError(
            'privacy_failed',
            'The document could not be processed safely.',
            { details: { possiblePiiRemaining: true, categories: ['possible_address'] } },
          );
        }),
      );

      const { headers, payload } = buildMultipart(validFields, [pngPart()]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('privacy_failed');
      await expectTempDirEmpty();
    });

    it('still answers when cleanup itself fails', async () => {
      app = startApp(recordingProcessor(async (request) => okResponse(request.documentId)));

      // Simulate an undeletable directory. The request must not fail because of it.
      const rmSpy = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('EBUSY'));

      const { headers, payload } = buildMultipart(validFields, [pngPart()]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.statusCode).toBe(200);
      rmSpy.mockRestore();
    });
  });

  describe('logging policy', () => {
    it('writes no filename, field value or document byte to the log', async () => {
      app = startApp(
        recordingProcessor(async (request) => {
          throw new ProcessingError('ocr_failed', `unreadable: ${request.pages.length} pages`);
        }),
      );

      const { headers, payload } = buildMultipart(
        [...validFields, { name: 'patientPhone', value: '+91 98400 12345' }],
        [
          {
            name: 'pages',
            filename: HOSTILE_FILENAME,
            contentType: 'image/png',
            content: whitePng(),
          },
        ],
      );
      await app.inject({ method: 'POST', url: URL, headers, payload });

      const logs = logLines.join('\n');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs).not.toContain(HOSTILE_FILENAME);
      expect(logs).not.toContain('lakshmi');
      expect(logs).not.toContain('uhid');
      expect(logs).not.toContain('98400');
      expect(logs).not.toContain('Synthetic Testpatient');
      // The failure class is recorded — that is the whole point of the logs.
      expect(logs).toContain('ocr_failed');
    });

    it('logs an unexpected error by class only, never its message', async () => {
      app = startApp(
        recordingProcessor(() => {
          throw new Error('failed reading /tmp/scans/lakshmi-iyer-uhid-4471.png');
        }),
      );

      const { headers, payload } = buildMultipart(validFields, [pngPart()]);
      await app.inject({ method: 'POST', url: URL, headers, payload });

      const logs = logLines.join('\n');

      expect(logs).not.toContain('lakshmi-iyer');
      expect(logs).not.toContain('uhid-4471');
      expect(logs).toContain('unhandled error');
    });

    it('does not put the failure detail of an unexpected error in the response', async () => {
      app = startApp(
        recordingProcessor(() => {
          throw new Error('ENOENT: /tmp/scans/lakshmi-iyer-uhid-4471.png');
        }),
      );

      const { headers, payload } = buildMultipart(validFields, [pngPart()]);
      const response = await app.inject({ method: 'POST', url: URL, headers, payload });

      expect(response.body).not.toContain('lakshmi');
      expect(response.body).not.toContain('ENOENT');
      expect(response.json()).toEqual({
        code: 'unknown',
        message: 'The document could not be processed.',
        retryable: false,
      });
    });
  });
});
