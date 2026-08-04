import { ProcessingError, type PatientRedactionProfile } from '../../types/processing.js';

/**
 * Independent leakage gate — ADR-002 § "Independent leakage gate", P1-07.
 *
 * ## Why this file duplicates work
 *
 * It would be shorter to run `RedactionService` again and check whether
 * anything changed. That is precisely what the ADR forbids: *"The leakage gate
 * must not simply call the same method again."*
 *
 * A gate built from the redactor's own rules can only ever confirm that the
 * redactor did what it does. It cannot catch the case that matters — a rule
 * that was never written, or one whose regular expression is subtly wrong. So
 * the checks below are written separately and deliberately differently: they
 * are broader, they do not care about false positives, and several of them
 * would be unacceptable as redaction rules because they would destroy clinical
 * content. As a *detector*, over-sensitivity is the correct bias.
 *
 * ## What it never does
 *
 * It never returns, logs, or otherwise emits the text it found suspicious.
 * Categories only. A gate that reported "found phone number 9840012345" would
 * leak the very value it exists to protect, into exactly the response and log
 * lines that are least controlled.
 */

/** Category names are the only thing that ever leaves this module. */
export type LeakageCategory =
  | 'possible_patient_name'
  | 'possible_person_name'
  | 'possible_address'
  | 'possible_phone'
  | 'possible_email'
  | 'possible_date_of_birth'
  | 'possible_identifier'
  | 'possible_facility'
  | 'possible_url';

export type LeakageCheckResult =
  { safe: true; categories: [] } | { safe: false; categories: LeakageCategory[] };

interface Detector {
  category: LeakageCategory;
  /** Written independently of the redaction patterns. Broad by intent. */
  test: RegExp;
}

/**
 * Structural detectors.
 *
 * These are looser than their redaction counterparts on purpose. The phone
 * detector, for example, fires on any run of ten or more digits with optional
 * separators — as a redaction rule that would eat a long accession number that
 * a doctor needs; as a detector it is exactly right.
 */
