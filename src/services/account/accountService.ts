import { apiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { authService } from '../auth/authService';
import { persistence } from '../storage/persistence';
import { secureStorage } from '../storage/secureStorage';

import { isBackendEnabled } from '@/config/env';
import { nowIso } from '@/utils/date';

/**
 * Account and data lifecycle.
 *
 * India's DPDP Act (and GDPR for caregivers living in the EU) gives the user a
 * right to erasure and a right to a copy of their data. Both are modelled as
 * asynchronous jobs because deleting a family's records touches DynamoDB, S3,
 * and any in-flight SQS message.
 *
 * TODO(backend): implement as a Step Functions workflow triggered by
 * `POST /v1/account/deletion-request`:
 *   1. Mark the account `pending_deletion` (blocks all reads immediately).
 *   2. Delete the S3 prefix `users/<sub>/` (versioned bucket → delete markers
 *      plus a lifecycle rule to purge noncurrent versions).
 *   3. Delete every DynamoDB item under `PK=USER#<sub>`.
 *   4. Purge any queued SQS jobs for those documents.
 *   5. `AdminDeleteUser` on the Cognito pool.
 *   6. Email confirmation, then write an audit record with no PHI in it.
 */

export interface DeletionRequest {
  requestId: string;
  requestedAt: string;
  /** Grace window during which the user can still cancel. */
  scheduledFor: string;
  status: 'pending' | 'processing' | 'completed';
}

export interface ExportRequest {
  requestId: string;
  requestedAt: string;
  status: 'pending' | 'ready';
  /** Presigned S3 GET, short-lived, available once `ready`. */
  downloadUrl: string | null;
}

/** Days between requesting deletion and the data actually being erased. */
export const DELETION_GRACE_DAYS = 7;

export const accountService = {
  /**
   * Deletes a single document everywhere it exists.
   *
   * TODO(backend): the Lambda must delete the S3 objects for every page *and*
   * the summary item, not just the document item — an orphaned summary still
   * contains clinical text.
   */
  async deleteDocument(documentId: string): Promise<void> {
    if (isBackendEnabled()) {
      await apiClient.delete(endpoints.documents.remove(documentId));
      return;
    }
    // Local-only mode: the store owns removal; nothing to call.
  },

  async requestAccountDeletion(): Promise<DeletionRequest> {
    if (isBackendEnabled()) {
      return apiClient.post<DeletionRequest>(endpoints.account.requestDeletion(), {});
    }

    const requestedAt = nowIso();
    return {
      requestId: `del_${Date.now().toString(36)}`,
      requestedAt,
      scheduledFor: new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      status: 'pending',
    };
  },

  async requestDataExport(): Promise<ExportRequest> {
    if (isBackendEnabled()) {
      return apiClient.post<ExportRequest>(endpoints.account.requestExport(), {});
    }
    return {
      requestId: `exp_${Date.now().toString(36)}`,
      requestedAt: nowIso(),
      status: 'pending',
      downloadUrl: null,
    };
  },

  /**
   * Wipes everything this app holds on the device: cached records, tokens and
   * the PIN verifier. Runs regardless of whether the server call succeeded, so
   * a user on a plane can still clear a borrowed phone.
   */
  async wipeLocalData(): Promise<void> {
    await Promise.all([persistence.clearAll(), secureStorage.clearAll()]);
  },

  async signOutEverywhere(): Promise<void> {
    await authService.signOut();
    await persistence.clearAll();
  },
};
