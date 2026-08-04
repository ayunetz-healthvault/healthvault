import { describe, expect, it } from 'vitest';

import { buildNameVariants } from '../../src/services/redaction/nameMatcher.js';
import { RedactionService } from '../../src/services/redaction/RedactionService.js';
import type { PatientRedactionProfile } from '../../src/types/processing.js';
import {
  MUST_NOT_SURVIVE,
  MUST_SURVIVE,
  SYNTHETIC_PATIENT,
  SYNTHETIC_REPORT,
} from '../fixtures/synthetic/report.js';

/**
 * Redaction tests.
 *
 * Structured around ADR-002 § "Testing strategy", which lists the cases that
 * must be covered. All fixtures are synthetic.
 */

const service = new RedactionService();

/** Redacts one page of text and returns it. */
const redact = (
  text: string,
  patient: Partial<PatientRedactionProfile> = {},
): { text: string; counts: Record<string, number> } => {
  const result = service.redact([{ page: 1, text }], {
    fullName: 'Lakshmi Iyer',
    aliases: [],
    knownPatientIds: [],
    ...patient,
  });

  return { text: result.pages[0]?.text ?? '', counts: result.counts };
};

describe('known-value name redaction', () => {
  it('removes the exact patient name', () => {
    const { text, counts } = redact('Patient: Lakshmi Iyer attended today.');

    expect(text).toContain('[PATIENT_NAME]');
    expect(text).not.toContain('Lakshmi');
    expect(counts.patientName).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(redact('LAKSHMI IYER').text).toBe('[PATIENT_NAME]');
    expect(redact('lakshmi iyer').text).toBe('[PATIENT_NAME]');
    expect(redact('LaKsHmI iYeR').text).toBe('[PATIENT_NAME]');
  });

  it('removes aliases', () => {
    const { text } = redact('Referred as Lakshmi Ramanathan Iyer.', {
      aliases: ['Lakshmi Ramanathan Iyer'],
    });

    expect(text).not.toContain('Ramanathan');
    expect(text).toContain('[PATIENT_NAME]');
  });

  it('removes the surname and given name on their own', () => {
    expect(redact('Mrs Iyer was seen in clinic.').text).not.toContain('Iyer');
    expect(redact('Lakshmi reports feeling better.').text).not.toContain('Lakshmi');
  });

  it('removes a reversed name', () => {
    expect(redact('Iyer Lakshmi').text).not.toContain('Iyer');
    expect(redact('Iyer, Lakshmi').text).not.toContain('Lakshmi');
  });

  it('removes an initial beside the surname', () => {
    expect(redact('Seen by L. Iyer today').text).not.toContain('Iyer');
  });

  it('consumes a title so no dangling honorific remains', () => {
    const { text } = redact('Mrs. Lakshmi Iyer');

    expect(text).toBe('[PATIENT_NAME]');
  });

  it('matches across a line break introduced by OCR', () => {
    const { text } = redact('Patient: Lakshmi\nIyer');

    expect(text).not.toContain('Lakshmi');
  });

  it('does not invent matches from bare initials', () => {
    // "LI" is an abbreviation, not this patient. ADR-002 warns against fuzzy
    // matching that eats clinical terms.
    const { text } = redact('LI values were within range.');

    expect(text).toContain('LI values');
  });

  it('leaves clinical words that merely resemble a name alone', () => {
    const { text } = redact('Iron studies were normal.', { fullName: 'Ira Menon' });

    expect(text).toContain('Iron studies');
  });
});

describe('buildNameVariants', () => {
  it('orders variants longest first so the full name wins', () => {
    const variants = buildNameVariants('Lakshmi Iyer', []);

    // The bare surname must come after any fuller form, so a full-name match
    // wins and produces one placeholder rather than two adjacent ones.
    expect(variants.indexOf('Lakshmi Iyer')).toBeLessThan(variants.indexOf('Iyer'));
    expect(variants).toContain('Iyer');
  });

  it('drops tokens too short to be safe', () => {
    expect(buildNameVariants('Jo Li', [])).not.toContain('Jo');
  });
});

