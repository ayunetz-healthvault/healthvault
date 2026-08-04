import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { summarySchema } from '../../src/schemas/summary.js';
import { MockOcrProvider } from '../../src/services/ocr/MockOcrProvider.js';
import { DocumentProcessingOrchestrator } from '../../src/services/processing/DocumentProcessingOrchestrator.js';
import { MockSummaryProvider } from '../../src/services/summarisation/MockSummaryProvider.js';
import { whitePng } from '../fixtures/synthetic/images.js';
import {
  MUST_NOT_SURVIVE,
  SYNTHETIC_PATIENT,
  SYNTHETIC_REPORT,
} from '../fixtures/synthetic/report.js';
import { buildMultipart } from '../helpers/multipart.js';

import type { StructuredSummary } from '../../src/schemas/summary.js';
import type { FastifyInstance } from 'fastify';

/**
 * Route through orchestrator through providers — everything except Tesseract
 * and a real model, both of which are covered elsewhere.
 *
 * This is the test that proves the pieces fit: a request goes in, a validated
 * summary comes out, and the pages are gone afterwards regardless of outcome.
 */

const URL = '/dev/process-document';

const SUMMARY: StructuredSummary = summarySchema.parse({
  overview: 'A one-page lab report.',
  plainLanguageSummary: 'Average blood sugar is above the target range.',
  findings: [
    {
      label: 'HbA1c',
      value: '8.1 %',
      referenceRange: 'Below 7.0 %',
      severity: 'attention',
      plainLanguage: 'Above target for someone with diabetes.',
      sources: [{ page: 1 }],
    },
  ],
  medicines: [],
  instructions: ['Repeat the HbA1c test in three months.'],
  recommendedDoctorCategory: 'endocrinologist',
  questionsForDoctor: ['Does the dose need changing?'],
  confidence: 0.83,
  explicitFollowUps: [],
  uncertainties: [],
});

const fields = [
  { name: 'parentId', value: 'par_synthetic_1' },
  { name: 'documentId', value: 'doc_synthetic_1' },
  { name: 'category', value: 'lab_report' },
  { name: 'patientName', value: SYNTHETIC_PATIENT.fullName },
  { name: 'patientPhone', value: SYNTHETIC_PATIENT.phone ?? '' },
  { name: 'patientCity', value: SYNTHETIC_PATIENT.city ?? '' },
  { name: 'knownPatientIds', value: 'MH-4471' },
];

describe('POST /dev/process-document — full pipeline', () => {
  let tempDir: string;
  let app: FastifyInstance;
  let logLines: string[];

  const startApp = (ocrText: string, summary: StructuredSummary = SUMMARY): FastifyInstance => {
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk));
        callback();
      },
    });

    return buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'trace',
        PROCESSING_TEMP_DIR: tempDir,
      }),
      processor: new DocumentProcessingOrchestrator({
        ocrProvider: new MockOcrProvider({ defaultText: ocrText }),
        summaryProvider: new MockSummaryProvider({ summary }),
      }),
      logStream,
    });
  };

  const post = async (): Promise<ReturnType<FastifyInstance['inject']>> => {
    const { headers, payload } = buildMultipart(fields, [
      { name: 'pages', filename: 'page-1.png', contentType: 'image/png', content: whitePng() },
    ]);

    return app.inject({ method: 'POST', url: URL, headers, payload });
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ayunetz-e2e-'));
    logLines = [];
  });

  afterEach(async () => {
    await app?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('turns a page into a validated, redacted summary', async () => {
    app = startApp(SYNTHETIC_REPORT);

    const response = await post();
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.processingStatus).toBe('ready');
    expect(body.summary.findings[0].label).toBe('HbA1c');
    expect(body.privacy.redactionApplied).toBe(true);
    expect(body.privacy.possiblePiiRemaining).toBe(false);
    expect(body.privacy.pipelineVersion).toBe('redaction-v1');
  });

  it('returns counts but never the values that were removed', async () => {
    app = startApp(SYNTHETIC_REPORT);

    const response = await post();

    expect(response.json().privacy.redactedEntityCounts.patientName).toBeGreaterThan(0);
    for (const value of MUST_NOT_SURVIVE) {
      expect(response.body).not.toContain(value);
    }
  });

  it('deletes the uploaded pages on success', async () => {
    app = startApp(SYNTHETIC_REPORT);

    await post();

    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('stops at the privacy gate and still deletes the pages', async () => {
    // An identifier with no redaction rule: the gate is the only thing that
    // can catch it, and it must stop the request before any summary is made.
    app = startApp('DL No TN0120110012345 enclosed\nHbA1c 8.1 %');

    const response = await post();
    const body = response.json();

    expect(response.statusCode).toBe(422);
    expect(body.code).toBe('privacy_failed');
    expect(body.details.possiblePiiRemaining).toBe(true);
    expect(body.details.categories).toContain('possible_identifier');
    expect(response.body).not.toContain('TN0120110012345');
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('refuses a summary citing a page that does not exist, and cleans up', async () => {
    app = startApp(SYNTHETIC_REPORT, {
      ...SUMMARY,
      findings: [{ ...SUMMARY.findings[0]!, sources: [{ page: 9 }] }],
    });

    const response = await post();

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('validation_failed');
    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('writes no document text, identifier or filename to the log', async () => {
    app = startApp(SYNTHETIC_REPORT);

    await post();

    const logs = logLines.join('\n');

    expect(logs.length).toBeGreaterThan(0);
    for (const value of MUST_NOT_SURVIVE) {
      expect(logs).not.toContain(value);
    }
    expect(logs).not.toContain('HbA1c');
    expect(logs).not.toContain('page-1.png');
  });

  it('logs nothing sensitive when the privacy gate fires either', async () => {
    app = startApp('DL No TN0120110012345 enclosed\nHbA1c 8.1 %');

    await post();

    const logs = logLines.join('\n');

    expect(logs).not.toContain('TN0120110012345');
    expect(logs).toContain('privacy_failed');
  });

  it('runs in mock mode by default, with no external call attempted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    app = startApp(SYNTHETIC_REPORT);

    await post();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
