import { describe, expect, it } from 'vitest';

import {
  CONSENT_PURPOSES,
  CURRENT_NOTICE_VERSION,
  describeWithdrawal,
  needsReconsent,
  permits,
  type ConsentRecord,
} from '../../src/services/consent/policy.js';

/**
 * What a person has agreed to.
 *
 * The assertion that matters most is that a missing answer is not permission.
 * Defaulting to allowed would mean a record created before consent was asked
 * for gets sent to a language model on the strength of a row that does not
 * exist.
 */

const record = (patch: Partial<ConsentRecord> = {}): ConsentRecord => ({
  patientId: 'pat_1',
  purpose: 'ai_processing',
  granted: true,
  decidedBy: 'acc_meera',
  decidedAt: '2026-09-01T00:00:00.000Z',
  noticeVersion: CURRENT_NOTICE_VERSION,
  onBehalfOfPatient: false,
  ...patch,
});

describe('permits', () => {
  /** The one that would be catastrophic to get backwards. */
  it('treats no answer as no, for every purpose', () => {
    for (const purpose of CONSENT_PURPOSES) {
      expect(permits([], purpose)).toBe(false);
    }
  });

  it('permits a purpose that was agreed to', () => {
    expect(permits([record()], 'ai_processing')).toBe(true);
  });

  it('does not let one purpose imply another', () => {
    const storageOnly = [record({ purpose: 'storage' })];

    expect(permits(storageOnly, 'storage')).toBe(true);
    expect(permits(storageOnly, 'ai_processing')).toBe(false);
    expect(permits(storageOnly, 'family_sharing')).toBe(false);
  });

  it('takes the most recent answer', () => {
    const history = [
      record({ granted: true, decidedAt: '2026-09-01T00:00:00.000Z' }),
      record({ granted: false, decidedAt: '2026-09-08T00:00:00.000Z' }),
    ];

    expect(permits(history, 'ai_processing')).toBe(false);
  });

  it('lets a withdrawn purpose be granted again', () => {
    const history = [
      record({ granted: true, decidedAt: '2026-09-01T00:00:00.000Z' }),
      record({ granted: false, decidedAt: '2026-09-05T00:00:00.000Z' }),
      record({ granted: true, decidedAt: '2026-09-08T00:00:00.000Z' }),
    ];

    expect(permits(history, 'ai_processing')).toBe(true);
  });

  /**
   * Withdrawing AI processing must not take storage with it. Somebody can keep
   * their records here and decline the summarising entirely.
   */
  it('leaves storage alone when AI processing is withdrawn', () => {
    const history = [
      record({ purpose: 'storage', granted: true }),
      record({ purpose: 'ai_processing', granted: false, decidedAt: '2026-09-08T00:00:00.000Z' }),
    ];

    expect(permits(history, 'storage')).toBe(true);
    expect(permits(history, 'ai_processing')).toBe(false);
  });
});

describe('needsReconsent', () => {
  it('asks when there is no answer at all', () => {
    expect(needsReconsent([], 'storage')).toBe(true);
  });

  it('does not ask when the current wording was answered', () => {
    expect(needsReconsent([record()], 'ai_processing')).toBe(false);
  });

  it('asks again when the notice has changed since', () => {
    expect(needsReconsent([record({ noticeVersion: '2020-01-01.1' })], 'ai_processing')).toBe(true);
  });

  /**
   * A stale consent still permits. Deleting somebody's records because a lawyer
   * edited a sentence would be a far worse outcome than a re-prompt.
   */
  it('still permits while it asks', () => {
    const stale = [record({ noticeVersion: '2020-01-01.1' })];

    expect(needsReconsent(stale, 'ai_processing')).toBe(true);
    expect(permits(stale, 'ai_processing')).toBe(true);
  });
});

describe('what withdrawal is described as doing', () => {
  /** None of these may claim that text already sent can be recalled. */
  it('never promises to recall what a provider already received', () => {
    expect(describeWithdrawal('ai_processing')).toMatch(/cannot be recalled/i);
  });

  it('says a downloaded copy stays on the other device', () => {
    expect(describeWithdrawal('family_sharing')).toMatch(/already downloaded/i);
  });

  it('is honest that backups expire on their own schedule', () => {
    expect(describeWithdrawal('storage')).toMatch(/backups expire/i);
  });

  it('describes every purpose', () => {
    for (const purpose of CONSENT_PURPOSES) {
      expect(describeWithdrawal(purpose).length).toBeGreaterThan(20);
    }
  });
});

describe('the record itself', () => {
  /**
   * "They consented" is not a fact on its own — they consented to *something*,
   * and if the wording changed, what they agreed to is not what the app does.
   */
  it('pins the wording that was actually shown', () => {
    expect(record().noticeVersion).toBe(CURRENT_NOTICE_VERSION);
  });

  /**
   * A caregiver agreeing on behalf of a parent who has never seen the notice is
   * a different thing from the parent agreeing, and a record that cannot tell
   * them apart cannot be reviewed later.
   */
  it('says when somebody answered for another person', () => {
    expect(record({ onBehalfOfPatient: true }).onBehalfOfPatient).toBe(true);
  });
});
