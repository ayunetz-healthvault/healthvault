import { describe, expect, it } from 'vitest';

import { normalisePages, normalisePageText } from '../../src/services/processing/normaliseText.js';
import { RedactionService } from '../../src/services/redaction/RedactionService.js';
import { SYNTHETIC_PATIENT } from '../fixtures/synthetic/report.js';

describe('normalisePageText', () => {
  it('folds dash variants to a plain hyphen', () => {
    expect(normalisePageText('70–100 mg/dL')).toBe('70-100 mg/dL');
    expect(normalisePageText('MH‑4471')).toBe('MH-4471');
    expect(normalisePageText('ref－ range')).toBe('ref- range');
  });

  it('folds quote variants', () => {
    expect(normalisePageText('“fasting”')).toBe('"fasting"');
    expect(normalisePageText('patient’s')).toBe("patient's");
  });

  it('folds a full-width colon, which labels depend on', () => {
    expect(normalisePageText('UHID： MH-4471')).toBe('UHID: MH-4471');
  });

  it('replaces non-breaking and exotic spaces', () => {
    expect(normalisePageText('Patient Name: X')).toBe('Patient Name: X');
    expect(normalisePageText('8.1 %')).toBe('8.1 %');
  });

  it('removes zero-width characters that split a word invisibly', () => {
    expect(normalisePageText('Laksh​mi')).toBe('Lakshmi');
    expect(normalisePageText('﻿Report')).toBe('Report');
  });

  it('keeps line breaks and leading indentation, which carry structure', () => {
    const table = 'TEST      RESULT\n  HbA1c    8.1 %';

    expect(normalisePageText(table)).toBe(table);
  });

  it('collapses runs of blank lines but keeps a single separator', () => {
    expect(normalisePageText('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(normalisePageText('a\n\nb')).toBe('a\n\nb');
  });

  it('does not collapse runs of spaces inside a line', () => {
    // Column alignment is how a lab report separates a value from its range.
    expect(normalisePageText('HbA1c     8.1 %')).toBe('HbA1c     8.1 %');
  });

  it('preserves page numbers when normalising a document', () => {
    expect(normalisePages([{ page: 3, text: ' x ' }])).toEqual([{ page: 3, text: 'x' }]);
  });
});

describe('why normalisation runs before redaction', () => {
  it('lets a label anchored on a plain colon match a full-width one', () => {
    const service = new RedactionService();
    const raw = 'UHID： MH-4471';

    const withoutNormalising = service.redact([{ page: 1, text: raw }], SYNTHETIC_PATIENT);
    const withNormalising = service.redact(
      [{ page: 1, text: normalisePageText(raw) }],
      SYNTHETIC_PATIENT,
    );

    // The known-value rule catches the id either way; the *labelled* rule only
    // fires once the separator is recognisable, which is the point of the step.
    expect(withNormalising.pages[0]?.text).toBe('UHID: [PATIENT_ID]');
    expect(withoutNormalising.pages[0]?.text).not.toContain('UHID: [PATIENT_ID]');
  });

  it('reunites a name split by a zero-width character', () => {
    const service = new RedactionService();
    const raw = 'Patient: Laksh​mi Iyer';

    const redacted = service.redact([{ page: 1, text: normalisePageText(raw) }], SYNTHETIC_PATIENT);

    expect(redacted.pages[0]?.text).toBe('Patient: [PATIENT_NAME]');
  });
});
