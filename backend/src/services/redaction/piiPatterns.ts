import type { RedactionCategory } from '../../types/processing.js';

/**
 * Deterministic identifier patterns — ADR-002 § "Layer 2".
 *
 * Two failure modes are being balanced here, and they are not symmetric. A
 * false negative sends a real identifier to an external model. A false positive
 * removes a lab value the family needed. The first is worse, so patterns lean
 * broad — but never so broad that they eat numbers with units, which is why
 * almost everything here is anchored on a label, a separator or a length that
 * clinical values do not have.
 *
 * Every pattern is tested against both valid examples and clinical near-misses.
 * See test/unit/redaction.test.ts.
 */

export const PLACEHOLDER: Record<RedactionCategory, string> = {
  patientName: '[PATIENT_NAME]',
  personName: '[PERSON_NAME]',
  address: '[ADDRESS]',
  phone: '[PHONE]',
  email: '[EMAIL]',
  dateOfBirth: '[DATE_OF_BIRTH]',
  aadhaar: '[AADHAAR]',
  pan: '[PAN]',
  passport: '[PASSPORT]',
  patientId: '[PATIENT_ID]',
  insuranceId: '[INSURANCE_ID]',
  facility: '[FACILITY]',
  other: '[REDACTED_IDENTIFIER]',
};

export interface PiiPattern {
  category: RedactionCategory;
  pattern: RegExp;
  /**
   * Keeps a leading label or separator that the pattern had to match in order
   * to anchor. `$<keep>` in the replacement.
   */
  keepsPrefix?: boolean;
}

/**
 * Order matters. The most specific and highest-confidence patterns run first,
 * so a PAN is labelled `[PAN]` rather than swallowed by the generic long-
 * identifier rule and labelled `[REDACTED_IDENTIFIER]`. The typed placeholder
 * is what lets the model still understand the document's structure.
 */
/**
 * Identifiers that can *contain* a name or a number we would otherwise redact
 * on its own, and so must be matched before any other layer runs.
 *
 * `family.iyer@example.com` is the case that forced this: redacting the
 * surname first leaves `family.[PATIENT_NAME]@example.com`, which is no longer
 * recognisable as an email address, so the domain and the structure survive.
 * Matching the whole address first removes it in one piece.
 */
export const EMBEDDING_PATTERNS: PiiPattern[] = [
  {
    category: 'email',
    // Deliberately permissive on the local part; OCR mangles dots and plus signs.
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: 'other',
    // A URL carrying what looks like an identifier in its path or query.
    pattern: /\bhttps?:\/\/\S*(?:\d{5,}|[A-Za-z0-9]{12,})\S*/g,
  },
];

// ---------------------------------------------------------------------------
// Facility identity
// ---------------------------------------------------------------------------

/**
 * Where the document was produced, and the address it was produced at.
 *
 * The product decision (2026-08-04) is narrower than ADR-002's default and
 * easier to state: **the content of the report goes to Sarvam, not where or who
 * created it.** Provenance is not lost — the original document is stored
 * locally and remains the source of truth — it simply never leaves the Ayunetz
 * boundary. ADR-002 § "Names of clinicians and facilities" required this to be
 * decided before production; this is the decision.
 *
 * A hospital name plus a date plus a condition narrows a population hard, and
 * unlike a patient name it survives every other layer here: no label introduces
 * a letterhead, and the app cannot tell us a value it never knew.
 *
 * `preserve doctor speciality and document type` still holds. None of these
 * patterns touch `Department of Cardiology`, `Discharge Summary` or
 * `Laboratory Report`, because every one of them requires a capitalised proper
 * noun sitting immediately in front of the keyword.
 */

/** Escapes and allows OCR's variable spacing inside a multi-word phrase. */
const spaced = (phrase: string): string =>
  phrase
    .split(' ')
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[ \\t]+');

/**
 * Matched in both Title Case and ALL CAPS, because a letterhead is as likely to
 * be one as the other and a case-insensitive flag would also uncapitalise the
 * proper-noun requirement that keeps these patterns safe.
 */
const bothCases = (phrases: string[]): string =>
  phrases.flatMap((phrase) => [spaced(phrase), spaced(phrase.toUpperCase())]).join('|');

/**
 * Nouns that make the words in front of them a facility name.
 *
 * `Lab` is deliberately absent where `Laboratory` is present: `Lab Report` and
 * `Lab No` are document furniture, and a rule that ate the first would be
 * removing the document type the ADR says to keep.
 */
const FACILITY_NOUNS = [
  'Hospital',
  'Clinic',
  'Polyclinic',
  'Nursing Home',
  'Medical College',
  'Medical Centre',
  'Medical Center',
  'Health Centre',
  'Health Center',
  'Healthcare',
  'Health Care',
  'Diagnostic Centre',
  'Diagnostic Center',
  'Diagnostic',
  'Laboratories',
  'Laboratory',
  'Labs',
  'Imaging Centre',
  'Imaging Center',
  'Scan Centre',
  'Scan Center',
  'Dispensary',
  'Pharmacy',
  'Institute',
  'Infirmary',
  'Sanatorium',
];

