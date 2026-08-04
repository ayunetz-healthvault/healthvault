import {
  emptyRedactionCounts,
  type PatientRedactionProfile,
  type RedactionCategory,
  type RedactionCounts,
} from '../../types/processing.js';

import { redactLabelledRegions, redactPostalCodes } from './addressRedactor.js';
import { buildNameVariants, redactKnownNames } from './nameMatcher.js';
import {
  CATCH_ALL_PATTERNS,
  EMBEDDING_PATTERNS,
  LABELLED_VALUE_PATTERNS,
  PII_PATTERNS,
  PLACEHOLDER,
  type PiiPattern,
} from './piiPatterns.js';

/**
 * Layered redaction — the implementation of ADR-002.
 *
 * ```text
 * embedding identifiers -> known values -> labelled regions
 *   -> typed patterns -> catch-all
 * ```
 *
 * The order is the design, not an implementation detail. Known values run
 * first because they are the only layer that cannot produce a false positive:
 * the app told us this is the patient's name. Typed patterns run before the
 * catch-all so an Aadhaar number becomes `[AADHAAR]` rather than an anonymous
 * `[REDACTED_IDENTIFIER]` — the model needs to know *what kind* of thing was
 * removed to make sense of the document's structure.
 *
 * ## What this is not
 *
 * This is pseudonymisation, not anonymisation. Removing a name and an address
 * does not make a document unidentifiable: a rare condition, an unusual
 * sequence of dates, or a distinctive combination of findings can still point
 * at one person. See docs/architecture/README.md § "pseudonymisation warning".
 *
 * ## Bump the version when the rules change
 *
 * `pipelineVersion` is stored with every summary. It is what makes it possible
 * to answer "which redaction rules was this document processed under?" after
 * the rules have moved on.
 */

export const REDACTION_PIPELINE_VERSION = 'redaction-v1';

export interface RedactionInputPage {
  page: number;
  text: string;
}

export interface RedactedPage {
  page: number;
  text: string;
}

export interface RedactionResult {
  pages: RedactedPage[];
  counts: RedactionCounts;
  pipelineVersion: string;
}

/** Applies one pattern, counting replacements. */
const applyPattern = (
  text: string,
  { category, pattern, keepsPrefix }: PiiPattern,
  counts: RedactionCounts,
): string =>
  text.replace(pattern, (...args) => {
    counts[category] += 1;

    if (keepsPrefix !== true) {
      return PLACEHOLDER[category];
    }

    // Named groups arrive as the last argument when the pattern has any.
    const groups = args[args.length - 1] as Record<string, string> | undefined;
    const keep = typeof groups === 'object' && groups !== null ? (groups.keep ?? '') : '';

    return `${keep}${PLACEHOLDER[category]}`;
  });

/** Escapes a known value so it can be matched literally, case-insensitively. */
const literalPattern = (value: string): RegExp =>
  new RegExp(
    value
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+'),
    'gi',
  );

/**
 * Redacts a value the app told us about.
 *
 * Known values are exact, so this is a literal match rather than a pattern —
 * no false positives are possible beyond the value genuinely appearing.
 */
const redactKnownValue = (
  text: string,
  value: string | undefined,
  category: RedactionCategory,
  counts: RedactionCounts,
): string => {
  if (value === undefined || value.trim().length < 3) {
    return text;
  }

  return text.replace(literalPattern(value), () => {
    counts[category] += 1;
    return PLACEHOLDER[category];
  });
};

/**
 * A known phone number, matched loosely enough to survive OCR.
 *
 * "+91 98400 12345" on a form and "9840012345" on a report are the same number;
 * matching only the exact string the app sent would miss the printed one.
 */
const redactKnownPhone = (
  text: string,
  phone: string | undefined,
  counts: RedactionCounts,
): string => {
  if (phone === undefined) {
    return text;
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) {
    return text;
  }

  // Match the last 10 digits with any separators between them.
  const significant = digits.slice(-10).split('');
  const pattern = new RegExp(`(?:\\+?91[\\s-]?)?${significant.join('[\\s-]?')}`, 'g');

  return text.replace(pattern, () => {
    counts.phone += 1;
    return PLACEHOLDER.phone;
  });
};

export class RedactionService {
  readonly pipelineVersion = REDACTION_PIPELINE_VERSION;

  /**
   * Redacts every page.
   *
   * Pages are processed independently so one page's layout cannot affect
   * another's, and counts are accumulated across the document.
   */
  redact(pages: RedactionInputPage[], patient: PatientRedactionProfile): RedactionResult {
    const counts = emptyRedactionCounts();
    const nameVariants = buildNameVariants(patient.fullName, patient.aliases);

    const redactedPages = pages.map((page) => ({
      page: page.page,
      text: this.redactPage(page.text, patient, nameVariants, counts),
    }));

    return { pages: redactedPages, counts, pipelineVersion: this.pipelineVersion };
  }

  private redactPage(
    text: string,
    patient: PatientRedactionProfile,
    nameVariants: string[],
    counts: RedactionCounts,
  ): string {
    // --- Layer 0: identifiers that embed other identifiers ----------------
    // Email addresses and URLs frequently contain the patient's own name.
    // Redacting the name first would break them apart and leave the remainder
    // unrecognisable, so these are matched whole, before anything else.
    let preRedacted = text;
    for (const pattern of EMBEDDING_PATTERNS) {
      preRedacted = applyPattern(preRedacted, pattern, counts);
    }

    // --- Layer 1: known values -------------------------------------------
    const named = redactKnownNames(preRedacted, nameVariants, PLACEHOLDER.patientName);
    counts.patientName += named.count;
    let output = named.text;

    for (const id of patient.knownPatientIds) {
      output = redactKnownValue(output, id, 'patientId', counts);
    }

    output = redactKnownPhone(output, patient.phone, counts);
    output = redactKnownValue(output, patient.dateOfBirth, 'dateOfBirth', counts);
    output = redactKnownValue(output, patient.city, 'address', counts);

    // --- Layer 2: labelled regions ---------------------------------------
    const regions = redactLabelledRegions(output.split('\n'));
    counts.address += regions.addressCount;
    counts.personName += regions.nameCount;

    // Postcodes run after the address block, because they are only recognisable
    // by the address context the previous pass just established.
    const postcodes = redactPostalCodes(regions.lines);
    counts.address += postcodes.count;
    output = postcodes.lines.join('\n');

    // --- Layer 3: typed patterns -----------------------------------------
    // Labelled values first: a hospital number has no shape of its own, so the
    // label is the only thing that identifies it before a generic rule would.
    for (const pattern of [...LABELLED_VALUE_PATTERNS, ...PII_PATTERNS]) {
      output = applyPattern(output, pattern, counts);
    }

    // --- Layer 4: catch-all ----------------------------------------------
    for (const pattern of CATCH_ALL_PATTERNS) {
      output = applyPattern(output, pattern, counts);
    }

    return output;
  }
}
