/**
 * What a person has agreed to, separately for each thing.
 *
 * ## Why these are not one switch
 *
 * "I agree to the terms" is not consent to send a photograph of a prescription
 * to a language model. Bundling them means somebody who wants the app to hold
 * their records — which it cannot do without permission — is also taken to have
 * agreed to the part they may well object to.
 *
 * So there are three, they are recorded independently, and the middle one can
 * be withdrawn without losing the others.
 *
 * ## What a medical disclaimer is not
 *
 * Accepting "this app does not give medical advice" is a safety notice, not
 * permission to process health data. The disclaimer is tracked elsewhere
 * (`PrivacySettings.disclaimerAcceptedAt`) and is deliberately not one of these.
 */

export type ConsentPurpose =
  /**
   * Holding the record at all: storing documents, summaries and notes.
   *
   * Without it there is no service. Withdrawing it is a deletion request, not a
   * setting, which is why the UI treats it that way.
   */
  | 'storage'
  /**
   * Sending redacted text to a summarisation provider.
   *
   * Optional, and separable. Someone can keep their records here and decline
   * this entirely; they lose summaries and keep everything else.
   */
  | 'ai_processing'
  /**
   * Letting named other accounts reach the record.
   *
   * Distinct from a grant. A grant is one person; this is the standing
   * agreement that sharing may happen at all.
   */
  | 'family_sharing';

export const CONSENT_PURPOSES: readonly ConsentPurpose[] = [
  'storage',
  'ai_processing',
  'family_sharing',
];

/**
 * The version of the notice a person actually read.
 *
 * Recorded because "they consented" is not a fact on its own — they consented
 * to *something*, and if that text changes, what they agreed to is no longer
 * what the app is doing. A record without the version cannot answer the only
 * question that matters when the wording is challenged.
 */
export const CURRENT_NOTICE_VERSION = '2026-09-08.1';

export interface ConsentRecord {
  readonly patientId: string;
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  /** The account that answered. May be a manager acting for the patient. */
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly noticeVersion: string;
  /**
   * True when a manager answered on behalf of somebody who has no account.
   *
   * Kept because it changes what the consent is worth. A caregiver agreeing to
   * AI processing for a parent who has never seen the notice is a different
   * thing from the parent agreeing, and a record that cannot tell them apart
   * cannot be reviewed later.
   */
  readonly onBehalfOfPatient: boolean;
}

/**
 * Whether a purpose is currently permitted.
 *
 * Absent means **not permitted**, for every purpose. Defaulting to allowed
 * would mean a record created before consent was asked for is processed by a
 * provider on the strength of a missing row.
 */
export const permits = (
  records: ConsentRecord[],
  purpose: ConsentPurpose,
): boolean => {
  const latest = records
    .filter((record) => record.purpose === purpose)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    .at(-1);

  return latest?.granted === true;
};

/**
 * Whether the person has seen the current wording.
 *
 * A stale consent still permits — withdrawing somebody's storage because a
 * lawyer edited a sentence would delete their records — but the UI is told to
 * ask again.
 */
export const needsReconsent = (records: ConsentRecord[], purpose: ConsentPurpose): boolean => {
  const latest = records
    .filter((record) => record.purpose === purpose)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    .at(-1);

  if (latest === undefined) return true;
  return latest.noticeVersion !== CURRENT_NOTICE_VERSION;
};

/**
 * What withdrawing a purpose actually does, in the words the screen uses.
 *
 * Beside the model so the promise and the mechanism cannot drift. Note what
 * none of them claims: that anything already sent to a provider can be recalled.
 */
export const describeWithdrawal = (purpose: ConsentPurpose): string => {
  switch (purpose) {
    case 'ai_processing':
      return (
        'New documents will be stored but not summarised. Summaries already made stay in the ' +
        'record until you delete them, and text already sent to the provider cannot be recalled.'
      );
    case 'family_sharing':
      return (
        'Nobody new can be given access, and everybody who has it now loses it. Anything they ' +
        'already downloaded stays on their device until it next connects.'
      );
    case 'storage':
    default:
      return (
        'This is a request to delete the record. Everything stored for this person is removed, ' +
        'including documents and summaries. Backups expire on their own schedule.'
      );
  }
};