/**
 * Street types that end an address line.
 *
 * Several obvious candidates are missing on purpose, because each one is also a
 * clinical term and this layer must not destroy clinical content:
 * `Block` (heart block), `Circle` (circle of Willis), `Cross` (cross-matching)
 * and the bare abbreviation `St` (ST-segment elevation). Losing a rare address
 * form is recoverable; deleting a cardiology finding is not.
 */
const STREET_TYPES = [
  'Road',
  'Rd',
  'Street',
  'Avenue',
  'Ave',
  'Drive',
  'Lane',
  'Marg',
  'Nagar',
  'Layout',
  'Colony',
  'Extension',
  'Boulevard',
  'Blvd',
  'Highway',
  'Parkway',
];

/** A capitalised word — Title Case or ALL CAPS — as used in a proper noun run. */
const PROPER_WORD = "[A-Z][A-Za-z'&.-]*";

/**
 * Trailing `, Springfield, IL 62704` or `, Chennai 600004`.
 *
 * Consumed as part of the address rather than left behind, because a city and a
 * postal code are the parts that actually locate the facility. Bounded to a few
 * tokens and to horizontal whitespace, so it cannot run past the end of a line.
 */
const ADDRESS_TAIL =
  `(?:[,][ \\t]*${PROPER_WORD}){0,3}` +
  `(?:[,][ \\t]*[A-Z]{2}\\b)?` +
  `(?:[, \\t]+\\d{5,6}(?:-\\d{4})?\\b)?`;

export const FACILITY_PATTERNS: PiiPattern[] = [
  {
    category: 'facility',
    // `Sunrise Multispeciality Hospital`, `METROPOLIS LABORATORIES`,
    // `St. Mary's Clinic`. One to four proper nouns in front of the keyword.
    pattern: new RegExp(
      `\\b(?:${PROPER_WORD}[ \\t]+){1,4}(?:${bothCases(FACILITY_NOUNS)})(?:s|S)?\\b`,
      'g',
    ),
  },
  {
    category: 'address',
    // A numbered street address: `125 Riverbend Drive, Springfield, IL 62704`.
    pattern: new RegExp(
      `\\b\\d{1,5}(?:[/-]\\d{1,4})?[A-Za-z]?[ \\t]+` +
        `(?:${PROPER_WORD}[ \\t]+){0,4}(?:${bothCases(STREET_TYPES)})\\b${ADDRESS_TAIL}`,
      'g',
    ),
  },
  {
    category: 'address',
    // The same street with no house number: `Green Valley Road, Chennai`.
    // Safe without the number because every street type left in the list is a
    // word no clinical phrase ends on.
    pattern: new RegExp(
      `\\b(?:${PROPER_WORD}[ \\t]+){1,4}(?:${bothCases(STREET_TYPES)})\\b${ADDRESS_TAIL}`,
      'g',
    ),
  },
  {
    category: 'address',
    pattern: /\bP\.?[ \t]?O\.?[ \t]+Box[ \t]+\d{1,6}\b/gi,
  },
  {
    category: 'facility',
    // The letterhead website. `www.sunrisehospital.org` names the facility as
    // precisely as its letterhead does, and every rule above walked past it
    // because it is neither a name, an address, nor an `https://` URL.
    //
    // Runs after the email layer, so `reports@sunrisehospital.org` has already
    // been removed whole and this cannot clip what is left of one.
    pattern: /\b(?:https?:\/\/)?www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/gi,
  },
  {
    category: 'facility',
    // A bare domain with no `www.`, restricted to real top-level domains so a
    // decimal lab value cannot be mistaken for one. `13.8` has no TLD; the
    // shortest thing this matches is something like `apollo.in`.
    pattern:
      /\b[A-Za-z0-9-]{2,}(?:\.[A-Za-z0-9-]+)*\.(?:com|org|net|edu|gov|info|health|clinic|hospital|care|in|co\.in|org\.in|net\.in)\b/gi,
  },
];