describe('pattern redaction', () => {
  const cases: [string, string, string][] = [
    ['email', 'Contact family.iyer@example.com for reports', '[EMAIL]'],
    ['Aadhaar with spaces', 'Aadhaar 1234 5678 9012', '[AADHAAR]'],
    ['Aadhaar without spaces', 'Aadhaar 123456789012', '[AADHAAR]'],
    ['PAN', 'PAN ABCDE1234F', '[PAN]'],
    ['passport', 'Passport K1234567', '[PASSPORT]'],
    ['mobile with country code', 'Call +91 98400 12345', '[PHONE]'],
    ['bare mobile', 'Call 9840012345', '[PHONE]'],
    [
      'identifier-bearing URL',
      'See https://portal.example.com/r/AB93KD02LMQ4',
      '[REDACTED_IDENTIFIER]',
    ],
    ['long account number', 'Account 900123456789012', '[REDACTED_IDENTIFIER]'],
  ];

  it.each(cases)('redacts %s', (_label, input, placeholder) => {
    expect(redact(input).text).toContain(placeholder);
  });

  it('gives each identifier class its own placeholder', () => {
    const { text } = redact('Aadhaar 1234 5678 9012 PAN ABCDE1234F');

    // Typed placeholders, not a single anonymous marker — the model needs the
    // document's structure to survive redaction.
    expect(text).toContain('[AADHAAR]');
    expect(text).toContain('[PAN]');
  });
});

describe('labelled-value redaction', () => {
  it('removes a hospital number that has no shape of its own', () => {
    const { text, counts } = redact('UHID: MH-4471');

    expect(text).toBe('UHID: [PATIENT_ID]');
    expect(counts.patientId).toBe(1);
  });

  it.each(['MRN: 88213', 'Registration No: 2026/00412', 'IP No: A-99321', 'Patient ID: XYZ-1122'])(
    'removes %s',
    (line) => {
      expect(redact(line).text).toContain('[PATIENT_ID]');
    },
  );

  it('removes an insurance or member identifier', () => {
    expect(redact('Insurance No: POL-99887766').text).toContain('[INSURANCE_ID]');
    expect(redact('Member ID: TPA-4433221').text).toContain('[INSURANCE_ID]');
  });

  it('keeps the label so the model still knows what was there', () => {
    expect(redact('UHID: MH-4471').text.startsWith('UHID:')).toBe(true);
  });
});

describe('date handling', () => {
  it('removes a labelled date of birth', () => {
    const { text, counts } = redact('DOB: 18/04/1955');

    expect(text).toContain('[DATE_OF_BIRTH]');
    expect(text).not.toContain('1955');
    expect(counts.dateOfBirth).toBe(1);
  });

  it.each(['Date of Birth: 18-04-1955', 'D.O.B: 18/04/1955', 'Born on 18 April 1955'])(
    'removes %s',
    (line) => {
      expect(redact(line).text).toContain('[DATE_OF_BIRTH]');
    },
  );

  it('preserves clinical dates', () => {
    // The single most damaging false positive available: a redactor that eats
    // "Review Date" has removed the follow-up the whole product exists for.
    const clinical = [
      'Report Date: 12/07/2026',
      'Sample Date: 12/07/2026',
      'Discharge Date: 22/03/2026',
      'Review Date: 12/10/2026',
      'Follow-up Date: 05/01/2027',
    ].join('\n');

    const { text } = redact(clinical);

    expect(text).toBe(clinical);
  });

  it('removes a known date of birth wherever it appears in full', () => {
    const { text } = redact('Recorded 1955-04-18 in the file', {
      dateOfBirth: '1955-04-18',
    });

    expect(text).toContain('[DATE_OF_BIRTH]');
  });
});

