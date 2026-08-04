import { describe, expect, it, vi } from 'vitest';

import { assertSafeToSend, checkForLeakage } from '../../src/services/redaction/leakageCheck.js';
import { RedactionService } from '../../src/services/redaction/RedactionService.js';
import type { ProcessingError } from '../../src/types/processing.js';
import { type PatientRedactionProfile } from '../../src/types/processing.js';
import {
  MUST_NOT_SURVIVE,
  SYNTHETIC_CLINICAL,
  SYNTHETIC_PATIENT,
  SYNTHETIC_REPORT,
} from '../fixtures/synthetic/report.js';

/**
 * Leakage-gate tests — P1-07.
 *
 * Two properties are being defended. The gate must *catch* identifiers that
 * survived redaction, and it must never *emit* what it caught.
 */

const patient: PatientRedactionProfile = SYNTHETIC_PATIENT;

const check = (text: string, profile: PatientRedactionProfile = patient) =>
  checkForLeakage([{ page: 1, text }], profile);

describe('safe text', () => {
  it('passes a fully redacted document', () => {
    const redacted = new RedactionService().redact([{ page: 1, text: SYNTHETIC_REPORT }], patient);

    const result = checkForLeakage(redacted.pages, patient);

    expect(result).toEqual({ safe: true, categories: [] });
  });

  it('passes a clinical block with no identifiers in it', () => {
    // This is the false-positive test that matters. A gate that fires on lab
    // values and reference ranges gets switched off, and then protects nothing.
    expect(check(SYNTHETIC_CLINICAL).safe).toBe(true);
  });

  it.each([
    'HbA1c 8.1 % (reference below 7.0 %)',
    'Platelet count 245000 /uL, range 150000-410000 /uL',
    'Tab Metformin 1000 mg twice a day for 90 days',
    'Report Date: 12/07/2026',
    'Creatinine and Investigation results were unremarkable',
    'Test Name: Complete Blood Count',
    'Vitamin B12 611 pg/mL',
  ])('does not fire on %s', (line) => {
    expect(check(line).safe).toBe(true);
  });

  it('is not tripped by the placeholders redaction leaves behind', () => {
    const placeholders = [
      'Patient Name: [PATIENT_NAME]',
      'Address: [ADDRESS]',
      'DOB: [DATE_OF_BIRTH]',
      'UHID: [PATIENT_ID]',
      'Aadhaar: [AADHAAR]',
      'Email: [EMAIL]',
      'Phone: [PHONE]',
      'Insurance No: [INSURANCE_ID]',
      'Ref: [REDACTED_IDENTIFIER]',
    ].join('\n');

    expect(check(placeholders).safe).toBe(true);
  });
});

describe('known values that survived redaction', () => {
  it('catches the patient name', () => {
    const result = check('Reviewed with Lakshmi Iyer in clinic.');

    expect(result.safe).toBe(false);
    expect(result.categories).toContain('possible_patient_name');
  });

  it('catches a single name part', () => {
    expect(check('Mrs Iyer attended.').categories).toContain('possible_patient_name');
  });

  it('catches an alias', () => {
    expect(check('Also known as Ramanathan.').categories).toContain('possible_patient_name');
  });

  it('catches the known phone number even with OCR spacing', () => {
    expect(check('Call 98400-12345 to confirm').categories).toContain('possible_phone');
    expect(check('Call 9 8 4 0 0 1 2 3 4 5').categories).toContain('possible_phone');
  });

  it('catches a known patient identifier', () => {
    expect(check('Ref MH-4471 attached').categories).toContain('possible_identifier');
  });

  it('catches the known city', () => {
    expect(check('Collected at the Chennai branch').categories).toContain('possible_address');
  });

  it('catches the known date of birth', () => {
    expect(check('Recorded 1955-04-18 on file').categories).toContain('possible_date_of_birth');
  });
});