const DETECTORS: Detector[] = [
  {
    category: 'possible_email',
    // No space before the @. A globe icon on a hospital letterhead OCR'd as
    // `@`, turning `Commitment. @ www.example.org` into an address the gate
    // refused the whole document over. A gate that blocks every letterhead with
    // a website on it gets switched off.
    test: /[A-Za-z0-9._%+-]+@\s?[A-Za-z0-9.-]+\s?\.\s?[A-Za-z]{2,}/,
  },
  {
    category: 'possible_url',
    test: /\bhttps?:\/\/\S+/i,
  },
  {
    category: 'possible_facility',
    // A letterhead website with no scheme on it. The globe-icon lesson applies
    // to *blocking* on a mangled `@`, not to letting the clinic's own domain
    // through: the redactor removes these now, so one surviving is a miss.
    test: /\bwww\.[A-Za-z0-9-]+\.[A-Za-z]{2,}\b|\b[A-Za-z0-9-]{2,}\.(?:com|org|net|edu|gov|info|health|clinic|hospital|care)\b/i,
  },
  {
    category: 'possible_phone',
    // Ten to thirteen contiguous digits, or the 5+5 / +91 groupings a printed
    // Indian mobile uses. Deliberately *not* "any ten digits with separators":
    // a reference range like `150000-410000` is twelve digits and a dash, and
    // a gate that fired on every lab range would be turned off within a week.
    // The last alternative is anchored on a literal country code and allows any
    // grouping. A real clinic letterhead printed `+91 80 4000 1122`, split
    // 2-4-4, and every rule here missed it — the gate called the document safe
    // with a phone number still in it.
    test: /\b\d{10,13}\b|\b[6-9]\d{4}[\s-]\d{5}\b|\+\d{1,3}(?:[\s-]?\d){9,12}/,
  },
  {
    category: 'possible_identifier',
    // Aadhaar shape, PAN shape, passport shape, a long alphanumeric run, or a
    // hyphenated code. The alphanumeric rules require both a digit and a
    // letter, so "Creatinine" and "Investigation" do not trip them.
    //
    // The hyphenated alternative exists because `KMC-DEMO-445566` — a
    // clinician's registration number on a real report — survived: `\b\w+\b`
    // stops at each hyphen, so no run was ever long enough to notice.
    test: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\b[A-Z]{5}[\s-]?\d{4}[\s-]?[A-Z]\b|\b[A-PR-WY]\d{7}\b|\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{10,}\b|\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]+(?:-[A-Za-z0-9]+){1,}\b(?<=[A-Za-z0-9-]{10,})/,
  },
  {
    category: 'possible_address',
    // An address label with anything left after it, or a labelled PIN code.
    // A bare six-digit number is *not* treated as a postal code: on a lab
    // report it is far more likely to be a platelet count.
    test: /\b(?:address|addr|residence|residing[ \t]+at)\b(?:[ \t]*[:.-][ \t]*|[ \t]+)\S+|\bpin(?:[ \t]*code)?[ \t]*[:.-]?[ \t]*\d{6}\b/i,
  },
  {
    category: 'possible_facility',
    // Where the document was made. Written out longhand in both cases rather
    // than generated, so that a bug in the redactor's pattern builder cannot
    // also be a bug here — that shared failure is the whole thing this gate
    // exists to survive.
    //
    // The noun must follow a capitalised word, and the list stops short of
    // `Lab` and a bare `Centre` on purpose. `Sample sent to Central Lab` is a
    // sentence a real report writes, and a gate that refused every document
    // containing it would be switched off inside a week — the same lesson the
    // letterhead globe icon taught.
    test: /\b[A-Z][A-Za-z'&.-]*[ \t]+(?:Hospitals?|Clinics?|Polyclinics?|Nursing[ \t]+Home|Medical[ \t]+(?:College|Centre|Center)|Health[ \t]*(?:Centre|Center|care|[ \t]Care)|Diagnostics?|Diagnostic[ \t]+(?:Centre|Center)|Laborator(?:y|ies)|Labs|Dispensary|Pharmacy|Institute|Infirmary|Sanatorium)\b|\b[A-Z][A-Z'&.-]*[ \t]+(?:HOSPITALS?|CLINICS?|POLYCLINICS?|NURSING[ \t]+HOME|MEDICAL[ \t]+(?:COLLEGE|CENTRE|CENTER)|HEALTH[ \t]*(?:CENTRE|CENTER|CARE)|DIAGNOSTICS?|LABORATOR(?:Y|IES)|LABS|DISPENSARY|PHARMACY|INSTITUTE|INFIRMARY|SANATORIUM)\b/,
  },
  {
    category: 'possible_address',
    // A street address with no label in front of it — the letterhead form.
    // Anchored on the street type, and on a capitalised word before it, so
    // `2 Drive` and a lone `Road` do not fire.
    test: /\b[A-Z][A-Za-z'&.-]*[ \t]+(?:Road|Rd|Street|Avenue|Ave|Drive|Lane|Marg|Nagar|Layout|Colony|Extension|Boulevard|Blvd|Highway|Parkway)\b|\b[A-Z][A-Z'&.-]*[ \t]+(?:ROAD|RD|STREET|AVENUE|AVE|DRIVE|LANE|MARG|NAGAR|LAYOUT|COLONY|EXTENSION|BOULEVARD|BLVD|HIGHWAY|PARKWAY)\b|\b[Pp]\.?[ \t]?[Oo]\.?[ \t]+[Bb][Oo][Xx][ \t]+\d/,
  },
  {
    category: 'possible_date_of_birth',
    test: /\b(?:dob|d\.o\.b|date[ \t]+of[ \t]+birth|birth[ \t]+date|born(?:[ \t]+on)?)\b(?:[ \t]*[:.-][ \t]*|[ \t]+)\S+/i,
  },
  {
    category: 'possible_person_name',
    // A patient-name label with a value left after it. Anchored to the start of
    // a line for the bare "Name:" form, so a lab report's "Test Name: HbA1c"
    // column header is not mistaken for an identity field.
    test: /\bpatient(?:'?s)?\s+name\b[ \t]*[:.-][ \t]*\S+|^[ \t]*name[ \t]*[:.-][ \t]*\S+/im,
  },
];

/** Text a placeholder occupies, removed before structural checks run. */
const PLACEHOLDER_PATTERN = /\[[A-Z_]+\]/g;

/**
 * A postal code left sitting in address context.
 *
 * Runs against the text *before* placeholders are stripped, because the
 * placeholder is the context. `[ADDRESS] 600004` is the exact leak this catches;
 * a bare `245000` on a results line is a platelet count and is left alone.
 *
 * Deliberately narrower than the redactor's equivalent rule — the gate looks at
 * one line rather than a window — so that the two can disagree. A gate that
 * reasoned identically to the redactor could only ever confirm it.
 */