export const PII_PATTERNS: PiiPattern[] = [
  {
    category: 'aadhaar',
    // 12 digits, usually spaced 4-4-4. OCR frequently loses the spacing.
    //
    // The boundaries exclude hyphens deliberately. A real report ID like
    // `DEMO-2026-0814-0042` contains a 4-4-4 run and was being labelled
    // [AADHAAR], which is both wrong and misleading to the model — the typed
    // placeholder is supposed to say what kind of thing was removed.
    pattern: /(?<![\w-])\d{4}[ ]?\d{4}[ ]?\d{4}(?![\w-])|(?<![\w-])\d{4}-\d{4}-\d{4}(?![\w-])/g,
  },
  {
    category: 'pan',
    // Five letters, four digits, one letter. Structurally unmistakable.
    pattern: /\b[A-Z]{5}[ -]?\d{4}[ -]?[A-Z]\b/g,
  },
  {
    category: 'passport',
    // Indian passport: one letter then seven digits.
    pattern: /\b[A-PR-WY][ -]?\d{7}\b/g,
  },
  {
    category: 'phone',
    // Indian mobile with optional +91, or a 10-digit number starting 6–9.
    // Anchored on the leading digit range so it cannot match a four-figure lab
    // value or a year.
    pattern: /(?:\+91[ -]?)?\b[6-9]\d{4}[ -]?\d{5}\b/g,
  },
  {
    category: 'phone',
    // A +91 number with any grouping at all. The clinic landline on a real
    // sample was printed `+91 80 4000 1122` — ten digits split 2-4-4 — which
    // the 5+5 mobile rule below does not see. Anchored on the literal country
    // code, so it cannot swallow a lab value.
    pattern: /\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d){6,10}/g,
  },
  {
    category: 'phone',
    // A North American number: (555) 123-4567. Anchored on the bracketed area
    // code, which no clinical value has.
    pattern: /\(\d{3}\)[\s-]?\d{3}[\s-]?\d{4}/g,
  },
  {
    category: 'phone',
    // Landline with an STD code in brackets or separated by a dash.
    pattern: /\b0\d{2,4}[ -]\d{6,8}\b|\(\d{3,5}\)[ -]?\d{6,8}\b/g,
  },
];

/**
 * Labels whose *value* is an identifier, keyed by the category to record.
 *
 * ADR-002 § "Layer 3": some values are only identifiable by what precedes them.
 * A hospital number has no distinctive shape — `4471` is a registration number
 * or a platelet count depending entirely on the words in front of it.
 */
