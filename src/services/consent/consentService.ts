import { apiClient } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/errors';

/**
 * What this record's people have agreed to.
 *
 * The decisions live on the server, and deliberately not in a local store: the
 * worker reads them before sending anything to a provider, so a copy on the
 * phone would be a copy of the thing that matters rather than the thing itself.
 * A screen that cannot reach the server therefore cannot claim consent is in
 * place — see `unknown` below.
 */

export type ConsentPurpose = 'storage' | 'ai_processing' | 'family_sharing';

export interface ConsentState {
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  /** The wording has changed since they answered; ask again. */
  readonly needsReconsent: boolean;
  /** What withdrawing actually does, in the server's words. */
  readonly withdrawalEffect: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  /** True when a manager answered for somebody who has no account. */
  readonly onBehalfOfPatient: boolean;
}

export interface ConsentView {
  readonly noticeVersion: string;
  readonly consent: ConsentState[];
}

/**
 * What each purpose is, in the words shown next to the switch.
 *
 * Written here rather than on the server because it is interface copy, and it
 * has to be readable by somebody who has never heard the phrase "data
 * processing". The *version* of the notice comes from the server, so what a
 * person agreed to is always recoverable.
 */
export const CONSENT_COPY: Record<
  ConsentPurpose,
  { title: string; description: string; optional: boolean }
> = {
  storage: {
    title: 'Keep these records',
    description:
      'Store this person’s documents, summaries and notes so they are here next time. Without this there is nothing to keep.',
    optional: false,
  },
  ai_processing: {
    title: 'Read reports automatically',
    description:
      'Send the text of a report — with names, numbers and addresses removed first — to be turned into a plain-language summary. You can say no and still keep every record; you just read the originals yourself.',
    optional: true,
  },
  family_sharing: {
    title: 'Let family members help',
    description:
      'Allow other people you invite to see this record. Each person is invited separately and can be removed at any time.',
    optional: true,
  },
};

export interface ConsentDecision {
  readonly patientId: string;
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  /** The version the person was shown. Sent back so the record is provable. */
  readonly noticeVersion: string;
}

export const consentService = {
  async current(patientId: string): Promise<ConsentView> {
    return apiClient.get<ConsentView>(endpoints.consent.current(patientId));
  },

  /**
   * Records one decision.
   *
   * A `409` means the notice changed between the screen loading and the person
   * answering. That is not an error to swallow: the honest response is to show
   * the new wording and ask again, so it is surfaced as its own outcome rather
   * than a failure.
   */
  async decide(
    decision: ConsentDecision,
  ): Promise<{ outcome: 'recorded'; view: ConsentView } | { outcome: 'notice_changed' }> {
    try {
      const view = await apiClient.post<ConsentView>(
        endpoints.consent.current(decision.patientId),
        {
          purpose: decision.purpose,
          granted: decision.granted,
          noticeVersion: decision.noticeVersion,
        },
      );
      return { outcome: 'recorded', view };
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'conflict') {
        return { outcome: 'notice_changed' };
      }
      throw error;
    }
  },
};