describe('structural detection of identifiers the app never knew about', () => {
  it.each([
    ['an email address', 'Write to someone.else@example.com', 'possible_email'],
    ['a URL', 'Portal at https://records.example.com/p/9931', 'possible_url'],
    ['an Aadhaar-shaped number', 'ID 9876 5432 1098', 'possible_identifier'],
    ['a PAN-shaped code', 'PAN ZXCVB9876N', 'possible_identifier'],
    ['a passport-shaped code', 'Doc M7654321 verified', 'possible_identifier'],
    ['a long mixed identifier', 'Ref AB93KD02LMQ4 attached', 'possible_identifier'],
    ['a bare eleven-digit number', 'Account 90012345678', 'possible_phone'],
    ['an address label with a value', 'Address: 4 Kutchery Road', 'possible_address'],
    ['a labelled PIN code', 'PIN Code: 600004', 'possible_address'],
    ['a date-of-birth label with a value', 'DOB: 02/11/1951', 'possible_date_of_birth'],
    ['a name field for someone else', 'Name: Ramesh Subramanian', 'possible_person_name'],
  ])('catches %s', (_label, text, category) => {
    const result = check(text);

    expect(result.safe).toBe(false);
    expect(result.categories).toContain(category);
  });

  it('catches an identifier belonging to a different patient entirely', () => {
    // The gate is not only about *this* patient. A second person's details on
    // a shared report must not go to the provider either.
    const result = check('Second patient: Suresh Babu, mobile 9123456780');

    expect(result.safe).toBe(false);
  });
});

describe('what the result may contain', () => {
  it('never returns the suspected value', () => {
    const result = check(
      [
        'Patient: Lakshmi Iyer',
        'Phone: 9840012345',
        'Email: family.iyer@example.com',
        'Aadhaar: 1234 5678 9012',
        'Address: 12 Bharathi Salai',
      ].join('\n'),
    );

    const serialised = JSON.stringify(result);

    expect(result.safe).toBe(false);
    for (const value of MUST_NOT_SURVIVE) {
      expect(serialised).not.toContain(value);
    }
    // Not even a fragment.
    expect(serialised).not.toContain('9840');
    expect(serialised).not.toContain('Bharathi');
  });

  it('returns category names and nothing else', () => {
    const result = check('Patient: Lakshmi Iyer');

    expect(Object.keys(result).sort()).toEqual(['categories', 'safe']);
    for (const category of result.categories) {
      expect(category).toMatch(/^possible_[a-z_]+$/);
    }
  });

  it('reports categories in a stable order', () => {
    const text = 'Email a@b.co and Address: 4 Kutchery Road';

    expect(check(text).categories).toEqual([...check(text).categories].sort());
  });

  it('does not repeat a category found on several pages', () => {
    const result = checkForLeakage(
      [
        { page: 1, text: 'Patient: Lakshmi Iyer' },
        { page: 2, text: 'Patient: Lakshmi Iyer' },
      ],
      patient,
    );

    expect(result.categories.filter((c) => c === 'possible_patient_name')).toHaveLength(1);
  });
});