const postcodeInAddressContext = (text: string): boolean =>
  text.split('\n').some(
    (line) =>
      (line.includes('[ADDRESS]') ||
        line.includes('[FACILITY]') ||
        /\b(?:address|pin(?:\s*code)?|zip(?:\s*code)?)\b/i.test(line)) &&
      // Six digits for an Indian PIN, five (optionally ZIP+4) for a US one.
      // Two of the four real documents this was tested against were American
      // and neither postal code was recognised by the Indian rule.
      /\b[1-9]\d{5}\b|\b\d{5}(?:-\d{4})?\b/.test(line),
  );

/** Escapes a literal for use in a regular expression. */
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Known values, checked literally.
 *
 * This is the one check that cannot produce a false positive and cannot be
 * argued with: the app told us this patient is called Lakshmi Iyer, and the
 * text that is about to be sent to an external provider still says so.
 */
const findKnownValueLeaks = (text: string, patient: PatientRedactionProfile): LeakageCategory[] => {
  const found = new Set<LeakageCategory>();

  const nameParts = [patient.fullName, ...patient.aliases]
    .flatMap((name) => name.split(/[\s,]+/))
    .map((part) => part.replace(/[.]/g, '').trim())
    .filter((part) => part.length >= 3);

  for (const part of nameParts) {
    if (new RegExp(`\\b${escape(part)}\\b`, 'i').test(text)) {
      found.add('possible_patient_name');
      break;
    }
  }

  for (const id of patient.knownPatientIds) {
    if (id.trim().length >= 3 && new RegExp(escape(id.trim()), 'i').test(text)) {
      found.add('possible_identifier');
      break;
    }
  }

  if (patient.phone !== undefined) {
    const digits = patient.phone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      // Allow separators between digits, as OCR introduces them.
      const spaced = new RegExp(digits.split('').join('[\\s-]?'));
      if (spaced.test(text)) {
        found.add('possible_phone');
      }
    }
  }

  if (patient.dateOfBirth !== undefined && patient.dateOfBirth.length >= 6) {
    if (text.includes(patient.dateOfBirth)) {
      found.add('possible_date_of_birth');
    }
  }

  if (patient.city !== undefined && patient.city.trim().length >= 3) {
    if (new RegExp(`\\b${escape(patient.city.trim())}\\b`, 'i').test(text)) {
      found.add('possible_address');
    }
  }

  return [...found];
};

/**
 * Scans redacted text for identifiers that should not have survived.
 *
 * Fails closed: any hit means the external call does not happen. There is no
 * threshold, no score and no "probably fine" — the whole point of a gate is
 * that it is binary.
 */
export const checkForLeakage = (
  pages: { page: number; text: string }[],
  patient: PatientRedactionProfile,
): LeakageCheckResult => {
  const categories = new Set<LeakageCategory>();

  for (const page of pages) {
    // Placeholders are removed first. `[PATIENT_ID]` must not be read as a
    // long alphanumeric identifier by the structural detectors — the redactor
    // put it there precisely to say the value is gone.
    const stripped = page.text.replace(PLACEHOLDER_PATTERN, ' ');

    // Checked before stripping: here the placeholder *is* the evidence.
    if (postcodeInAddressContext(page.text)) {
      categories.add('possible_address');
    }

    for (const category of findKnownValueLeaks(stripped, patient)) {
      categories.add(category);
    }

    for (const detector of DETECTORS) {
      if (detector.test.test(stripped)) {
        categories.add(detector.category);
      }
    }
  }

  if (categories.size === 0) {
    return { safe: true, categories: [] };
  }

  // Sorted so the response is stable and comparable between runs.
  return { safe: false, categories: [...categories].sort() };
};

/**
 * The fail-closed decision, in one place.
 *
 * Call this immediately before handing text to an external provider. It throws
 * rather than returning a boolean on purpose: a caller can forget to check a
 * return value, and the failure mode of forgetting here is sending a patient's
 * identifiers to a third party.
 *
 * The thrown error carries the categories — never the text. The message is the
 * one the app shows the user, and it deliberately says nothing about what was
 * found, because the user's screen is not a controlled surface either.
 */
export const assertSafeToSend = (
  pages: { page: number; text: string }[],
  patient: PatientRedactionProfile,
): void => {
  const result = checkForLeakage(pages, patient);

  if (result.safe) {
    return;
  }

  throw new ProcessingError('privacy_failed', 'The document could not be processed safely.', {
    retryable: false,
    details: { possiblePiiRemaining: true, categories: result.categories },
  });
};
