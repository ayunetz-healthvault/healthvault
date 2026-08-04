import {
  ADDRESS_LABELS,
  BARE_ADDRESS_LABEL,
  BARE_CLINICIAN_LABEL,
  BARE_NAME_LABEL,
  CLINICAL_SECTION_START,
  NAME_LABELS,
  PLACEHOLDER,
  POSTAL_CODE,
} from './piiPatterns.js';

/**
 * Labelled-region redaction — ADR-002 § "Layer 3".
 *
 * Addresses have no reliable shape. What they do have is a label, and then a
 * few lines that belong to it. This walks line by line from an address label
 * and stops at the first thing that is clearly not part of an address.
 *
 * The stopping rule is the whole design. Without one, "Address:" at the top of
 * a lab report would swallow the results underneath it — the false positive
 * that ADR-002 lists as this layer's main risk.
 */

/** Most Indian postal addresses on a report header fit in three lines. */
const MAX_ADDRESS_LINES = 3;

export interface RegionRedactionResult {
  lines: string[];
  addressCount: number;
  nameCount: number;
}

const isBlank = (line: string): boolean => line.trim().length === 0;

/**
 * A line that looks like it belongs to an address rather than to the report.
 *
 * Anything with a colon-label is treated as a new field, on the grounds that
 * "Sample Date: ..." on the line after an address is a new field and not the
 * second line of a street.
 */
const looksLikeAnotherField = (line: string): boolean => /^[^:]{2,30}:/.test(line.trim());

/**
 * How far a postcode may sit from an address before it stops counting as part
 * of one. Three non-blank lines covers "street / area / city PIN".
 */
const POSTCODE_WINDOW = 3;

/**
 * Removes postal codes that sit in address context.
 *
 * This exists because of a specific miss found by running a real rendered lab
 * report through the pipeline: the header line `Chennai 600004` had the city
 * removed by the known-value rule, leaving `[ADDRESS] 600004` in the text sent
 * for summarising. A postcode plus a rare condition is a genuine
 * re-identification signal.
 *
 * The fix has to be context-bound. `245000` is a platelet count and matches a
 * postcode exactly, so a blanket six-digit rule would delete clinical values —
 * the precise false positive ADR-002 warns this layer is prone to. A postcode
 * is therefore only removed when it appears on, or just after, a line that has
 * already been identified as an address.
 */
export const redactPostalCodes = (lines: string[]): { lines: string[]; count: number } => {
  let count = 0;
  /** Non-blank lines since the last address line; `null` when out of range. */
  let sinceAddress: number | null = null;

  const output = lines.map((line) => {
    const isAddressLine = line.includes(PLACEHOLDER.address) || ADDRESS_LABELS.test(line);

    if (isAddressLine) {
      sinceAddress = 0;
    } else if (sinceAddress !== null && line.trim().length > 0) {
      // A clinical heading ends the address block, whatever the line count says.
      sinceAddress = CLINICAL_SECTION_START.test(line) ? null : sinceAddress + 1;
    }

    if (sinceAddress === null || sinceAddress > POSTCODE_WINDOW) {
      return line;
    }

    return line.replace(POSTAL_CODE, () => {
      count += 1;
      return PLACEHOLDER.address;
    });
  });

  return { lines: output, count };
};

/** Which kind of bare label a line is, if any. */
const bareLabelKind = (line: string): 'address' | 'person' | null => {
  if (BARE_ADDRESS_LABEL.test(line)) return 'address';
  if (BARE_NAME_LABEL.test(line) || BARE_CLINICIAN_LABEL.test(line)) return 'person';
  return null;
};

/**
 * The next line with content on it, or `null` if the label is not followed by
 * a value — a label at the foot of a page, say.
 *
 * A value that is already a placeholder is not one: an earlier layer got there
 * first, and replacing it again would double-count.
 */
const nextContentLine = (lines: string[], from: number): number | null => {
  for (let index = from + 1; index < lines.length && index <= from + 2; index += 1) {
    const candidate = lines[index] ?? '';
    if (isBlank(candidate)) continue;
    if (candidate.trim().startsWith('[')) return null;
    // Another label immediately below means this one had no value of its own.
    if (bareLabelKind(candidate) !== null) return null;
    return index;
  }
  return null;
};

/** Index of the last line belonging to an address block starting at `from`. */
const consumeAddressBlock = (lines: string[], from: number): number => {
  let last = from;

  for (let index = from + 1; index < lines.length && index - from < MAX_ADDRESS_LINES; index += 1) {
    const next = lines[index] ?? '';

    if (isBlank(next) || CLINICAL_SECTION_START.test(next) || looksLikeAnotherField(next)) {
      break;
    }
    if (bareLabelKind(next) !== null) break;

    last = index;
  }

  return last;
};

export const redactLabelledRegions = (lines: string[]): RegionRedactionResult => {
  const output: string[] = [];
  let addressCount = 0;
  let nameCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (ADDRESS_LABELS.test(line)) {
      const label = line.match(ADDRESS_LABELS)?.[0] ?? '';
      output.push(`${label} ${PLACEHOLDER.address}`.replace(/\s+/g, ' ').trimEnd());
      addressCount += 1;

      // Consume continuation lines, stopping at the first sign the address has
      // ended. A blank line, a new clinical section, or a new labelled field
      // all end it.
      let consumed = 0;
      while (consumed < MAX_ADDRESS_LINES && index + 1 < lines.length) {
        const next = lines[index + 1] ?? '';

        if (isBlank(next) || CLINICAL_SECTION_START.test(next) || looksLikeAnotherField(next)) {
          break;
        }

        index += 1;
        consumed += 1;
      }

      continue;
    }

    if (NAME_LABELS.test(line)) {
      // The label stays so the model still knows this was a name field; the
      // value goes. This catches names the app did not know about — a second
      // patient on a shared report, a next-of-kin.
      const label = line.match(NAME_LABELS)?.[0] ?? '';
      const remainder = line.slice(label.length).trim();

      if (remainder.length > 0 && !remainder.startsWith('[')) {
        output.push(`${label.trimEnd()} ${PLACEHOLDER.personName}`);
        nameCount += 1;
        continue;
      }
    }

    // --- A label alone on its line, value on the next -----------------------
    // The two-column layout every real PDF uses. Handled after the same-line
    // rules so a "Name: value" line is never processed twice.
    const bareLabel = bareLabelKind(line);

    if (bareLabel !== null) {
      const valueIndex = nextContentLine(lines, index);

      if (valueIndex !== null) {
        output.push(line);

        if (bareLabel === 'address') {
          output.push(PLACEHOLDER.address);
          addressCount += 1;
          // An address runs on; a name or a clinician does not.
          index = consumeAddressBlock(lines, valueIndex);
        } else {
          output.push(PLACEHOLDER.personName);
          nameCount += 1;
          index = valueIndex;
        }

        continue;
      }
    }

    output.push(line);
  }

  return { lines: output, addressCount, nameCount };
};
