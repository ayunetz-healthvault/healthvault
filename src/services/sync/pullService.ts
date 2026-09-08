import { currentSyncService } from './pushService';
import { pullRecords, toParentProfile } from './reconcile';

import { isBackendEnabled } from '@/config/env';
import { useVaultStore } from '@/state/vaultStore';
import type { ParentProfile } from '@/types/domain';

/**
 * The one call a screen makes to refresh from the server.
 *
 * `reconcile` fetches and `vaultStore` applies; this is the seam between them,
 * and it exists so no screen has to know either. It is also where the two
 * honest failure answers are decided — because a refresh that silently does
 * nothing is indistinguishable from a refresh that found nothing changed, and
 * those mean very different things to somebody waiting on a report.
 */

export type PullOutcome =
  | { readonly outcome: 'applied'; readonly patients: number; readonly documents: number }
  /** No server in this build. Nothing was fetched and nothing was overwritten. */
  | { readonly outcome: 'no_backend' }
  /** Offline, or the server said no. The cached records are untouched. */
  | { readonly outcome: 'failed'; readonly error: unknown };

/** The follow-ups this device has changes queued for, or none if it cannot say. */
const pendingFollowUps = async (): Promise<string[]> => {
  const service = currentSyncService();
  if (service === null) return [];

  try {
    return (await service.outbox.all())
      .filter((mutation) => mutation.entity === 'follow_up')
      .map((mutation) => mutation.entityId);
  } catch {
    return [];
  }
};

export const pullIntoVault = async (): Promise<PullOutcome> => {
  if (!isBackendEnabled()) return { outcome: 'no_backend' };

  const before = useVaultStore.getState();

  try {
    const pulled = await pullRecords(
      before.parents.map((parent) => parent.id),
      {
        /**
         * Summaries already on this device are not fetched again. They are
         * immutable once written — a re-run produces a new version, which
         * arrives as a different document state — so refetching them would be
         * bytes spent to learn nothing.
         */
        cachedSummaryDocumentIds: before.summaries.map((summary) => summary.documentId),
      },
    );

    /**
     * What this device is still holding, asked of the outbox rather than
     * guessed.
     *
     * A follow-up with a queued change must survive the pull unchanged — the
     * queue has the only copy of what somebody just did, and applying the
     * server's row over it would silently undo a completed appointment while
     * its request was still waiting to be sent. An unreadable queue yields an
     * empty list, which means the pull is authoritative: that is the wrong way
     * round for exactly one refresh, and the alternative is refusing to sync.
     */
    const pendingFollowUpIds = await pendingFollowUps();

    const existingById = new Map(before.parents.map((parent) => [parent.id, parent]));
    const parents: ParentProfile[] = pulled.patients.map(({ patient }) =>
      toParentProfile(patient, existingById.get(patient.patientId)),
    );

    useVaultStore.getState().applyPulledRecords({
      parents,
      documentsByPatient: pulled.documentsByPatient,
      summaries: pulled.summariesByDocumentId,
      followUpsByPatient: pulled.followUpsByPatient,
      pendingFollowUpIds,
      removedPatientIds: pulled.removedPatientIds,
    });

    return {
      outcome: 'applied',
      patients: parents.length,
      documents: Object.values(pulled.documentsByPatient).reduce(
        (total, documents) => total + documents.length,
        0,
      ),
    };
  } catch (error) {
    /**
     * A failed pull leaves the vault exactly as it was.
     *
     * That is the right behaviour and it is also a trap: the screen now shows
     * data that may be a day old with nothing saying so. The caller is given
     * the error so it can say when the records were last confirmed, which is
     * the only honest thing to put on the screen.
     */
    return { outcome: 'failed', error };
  }
};