export const LABELLED_VALUE_PATTERNS: PiiPattern[] = [
  {
    category: 'personName',
    // `Dr. Nisha Kapoor` on a letterhead, `Attending Physician: Dr. Sofia
    // Reed`, a signature block — three real documents put a clinician's name in
    // three different places, and only one of them had a label above it.
    //
    // Matching the title rather than the label catches all three, and stops at
    // the name so a trailing `, MBBS, MD` or `, Internal Medicine` survives.
    // ADR-002: remove the individual, keep the speciality.
    pattern: /\bDr\.?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}/g,
  },
  {
    category: 'dateOfBirth',
    // First, so a date of birth is labelled as one rather than being caught by
    // a later numeric rule.
    pattern:
      /\b(?<keep>(?:DOB|D\.O\.B|DATE\s+OF\s+BIRTH|BIRTH\s+DATE|BORN(?:\s+ON)?)\s*[:.-]?\s*)[0-9A-Za-z][0-9A-Za-z ,/-]{5,20}/gi,
    keepsPrefix: true,
  },
  {
    category: 'patientId',
    // Includes the document's own identifiers — report id, lab accession,
    // visit number. A real sample carried `Report ID: DEMO-2026-0814-0042` and
    // `Laboratory accession: LAB-DEMO-7741`; both survived redaction and the
    // leakage gate then refused the whole document, correctly but uselessly.
    // They are lookup keys back to the record, so they go.
    pattern:
      /\b(?<keep>(?:UHID|MRN|MR\.?\s?NO|IP\s?NO|OP\s?NO|PATIENT\s?(?:ID|NO|NUMBER)|REG(?:ISTRATION)?\.?\s?(?:ID|NO|NUMBER)|HOSP(?:ITAL)?\s?(?:ID|NO)|REPORT\s?(?:ID|NO|NUMBER)|LAB(?:ORATORY)?\s+ACCESSION|ACCESSION\s?(?:ID|NO|NUMBER)?|SPECIMEN\s?(?:ID|NO)|VISIT\s?(?:ID|NO)|ENCOUNTER\s?(?:ID|NO)|CLIA\s?ID|CLIA|NABL|ACCREDITATION\s?(?:ID|NO))\s*[:.#-]?\s*)[A-Za-z0-9][A-Za-z0-9/-]{2,}/gi,
    keepsPrefix: true,
  },
  {
    category: 'insuranceId',
    pattern:
      /\b(?<keep>(?:INSURANCE|POLICY|MEMBER|TPA|ECHS|CGHS|ESIC)\s*(?:ID|NO|NUMBER|CARD)?\s*[:.#-]?\s*)[A-Za-z0-9][A-Za-z0-9/-]{3,}/gi,
    keepsPrefix: true,
  },
  {
    category: 'phone',
    pattern:
      /\b(?<keep>(?:MOBILE|PHONE|CONTACT|TEL(?:EPHONE)?|CELL)\s*(?:NO|NUMBER)?\s*[:.-]?\s*)[+0-9][0-9 ()-]{6,}/gi,
    keepsPrefix: true,
  },
];

/**
 * Runs last, after every typed rule has had its chance.
 *
 * ADR-002's catch-all: a long account-like run of digits that no clinical value
 * has. Ten or more, so a six-figure platelet count and a four-figure year are
 * both safe. Anything it catches is labelled `[REDACTED_IDENTIFIER]` — less
 * informative than a typed placeholder, which is why it goes last.
 */
export const CATCH_ALL_PATTERNS: PiiPattern[] = [
  {
    category: 'other',
    pattern: /\b\d{10,}\b/g,
  },
];

/**
 * An Indian postal code: six digits, never starting with zero.
 *
 * Used **only** in address context, never on its own. On a lab report a bare
 * six-digit number is far more likely to be a platelet count — `245000` matches
 * this pattern perfectly — so applying it without context would delete clinical
 * values. See `redactPostalCodes`.
 */
export const POSTAL_CODE = /\b[1-9]\d{5}\b/g;

/** Labels that introduce an address, possibly running over several lines. */
export const ADDRESS_LABELS =
  /^\s*(?:ADDRESS|ADDR|RESIDENCE|RESIDING\s+AT|PATIENT\s+ADDRESS|HOME\s+ADDRESS|PERMANENT\s+ADDRESS)\s*[:.-]?/i;

/** Labels that introduce a person's name, with the value on the same line. */
export const NAME_LABELS =
  /^\s*(?:PATIENT(?:'?S)?\s+NAME|PATIENT|NAME\s+OF\s+PATIENT|NAME|MR|MRS|MS)\s*[:.-]\s*/i;

/**
 * A field label sitting alone on its line, with the value on the next one.
 *
 * Real PDFs do this constantly. A two-column "Patient name | Rohan Mehta"
 * layout flattens to two lines with no colon anywhere, and every same-line rule
 * misses it. On a real sample report the patient's name survived redaction
 * completely for exactly this reason — it was only removed at all because the
 * app happened to already know it, which will not be true of a second patient
 * on a shared report, a spouse, or a name spelled differently to the profile.
 */
export const BARE_NAME_LABEL =
  /^\s*(?:PATIENT(?:'?S)?\s+NAME|NAME\s+OF\s+PATIENT|PATIENT\s+NAME|FULL\s+NAME|NAME)\s*$/i;

export const BARE_ADDRESS_LABEL =
  /^\s*(?:ADDRESS|RESIDENCE|HOME\s+ADDRESS|PERMANENT\s+ADDRESS|PATIENT\s+ADDRESS)\s*$/i;

/**
 * Labels introducing a clinician's identity.
 *
 * ADR-002's default privacy-first position: remove individual clinician names
 * and registration numbers, keep the speciality and the document type. A named
 * doctor plus a date narrows a population sharply, and the family does not need
 * the name in the summary — they have the original letter.
 */
export const BARE_CLINICIAN_LABEL =
  /^\s*(?:CONSULTANT|CLINICIAN|PHYSICIAN|DOCTOR|REVIEWED\s+BY|REPORTED\s+BY|REFERRED\s+BY|REFERRING\s+DOCTOR|ATTENDING|SURGEON|REGISTRATION(?:\s+(?:NO|NUMBER|ID))?|LICENCE|LICENSE)\s*$/i;

/**
 * A line that clearly starts a new clinical section, used to stop a multi-line
 * address from swallowing the report.
 */
export const CLINICAL_SECTION_START =
  /^\s*(?:TEST|INVESTIGATION|RESULT|REPORT|SPECIMEN|SAMPLE|DEPARTMENT|DIAGNOSIS|COMPLAINT|HISTORY|EXAMINATION|ADVICE|PRESCRIPTION|MEDICATION|RX|IMPRESSION|FINDINGS|CONCLUSION|SIGNATURE|DOCTOR|CONSULTANT|REF(?:ERRED|ERRING)?\s+BY|COLLECTED|RECEIVED|REPORTED|AGE|SEX|GENDER|BLOOD\s+GROUP)\b/i;

/** Date labels whose value is clinical and must survive redaction. */
export const CLINICAL_DATE_LABELS =
  /\b(?:REPORT(?:ED|ING)?|SAMPLE|COLLECT(?:ED|ION)|TEST|DISCHARGE|ADMISSION|ADMITTED|REVIEW|FOLLOW[\s-]?UP|APPOINTMENT|NEXT\s+VISIT|VISIT|SURGERY|PROCEDURE)\s+DATE\b|\bDATE\s+OF\s+(?:REPORT|SAMPLE|COLLECTION|TEST|DISCHARGE|ADMISSION|SURGERY|PROCEDURE|VISIT)\b/i;
