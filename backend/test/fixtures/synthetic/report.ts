import type { PatientRedactionProfile } from '../../../src/types/processing.js';

/**
 * A synthetic lab report.
 *
 * Every value in here is invented. The name, the identifiers and the address
 * are fabrications chosen to exercise the redactor's rules, and the Aadhaar,
 * PAN and passport numbers are structurally valid but not issued to anyone.
 * Phase 1 is synthetic data only — docs/architecture/README.md, principle 17.
 */

export const SYNTHETIC_PATIENT: PatientRedactionProfile = {
  fullName: 'Lakshmi Iyer',
  aliases: ['Lakshmi Ramanathan Iyer', 'L. R. Iyer'],
  dateOfBirth: '1955-04-18',
  phone: '+91 98400 12345',
  city: 'Chennai',
  knownPatientIds: ['MH-4471'],
};

/** Header block: everything a redactor has to remove. */
export const SYNTHETIC_HEADER = [
  'SOUTHERN DIAGNOSTICS LABORATORY',
  'Address: 12 Bharathi Salai, Mylapore',
  'Chennai 600004',
  'Phone: +91 98400 12345',
  '',
  'Patient Name: Lakshmi Iyer',
  'DOB: 18/04/1955',
  'Age: 71   Sex: F',
  'UHID: MH-4471',
  'Aadhaar: 1234 5678 9012',
  'PAN: ABCDE1234F',
  'Email: family.iyer@example.com',
  'Insurance No: POL-99887766',
  '',
].join('\n');

/** Clinical block: everything the redactor must leave alone. */
export const SYNTHETIC_CLINICAL = [
  'Report Date: 12/07/2026',
  'Sample Date: 12/07/2026',
  '',
  'TEST                   RESULT      REFERENCE',
  'HbA1c                  8.1 %       Below 7.0 %',
  'Glucose, fasting       142 mg/dL   70-100 mg/dL',
  'Creatinine             0.9 mg/dL   0.6-1.1 mg/dL',
  'Platelet count         245000 /uL  150000-410000 /uL',
  '',
  'Advice: Repeat HbA1c after 3 months.',
  'Tab Metformin 1000 mg twice a day after food for 90 days.',
  'Review Date: 12/10/2026',
].join('\n');

export const SYNTHETIC_REPORT = `${SYNTHETIC_HEADER}\n${SYNTHETIC_CLINICAL}`;

/** Values that must not survive redaction. */
export const MUST_NOT_SURVIVE = [
  'Lakshmi',
  'Iyer',
  '12 Bharathi Salai',
  'Mylapore',
  '98400',
  '18/04/1955',
  'MH-4471',
  '1234 5678 9012',
  'ABCDE1234F',
  'family.iyer@example.com',
  'POL-99887766',
];

/** Values that must survive redaction, because the summary depends on them. */
export const MUST_SURVIVE = [
  '8.1 %',
  '142 mg/dL',
  '70-100 mg/dL',
  '0.9 mg/dL',
  '245000',
  'HbA1c',
  'Creatinine',
  'Metformin',
  '1000 mg',
  '90 days',
  '12/07/2026',
  '12/10/2026',
];