describe('address redaction', () => {
  it('removes a single-line address but keeps the label', () => {
    const { text, counts } = redact('Address: 12 Bharathi Salai, Mylapore');

    expect(text).toBe('Address: [ADDRESS]');
    expect(counts.address).toBe(1);
  });

  it('removes a multi-line address', () => {
    const { text } = redact(
      ['Address: 12 Bharathi Salai', 'Mylapore', 'Chennai 600004', ''].join('\n'),
      { city: 'Chennai' },
    );

    expect(text).not.toContain('Bharathi');
    expect(text).not.toContain('Mylapore');
    expect(text).not.toContain('600004');
  });

  it('stops at the first clinical section', () => {
    const { text } = redact(
      ['Address: 12 Bharathi Salai', 'Test: HbA1c', 'Result: 8.1 %'].join('\n'),
    );

    expect(text).toContain('Test: HbA1c');
    expect(text).toContain('8.1 %');
  });

  it('stops at the next labelled field', () => {
    const { text } = redact(['Address: 12 Bharathi Salai', 'Sample Date: 12/07/2026'].join('\n'));

    expect(text).toContain('Sample Date: 12/07/2026');
  });

  it('stops at a blank line', () => {
    const { text } = redact(['Address: 12 Bharathi Salai', '', 'HbA1c 8.1 %'].join('\n'));

    expect(text).toContain('HbA1c 8.1 %');
  });

  it('removes a name field belonging to someone we were not told about', () => {
    // A next-of-kin or a second patient on a shared report.
    const { text, counts } = redact('Name: Ramesh Subramanian');

    expect(text).toContain('[PERSON_NAME]');
    expect(counts.personName).toBe(1);
  });
});

describe('clinical preservation', () => {
  it.each([
    ['test name and value', 'HbA1c 8.1 %'],
    ['value with unit', 'Glucose, fasting 142 mg/dL'],
    ['reference range', 'Reference 70-100 mg/dL'],
    ['six-figure count', 'Platelet count 245000 /uL'],
    ['medicine, dose and frequency', 'Tab Metformin 1000 mg twice a day'],
    ['duration', 'Continue for 90 days'],
    ['speciality', 'Refer to Endocrinology'],
  ])('preserves %s', (_label, line) => {
    expect(redact(line).text).toBe(line);
  });

  it('does not mistake a lab value for a phone number', () => {
    expect(redact('Vitamin B12 611 pg/mL').text).toContain('611');
  });

  it('does not mistake a year for an identifier', () => {
    expect(redact('Previous test in 2024 showed 7.4 %').text).toContain('2024');
  });
});

describe('the whole synthetic report', () => {
  const { text, counts } = redact(SYNTHETIC_REPORT, SYNTHETIC_PATIENT);

  it.each(MUST_NOT_SURVIVE)('removes %s', (value) => {
    expect(text).not.toContain(value);
  });

  it.each(MUST_SURVIVE)('preserves %s', (value) => {
    expect(text).toContain(value);
  });

  it('counts what it removed, by category', () => {
    expect(counts.patientName).toBeGreaterThan(0);
    expect(counts.address).toBeGreaterThan(0);
    expect(counts.phone).toBeGreaterThan(0);
    expect(counts.email).toBe(1);
    expect(counts.aadhaar).toBe(1);
    expect(counts.pan).toBe(1);
    expect(counts.patientId).toBeGreaterThan(0);
    expect(counts.insuranceId).toBe(1);
    expect(counts.dateOfBirth).toBeGreaterThan(0);
  });

  it('reports a pipeline version so a summary can be traced to its rules', () => {
    const result = service.redact([{ page: 1, text: 'anything' }], SYNTHETIC_PATIENT);

    expect(result.pipelineVersion).toBe('redaction-v2');
  });

  it('never returns the values it removed', () => {
    const result = service.redact([{ page: 1, text: SYNTHETIC_REPORT }], SYNTHETIC_PATIENT);
    const serialised = JSON.stringify({ counts: result.counts, version: result.pipelineVersion });

    for (const value of MUST_NOT_SURVIVE) {
      expect(serialised).not.toContain(value);
    }
  });
});

describe('multi-page documents', () => {
  it('redacts each page and accumulates counts across the document', () => {
    const result = service.redact(
      [
        { page: 1, text: 'Patient Name: Lakshmi Iyer' },
        { page: 2, text: 'Aadhaar: 1234 5678 9012' },
      ],
      SYNTHETIC_PATIENT,
    );

    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[0]?.text).toContain('[PATIENT_NAME]');
    expect(result.pages[1]?.text).toContain('[AADHAAR]');
    expect(result.counts.patientName).toBe(1);
    expect(result.counts.aadhaar).toBe(1);
  });

  it('does not let one page leak into another', () => {
    const result = service.redact(
      [
        { page: 1, text: 'Address: 12 Bharathi Salai' },
        { page: 2, text: 'HbA1c 8.1 %' },
      ],
      SYNTHETIC_PATIENT,
    );

    // Page 1's unterminated address block must not consume page 2's results.
    expect(result.pages[1]?.text).toBe('HbA1c 8.1 %');
  });
});

