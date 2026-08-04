import { ProcessingError } from '../../types/processing.js';
import { checkForLeakage } from '../redaction/leakageCheck.js';

import type { StructuredSummary } from '../../schemas/summary.js';
import type { PatientRedactionProfile } from '../../types/processing.js';

/**
 * Checks a summary against the text it was supposedly read from.
 *
 * The schema proves the summary is the right *shape*. This proves it has some
 * connection to the document. Those are different failures: a model can return
 * perfectly-formed JSON describing a test that was never performed.
 *
 * ## Two kinds of problem, two responses
 *
 * **Structural violations fail the document.** A citation to page 7 of a
 * four-page report, or a finding with no source at all, means the model ignored
 * the contract. There is no safe way to show that output, so it becomes
 * `validation_failed` and the document does not go `ready`.
 *
 * **Unverifiable values are dropped, not fatal.** If a finding's number cannot
 * be found on the page it cites, that one finding is removed and an uncertainty
 * is recorded in its place. Failing the whole document over a single number
 * would mean a four-page discharge summary with one hallucinated value shows
 * the family nothing at all — when the other nine values were fine and the
 * original scan is right there. Dropping it is the honest middle: we never show
 * a number we could not find, and we say that something was removed.
 */

export interface SourceValidationOptions {
  pages: { page: number; text: string }[];
  patient: PatientRedactionProfile;
}

export interface SourceValidationResult {
  summary: StructuredSummary;
  /** Counts only, for logging and for the processing metadata. */
  droppedFindings: number;
  droppedMedicines: number;
  strippedSnippets: number;
}

/** Digit runs, which are what has to be traceable. `8.1` and `142` both count. */
const numericTokens = (value: string): string[] => value.match(/\d+(?:\.\d+)?/g) ?? [];

/** Comparison form: case-folded, with spaces removed so OCR spacing cannot matter. */
const comparable = (value: string): string => value.toLowerCase().replace(/\s+/g, '');

export class SourceConsistencyValidator {
  /**
   * @throws ProcessingError `validation_failed` on a structural violation.
   */
  validate(summary: StructuredSummary, options: SourceValidationOptions): SourceValidationResult {
    const { pages, patient } = options;
    const pageNumbers = new Set(pages.map((page) => page.page));
    const textByPage = new Map(pages.map((page) => [page.page, comparable(page.text)]));

    this.assertStructurallySound(summary, pageNumbers);

    const uncertainties = [...summary.uncertainties];
    let droppedFindings = 0;
    let droppedMedicines = 0;

    const findings = summary.findings.filter((finding) => {
      const tokens = numericTokens(finding.value);

      // A non-numeric finding ("Well seated, no loosening") has nothing to match
      // on. The page citation is its traceability; that has already been checked.
      if (tokens.length === 0) {
        return true;
      }

      const found = finding.sources.some((source) => {
        const text = textByPage.get(source.page) ?? '';
        return tokens.every((token) => text.includes(token));
      });

      if (!found) {
        droppedFindings += 1;
        uncertainties.push({
          message: `A reported result could not be found on the page it cites, so it has been left out. Check the original document.`,
          sourcePage: finding.sources[0]?.page ?? null,
        });
      }

      return found;
    });

    const medicines = summary.medicines.filter((medicine) => {
      const name = comparable(medicine.name);

      const found = medicine.sources.some((source) =>
        (textByPage.get(source.page) ?? '').includes(name),
      );

      if (!found) {
        droppedMedicines += 1;
        uncertainties.push({
          message: `A medicine named in the summary could not be found on the page it cites, so it has been left out. Check the original document.`,
          sourcePage: medicine.sources[0]?.page ?? null,
        });
      }

      return found;
    });

    const { summary: withSafeSnippets, strippedSnippets } = this.stripUnsafeSnippets(
      { ...summary, findings, medicines, uncertainties },
      patient,
    );

    return {
      summary: withSafeSnippets,
      droppedFindings,
      droppedMedicines,
      strippedSnippets,
    };
  }

  /**
   * Violations that mean the output cannot be trusted at all.
   *
   * Note what is *not* reported back: the offending label or value. A
   * validation error travels to the client, and the model's text is the
   * document's contents.
   */
  private assertStructurallySound(summary: StructuredSummary, pageNumbers: Set<number>): void {
    const problems: string[] = [];

    const checkPage = (page: number, where: string): void => {
      if (!pageNumbers.has(page)) {
        problems.push(`${where}.page_out_of_range`);
      }
    };

    summary.findings.forEach((finding) => {
      if (finding.sources.length === 0) {
        problems.push('findings.missing_source');
      }
      finding.sources.forEach((source) => checkPage(source.page, 'findings'));
    });

    summary.medicines.forEach((medicine) => {
      if (medicine.sources.length === 0) {
        problems.push('medicines.missing_source');
      }
      medicine.sources.forEach((source) => checkPage(source.page, 'medicines'));
    });

    summary.explicitFollowUps.forEach((followUp) => {
      checkPage(followUp.source.page, 'explicitFollowUps');
    });

    summary.uncertainties.forEach((uncertainty) => {
      if (uncertainty.sourcePage !== null) {
        checkPage(uncertainty.sourcePage, 'uncertainties');
      }
    });

    if (problems.length > 0) {
      throw new ProcessingError(
        'validation_failed',
        'The summary could not be matched to the document.',
        { retryable: false, details: { problems: [...new Set(problems)].sort() } },
      );
    }
  }

  /**
   * Runs every snippet back through the leakage gate.
   *
   * ADR-002 requires it, and the reason is specific: a snippet is the one part
   * of the output copied verbatim from text, so it is the one place a model can
   * reintroduce something the redactor removed — by reconstructing it, or by
   * quoting a region the redactor missed. An offending snippet is stripped
   * rather than failing the document; the page reference survives, and that is
   * what the family actually needs to check the original.
   */
  private stripUnsafeSnippets(
    summary: StructuredSummary,
    patient: PatientRedactionProfile,
  ): { summary: StructuredSummary; strippedSnippets: number } {
    let strippedSnippets = 0;

    const cleanSource = <T extends { page: number; textSnippet?: string | undefined }>(
      source: T,
    ): T => {
      if (source.textSnippet === undefined) {
        return source;
      }

      const result = checkForLeakage([{ page: source.page, text: source.textSnippet }], patient);

      if (result.safe) {
        return source;
      }

      strippedSnippets += 1;
      const rest = { ...source };
      delete rest.textSnippet;
      return rest;
    };

    return {
      summary: {
        ...summary,
        findings: summary.findings.map((finding) => ({
          ...finding,
          sources: finding.sources.map(cleanSource),
        })),
        medicines: summary.medicines.map((medicine) => ({
          ...medicine,
          sources: medicine.sources.map(cleanSource),
        })),
        explicitFollowUps: summary.explicitFollowUps.map((followUp) => ({
          ...followUp,
          source: cleanSource(followUp.source),
        })),
      },
      strippedSnippets,
    };
  }
}
