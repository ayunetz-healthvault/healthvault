/**
 * OCR text normalisation.
 *
 * Runs between OCR and redaction, and it exists for the redactor's benefit.
 * Tesseract renders a hyphen as any of several dash characters and a colon
 * sometimes as a full-width variant; a redaction pattern anchored on `:` or `-`
 * misses those, and a missed anchor is a missed identifier.
 *
 * Deliberately conservative. It does not reflow text, collapse runs of spaces,
 * or merge lines: column alignment and line breaks are structure that both the
 * redactor's labelled-region rules and the model's page reading depend on.
 */

/** Dash-like characters OCR produces where a document has a hyphen. */
const DASHES = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g;

/** Quote-like characters, folded so patterns can match plain ASCII. */
const SINGLE_QUOTES = /[\u2018\u2019\u201a\u201b\u2032\u00b4\u0060]/g;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033]/g;

/** Full-width and unusual separators seen on scanned Indian forms. */
const COLONS = /[\uff1a\u02d0]/g;

/** Non-breaking and exotic spaces, which break `\s`-free literal matches. */
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;

/** Zero-width characters, which silently split a name mid-word. */
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;

export const normalisePageText = (text: string): string =>
  text
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(ODD_SPACES, ' ')
    .replace(DASHES, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(COLONS, ':')
    // Three or more blank lines carry no structure, only noise.
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();

export const normalisePages = <T extends { page: number; text: string }>(
  pages: T[],
): { page: number; text: string }[] =>
  pages.map((page) => ({ page: page.page, text: normalisePageText(page.text) }));