describe('postal codes', () => {
  it('removes a postcode left beside a redacted city', () => {
    // The exact leak found by running a real rendered lab report through the
    // pipeline: the city went, the PIN code stayed.
    const { text } = redact(['Address: 12 Bharathi Salai', '', 'Chennai 600004'].join('\n'), {
      city: 'Chennai',
    });

    expect(text).not.toContain('600004');
    expect(text).toContain('[ADDRESS]');
  });

  it('removes a postcode on a line following an address label', () => {
    const { text } = redact(['Address: 4 Kutchery Road', 'Mylapore 600004'].join('\n'));

    expect(text).not.toContain('600004');
  });

  it('removes a postcode even when the city was never known to us', () => {
    const { text } = redact(['Address: 9 Mount Road', 'Guindy 600032'].join('\n'));

    expect(text).not.toContain('600032');
  });

  it('leaves a six-figure lab value alone', () => {
    // 245000 matches a postcode exactly. Removing it would delete a platelet
    // count, which is the false positive this rule is scoped to avoid.
    const { text } = redact('Platelet count 245000 /uL   150000-410000 /uL');

    expect(text).toContain('245000');
    expect(text).toContain('150000-410000');
  });

  it('leaves a six-figure value alone even on the page that has an address', () => {
    const { text } = redact(
      [
        'Address: 12 Bharathi Salai',
        'Chennai 600004',
        '',
        'TEST RESULT',
        'Platelet count 245000 /uL',
      ].join('\n'),
      { city: 'Chennai' },
    );

    expect(text).not.toContain('600004');
    expect(text).toContain('245000');
  });

  it('stops looking once the clinical section starts', () => {
    const { text } = redact(
      ['Address: 12 Bharathi Salai', 'Result: platelets', 'Count 245000'].join('\n'),
    );

    expect(text).toContain('245000');
  });

  it('counts a separately redacted postcode as an address', () => {
    // When the postcode sits on its own line right after the label it is
    // consumed with the address block and counted once. This is the case where
    // a blank line breaks the block, so the postcode is redacted on its own.
    const { counts } = redact(['Address: 12 Bharathi Salai', '', 'Chennai 600004'].join('\n'), {
      city: 'Chennai',
    });

    expect(counts.address).toBeGreaterThanOrEqual(3);
  });
});

describe('layouts a real PDF actually produces', () => {
  /**
   * Every case here comes from running a genuine (fictional) outpatient report
   * through the pipeline. A PDF's two-column header flattens to a label line
   * followed by a value line, with no colon anywhere — and every same-line rule
   * missed it.
   */
  it('removes a name whose label is on the line above', () => {
    const { text } = redact(['Patient name', 'Rohan Mehta', 'Sex', 'Male'].join('\n'), {
      fullName: 'Someone Else',
    });

    // The app did not know this patient. Before the fix the name survived
    // completely, which is the case that matters: a second patient on a shared
    // report, a spouse, or a spelling that differs from the profile.
    expect(text).not.toContain('Rohan Mehta');
    expect(text).toContain('[PERSON_NAME]');
    // The label survives so the model still knows what the field was.
    expect(text).toContain('Patient name');
    expect(text).toContain('Male');
  });

  it('removes an address whose label is on the line above', () => {
    const { text } = redact(
      ['Address', '18 Lakeview Residency, Bengaluru', 'Sex', 'Male'].join('\n'),
    );

    expect(text).not.toContain('Lakeview');
    expect(text).toContain('Male');
  });

  it('removes a clinician name and registration number', () => {
    // ADR-002's default privacy-first position: clinician names and
    // registrations go, speciality and document type stay.
    const { text } = redact(
      [
        'Consultant',
        'Dr. Ananya Rao, MBBS, MD',
        'Registration',
        'KMC-DEMO-445566',
        'Designation',
        'Consultant - Internal Medicine',
      ].join('\n'),
    );

    expect(text).not.toContain('Ananya Rao');
    expect(text).not.toContain('KMC-DEMO-445566');
    // The speciality is clinically useful and stays.
    expect(text).toContain('Internal Medicine');
  });

  it('does not eat a value when a label has no value under it', () => {
    const { text } = redact(['Notes', '', '', 'HbA1c 8.1 %'].join('\n'));

    expect(text).toContain('HbA1c 8.1 %');
  });

  it('removes a landline printed with an unusual grouping', () => {
    // `+91 80 4000 1122` is ten digits split 2-4-4; the 5+5 mobile rule
    // never saw it, so a clinic phone number reached the "safe" text.
    const { text } = redact('Contact us on +91 80 4000 1122 during clinic hours');

    expect(text).not.toContain('4000 1122');
    expect(text).toContain('[PHONE]');
  });

  it('removes the document’s own identifiers', () => {
    const { text } = redact(
      ['Report ID: DEMO-2026-0814-0042', 'Laboratory accession: LAB-DEMO-7741'].join('\n'),
    );

    expect(text).not.toContain('DEMO-2026-0814-0042');
    expect(text).not.toContain('LAB-DEMO-7741');
  });

  it('no longer mislabels a report id as an Aadhaar number', () => {
    // `DEMO-2026-0814-0042` contains a 4-4-4 digit run. Labelling it [AADHAAR]
    // is wrong and misleads the model about what was removed.
    const { counts } = redact('Report ID: DEMO-2026-0814-0042');

    expect(counts.aadhaar).toBe(0);
    expect(counts.patientId).toBe(1);
  });

  it('still catches a genuine Aadhaar number standing alone', () => {
    expect(redact('Aadhaar 1234 5678 9012').counts.aadhaar).toBe(1);
    expect(redact('Aadhaar 1234-5678-9012').counts.aadhaar).toBe(1);
  });
});

