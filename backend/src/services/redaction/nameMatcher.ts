/**
 * Known-value name matching — ADR-002 § "Layer 1".
 *
 * The patient's name is the single strongest redaction signal available,
 * because the app already knows it. Everything here is built from that known
 * value rather than from guessing which words in a document look like names.
 *
 * The ADR's warning is taken seriously: *"The system must avoid aggressive
 * fuzzy matching that could remove clinical terms."* So there is no edit-
 * distance matching and no bare two-letter initial rule — `LI` is not treated
 * as "L. Iyer", because it is also a perfectly good abbreviation. Initials are
 * only matched in punctuated forms next to a surname.
 */

/** Titles stripped from a supplied name, and consumed when matching. */
const TITLES = ['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'sri', 'master', 'baby'];

const TITLE_PREFIX = new RegExp(`^(?:${TITLES.join('|')})\\.?\\s+`, 'i');

/** Escapes a literal for use inside a regular expression. */
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Any run of whitespace, so a name broken across a line or double-spaced by OCR
 * still matches.
 */
const FLEXIBLE_SPACE = '[\\s]+';

const stripTitle = (name: string): string => name.replace(TITLE_PREFIX, '').trim();

/** Name parts worth matching on their own. */
const significantTokens = (name: string): string[] =>
  stripTitle(name)
    .split(/[\s,]+/)
    .map((token) => token.replace(/[.]/g, '').trim())
    // Two-character tokens are dropped: too many collide with units and
    // abbreviations on a lab report.
    .filter((token) => token.length >= 3);

/**
 * Builds the set of strings to look for, longest first.
 *
 * Longest-first matters: matching "Lakshmi Iyer" before "Iyer" means the full
 * name becomes one placeholder rather than two adjacent ones, which reads
 * better to the model and keeps the counts honest.
 */
export const buildNameVariants = (fullName: string, aliases: string[] = []): string[] => {
  const variants = new Set<string>();
  const sources = [fullName, ...aliases].map(stripTitle).filter((name) => name.length > 0);

  for (const source of sources) {
    variants.add(source);

    const tokens = significantTokens(source);

    // "Iyer Lakshmi" and "Iyer, Lakshmi" — Indian records frequently invert.
    if (tokens.length >= 2) {
      const reversed = [...tokens].reverse();
      variants.add(reversed.join(' '));
      variants.add(`${tokens[tokens.length - 1]}, ${tokens.slice(0, -1).join(' ')}`);

      // "L. Iyer" / "L Iyer": an initial only counts when it sits beside a
      // surname we already know.
      const first = tokens[0];
      const last = tokens[tokens.length - 1];
      if (first !== undefined && last !== undefined) {
        variants.add(`${first[0]}. ${last}`);
        variants.add(`${first[0]} ${last}`);
      }
    }

    for (const token of tokens) {
      variants.add(token);
    }
  }

  return [...variants].sort((a, b) => b.length - a.length);
};

/** Turns a variant into a whitespace- and case-tolerant regular expression. */
const variantToRegExp = (variant: string): RegExp => {
  const body = variant
    .split(/\s+/)
    .map((part) => escape(part))
    .join(FLEXIBLE_SPACE);

  // A title immediately before the name is consumed with it, so "Mrs Lakshmi
  // Iyer" does not leave a dangling "Mrs".
  return new RegExp(`(?:\\b(?:${TITLES.join('|')})\\.?\\s+)?\\b${body}\\b`, 'gi');
};

export interface NameRedactionResult {
  text: string;
  count: number;
}

/**
 * Replaces every known name variant with the placeholder.
 *
 * Case-insensitive, whitespace-tolerant, and applied longest-variant-first.
 */
export const redactKnownNames = (
  text: string,
  variants: string[],
  placeholder: string,
): NameRedactionResult => {
  let output = text;
  let count = 0;

  for (const variant of variants) {
    if (variant.length < 3) {
      continue;
    }

    output = output.replace(variantToRegExp(variant), () => {
      count += 1;
      return placeholder;
    });
  }

  return { text: output, count };
};