describe('assertSafeToSend — the fail-closed decision', () => {
  it('does nothing when the text is clean', () => {
    expect(() => assertSafeToSend([{ page: 1, text: SYNTHETIC_CLINICAL }], patient)).not.toThrow();
  });

  it('stops an external provider being called at all', async () => {
    // The point of the gate, expressed as a test: the provider is a spy, and it
    // must never be reached once the gate has objected.
    const provider = vi.fn(async () => ({ summary: 'should never be produced' }));

    const summarise = async (pages: { page: number; text: string }[]): Promise<unknown> => {
      assertSafeToSend(pages, patient);
      return provider();
    };

    await expect(
      summarise([{ page: 1, text: 'Patient: Lakshmi Iyer, mobile 9840012345' }]),
    ).rejects.toMatchObject({ code: 'privacy_failed' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('throws a privacy_failed error carrying categories but no values', () => {
    try {
      assertSafeToSend([{ page: 1, text: 'Patient: Lakshmi Iyer' }], patient);
      expect.unreachable('the gate should have refused');
    } catch (error) {
      const processingError = error as ProcessingError;
      const body = JSON.stringify(processingError.toBody());

      expect(processingError.code).toBe('privacy_failed');
      expect(processingError.retryable).toBe(false);
      expect(processingError.statusCode).toBe(422);
      expect(processingError.message).toBe('The document could not be processed safely.');
      expect(body).toContain('possiblePiiRemaining');
      expect(body).toContain('possible_patient_name');
      expect(body).not.toContain('Lakshmi');
      expect(body).not.toContain('Iyer');
    }
  });
});

describe('independence from the redactor', () => {
  it('catches an identifier the redactor is not configured to remove', () => {
    // A driving-licence number has no redaction rule at all. The gate must
    // still stop it, which is the entire reason it is written separately —
    // running the redactor twice could never detect this.
    const result = check('DL No TN0120110012345 enclosed');

    expect(result.safe).toBe(false);
    expect(result.categories).toContain('possible_identifier');
  });

  it('checks every page, not just the first', () => {
    const result = checkForLeakage(
      [
        { page: 1, text: 'Nothing identifying here at all.' },
        { page: 2, text: 'Nothing here either.' },
        { page: 3, text: 'Contact family.iyer@example.com' },
      ],
      patient,
    );

    expect(result.safe).toBe(false);
    expect(result.categories).toContain('possible_email');
  });
});

describe('postcodes left in address context', () => {
  it('catches a postcode beside an address placeholder', () => {
    // The redactor now removes this, but the gate must catch it independently —
    // that is the whole point of the gate being written separately.
    const result = check('Address: [ADDRESS]\n[ADDRESS] 600004');

    expect(result.safe).toBe(false);
    expect(result.categories).toContain('possible_address');
  });

  it('catches a postcode on a labelled address line', () => {
    expect(check('Address: Mylapore 600004').categories).toContain('possible_address');
  });

  it('does not fire on a six-figure lab value', () => {
    expect(check('Platelet count 245000 /uL, range 150000-410000 /uL').safe).toBe(true);
  });

  it('does not fire on a six-figure value elsewhere on an address page', () => {
    expect(check('Address: [ADDRESS]\n\nPlatelet count 245000 /uL').safe).toBe(true);
  });
});

describe('misses found on a real report', () => {
  it('catches a landline with an unusual grouping', () => {
    // The gate called a document safe with `+91 80 4000 1122` still in it.
    expect(check('Reception: +91 80 4000 1122').categories).toContain('possible_phone');
  });

  it('catches a hyphenated registration number', () => {
    // `\b` stops at each hyphen, so no run in `KMC-DEMO-445566` was ever long
    // enough for the old alphanumeric rule to notice.
    expect(check('Registration KMC-DEMO-445566').categories).toContain('possible_identifier');
  });

  it('catches a hyphenated document identifier', () => {
    expect(check('Report ID: DEMO-2026-0814-0042').categories).toContain('possible_identifier');
  });

  it('does not fire on ordinary hyphenated English', () => {
    // These are 10+ characters with hyphens but carry no digits.
    expect(check('Work-related stress; abdomen non-tender; tension-type headache').safe).toBe(true);
  });

  it('does not fire on hyphenated clinical terms with numbers', () => {
    expect(check('Vitamin D (25-OH) 24 ng/mL, range 30-100').safe).toBe(true);
    expect(check('Reference 150000-410000 /uL').safe).toBe(true);
  });
});

describe('false positives that would block real letterheads', () => {
  it('does not read a stray @ before a website as an email address', () => {
    // A globe icon on a hospital letterhead OCR'd as `@`. The gate refused the
    // whole document over it, and every hospital letterhead has a website.
    expect(check('Care. Compassion. Commitment. @ www.example-hospital.org').safe).toBe(true);
  });

  it('still catches a genuine email address', () => {
    expect(check('Write to reports@example.org').categories).toContain('possible_email');
  });

  it('does not fire on a laboratory results table', () => {
    const table = [
      'Hemoglobin 13.8 g/dL 13.0 - 17.0',
      'Platelets 248 x10^3/uL 150 - 400',
      'Total Cholesterol 212 mg/dL <200 High',
    ].join('\n');

    expect(check(table).safe).toBe(true);
  });
});