describe('layouts from a lab report, a discharge summary and a photographed prescription', () => {
  it.each([
    ['a US number in brackets', 'Reception (217) 555-0198'],
    ['an international number in brackets', 'Call +1 (555) 123-4567 for appointments'],
  ])('removes %s', (_label, line) => {
    // Every phone rule was written for Indian formats. Two of three real
    // documents carried North American numbers on the letterhead.
    expect(redact(line).text).not.toMatch(/\d{3}[\s-]?\d{4}/);
    expect(redact(line).text).toContain('[PHONE]');
  });

  it.each([
    'Dr. Nisha Kapoor, MBBS, MD',
    'Attending Physician: Dr. Sofia Reed, Internal Medicine',
    'Reviewed by: Dr. Elena Brooks, MD',
    'Lab Director: Dr. Elena Brooks, MD',
  ])('removes a clinician from "%s"', (line) => {
    const { text } = redact(line);

    expect(text).not.toMatch(/Kapoor|Reed|Brooks/);
    expect(text).toContain('[PERSON_NAME]');
  });

  it('keeps the speciality and qualifications after removing the name', () => {
    // ADR-002: remove the individual, keep the speciality.
    const { text } = redact('Attending Physician: Dr. Sofia Reed, Internal Medicine');

    expect(text).toContain('Internal Medicine');
  });

  it('does not treat an ordinary sentence starting with "Dr" as a name', () => {
    expect(redact('Drink plenty of water and rest.').text).toContain('Drink plenty');
  });

  it('removes a laboratory accreditation number', () => {
    expect(redact('CLIA ID: 14D1234567').text).not.toContain('14D1234567');
  });

  it('leaves the lab table untouched', () => {
    const table = [
      'Hemoglobin 13.8 g/dL 13.0 - 17.0',
      'Fasting Glucose 104 mg/dL 70 - 99 High',
      'HbA1c 5.9 % 4.0 - 5.6 High',
      'Total Cholesterol 212 mg/dL <200 High',
      'Triglycerides 168 mg/dL <150 High',
      'TSH 2.1 uIU/mL 0.4 - 4.0',
    ].join('\n');

    expect(redact(table).text).toBe(table);
  });
});

