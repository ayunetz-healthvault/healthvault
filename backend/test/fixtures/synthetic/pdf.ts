import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Builds a real PDF at test time.
 *
 * A genuine file rather than a hand-crafted byte string, because the thing
 * under test is a PDF parser: a fake would only prove the parser accepts fakes.
 * It is generated, never committed — Phase 1 is synthetic data only.
 *
 * `cupsfilter` is macOS-only. Where it is missing the caller should skip; the
 * alternative is a committed binary fixture, which is the thing being avoided.
 */

export const canBuildPdf = (): boolean => fs.existsSync('/usr/sbin/cupsfilter');

export const buildTextPdf = (lines: string[]): Buffer => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ayunetz-pdf-fixture-'));
  const source = path.join(dir, 'source.txt');

  try {
    fs.writeFileSync(source, lines.join('\n'));
    const pdf = execFileSync('/usr/sbin/cupsfilter', [source], {
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Buffer.from(pdf);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** A one-page synthetic lab report with identifiers to remove. */
export const SYNTHETIC_PDF_LINES = [
  'SOUTHERN DIAGNOSTICS LABORATORY',
  'Address: 12 Bharathi Salai, Mylapore',
  'Chennai 600004',
  'Patient Name: Lakshmi Iyer',
  'UHID: MH-4471',
  '',
  'Report Date: 12/07/2026',
  'HbA1c 8.1 % Below 7.0 %',
  'Glucose, fasting 142 mg/dL 70-100 mg/dL',
  'Platelet count 245000 /uL',
];