describe('facility identity', () => {
  /**
   * The product decision of 2026-08-04: the content of the report goes to
   * Sarvam, not where or who created it. ADR-002 § "Names of clinicians and
   * facilities" required this to be decided before production.
   *
   * Every fixture here is synthetic. The layouts are modelled on the four real
   * documents that exposed the gap, but no text is taken from them.
   */

  it('removes a hospital name from a letterhead', () => {
    const { text, counts } = redact('Sunrise Multispeciality Hospital');

    expect(text).not.toContain('Sunrise');
    expect(text).toContain('[FACILITY]');
    expect(counts.facility).toBe(1);
  });

  it('removes an ALL CAPS letterhead, which is how most of them are printed', () => {
    expect(redact('METROPOLIS DIAGNOSTIC LABORATORIES').text).toBe('[FACILITY]');
  });

  it('handles punctuation in a facility name', () => {
    expect(redact("St. Mary's Clinic").text).toBe('[FACILITY]');
  });

  it('removes a numbered street address with a city, state and ZIP', () => {
    const { text, counts } = redact('125 Riverbend Drive, Springfield, IL 62704');

    expect(text).toBe('[ADDRESS]');
    expect(counts.address).toBe(1);
  });

  it('removes an Indian street address with a PIN code', () => {
    expect(redact('123 Green Valley Road, Chennai 600004').text).toBe('[ADDRESS]');
  });

  it('removes a street address that carries no house number', () => {
    expect(redact('Green Valley Road, Chennai').text).toBe('[ADDRESS]');
  });

  it('removes a post office box', () => {
    expect(redact('P.O. Box 4471').text).toBe('[ADDRESS]');
  });

  it('removes the facility name and its address from one line', () => {
    const { text } = redact('Sunrise Hospital, 125 Riverbend Drive, Springfield, IL 62704');

    expect(text).toBe('[FACILITY], [ADDRESS]');
  });

  it('removes a facility name whole rather than clipping it at a known city', () => {
    // The regression this ordering exists for: the known-city rule used to run
    // first and leave `[ADDRESS] Diagnostics` — a clipped name, not a removed
    // one. Facility matching runs before known values for exactly this case.
    const { text } = redact('Chennai Diagnostics', { city: 'Chennai' });

    expect(text).toBe('[FACILITY]');
    expect(text).not.toContain('Diagnostics');
  });

  // --- What must survive ---------------------------------------------------
  // ADR-002: preserve doctor speciality and document type. A rule that removed
  // these would be removing the thing the summary is meant to explain.

  it.each([
    'Department of Cardiology',
    'Laboratory Report',
    'Discharge Summary',
    'Lab No: see original',
    'Consultant: [PERSON_NAME], MBBS, MD, Internal Medicine',
    'Referred to Cardiology',
  ])('leaves document furniture and speciality alone: %s', (line) => {
    expect(redact(line).text).toBe(line);
  });

  it.each([
    'Left Bundle Branch Block noted on ECG',
    'ST elevation in leads V1-V3',
    'Circle of Willis is patent',
    'Cross-matching completed for two units',
    'Sample sent to Central Lab',
  ])('does not destroy a clinical phrase that reads like an address: %s', (line) => {
    expect(redact(line).text).toBe(line);
  });

  it('leaves a lowercase generic mention of a hospital alone', () => {
    const line = 'The patient was admitted to hospital overnight.';

    expect(redact(line).text).toBe(line);
  });
});

describe('facility websites', () => {
  it('removes a letterhead website', () => {
    expect(redact('www.sunrisehospital.org').text).toBe('[FACILITY]');
  });

  it('removes a bare domain with no www', () => {
    expect(redact('Visit apollodiagnostics.in for results').text).not.toContain(
      'apollodiagnostics',
    );
  });

  it('removes an email whole before the domain rule can clip it', () => {
    const { text, counts } = redact('Write to reports@sunrisehospital.org');

    expect(text).toBe('Write to [EMAIL]');
    expect(counts.email).toBe(1);
  });

  it('survives the OCR globe icon that used to be read as an email', () => {
    // `Commitment. @ www.example.org` — a globe glyph OCR'd as `@`. The website
    // goes; what is left must not look like an address the gate refuses.
    expect(redact('Commitment. @ www.example.org').text).toBe('Commitment. @ [FACILITY]');
  });

  it.each(['Hemoglobin 13.8 g/dL', 'HbA1c 5.9 %', 'Platelets 245000 /uL'])(
    'does not mistake a decimal lab value for a domain: %s',
    (line) => {
      expect(redact(line).text).toBe(line);
    },
  );
});
