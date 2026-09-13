import { apiClient } from '../api/client';
import { endpoints } from '../api/endpoints';
import { authService } from '../auth/authService';
import { persistence } from '../storage/persistence';
import { secureStorage } from '../storage/secureStorage';

import { ApiError } from '../api/errors';

import { isBackendEnabled } from '@/config/env';
import { nowIso } from '@/utils/date';

/**
 * Account and data lifecycle.
 *
 * India's DPDP Act, and GDPR for caregivers living in the EU, give a person the
 * right to a copy of their data and the right to have it erased. Both are
 * implemented per *record* rather than per account, because a record is a
 * person and an account is only a way in — see `routes/v1/privacyRights.ts`.
 *
 * The practical consequences, and each is a deliberate answer rather than a
 * simplification:
 *
 * - **An export contains what this account can read, and says under which
 *   role.** A viewer's export is a viewer's view.
 * - **Only the record's subject can delete it.** A manager runs a record; they
 *   do not own the person it describes.
 * - **Deleting an account is not deleting records.** It removes this account's
 *   access, and refuses when that would leave a record with nobody who can
 *   reach it — naming those records so they can be handed over first.
 * - **The sign-in belongs to the identity provider.** This service removes
 *   access; deleting the login itself is a separate step, and nothing here
 *   claims otherwise.
 */

export type AccountDeletionResult =
  | { readonly outcome: 'access_removed'; readonly requestedAt: string; readonly grantsRevoked: number }
  /**
   * Refused, and why. These records would be left with nobody who can reach
   * them, so the person is asked to hand them over or delete them first.
   */
  | { readonly outcome: 'records_would_be_stranded'; readonly patientIds: string[] }
  /** A build with no server. Nothing was removed anywhere but this device. */
  | { readonly outcome: 'no_backend'; readonly requestedAt: string };

export interface ExportedRecord {
  readonly patientId: string;
  /** The access this record was exported under. Never widened. */
  readonly role: string;
  readonly record: unknown;
}

export type DataExport =
  | { readonly outcome: 'ready'; readonly exportedAt: string; readonly records: ExportedRecord[] }
  | { readonly outcome: 'no_backend'; readonly exportedAt: string; readonly records: [] };

/** One person's record, exported on its own. */
export type RecordExport =
  | {
      readonly outcome: 'ready';
      readonly exportedAt: string;
      /** The access it was produced under. A viewer's export is a viewer's view. */
      readonly exportedUnderRole: string;
      readonly record: unknown;
    }
  | { readonly outcome: 'no_backend'; readonly exportedAt: string };

export type RecordDeletionResult =
  | { readonly outcome: 'deleted'; readonly itemsRemoved: number; readonly pagesRemoved: number }
  /** No server in this build, so the record only ever existed on this device. */
  | { readonly outcome: 'local_only' };

/** The patient ids named in a stranded-records refusal, if the server named any. */
const strandedIdsFrom = (error: ApiError): string[] => {
  const ids = error.details?.patientIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
};

export const accountService = {
  /**
   * Deletes a single document everywhere it exists.
   *
   * TODO(backend): the Lambda must delete the S3 objects for every page *and*
   * the summary item, not just the document item — an orphaned summary still
   * contains clinical text.
   */
  async deleteDocument(parentId: string, documentId: string): Promise<void> {
    if (isBackendEnabled()) {
      await apiClient.delete(endpoints.documents.remove(parentId, documentId));
      return;
    }
    // Local-only mode: the store owns removal; nothing to call.
  },

  /**
   * Removes this account's access to every record it can reach.
   *
   * Refuses when that would strand a record — one where this account is the
   * only person left who can reach it, including the only one who could delete
   * it. The refusal names those records rather than making the choice for
   * somebody: deleting them unasked would destroy a medical history on the
   * strength of a different request.
   */
  async requestAccountDeletion(): Promise<AccountDeletionResult> {
    if (!isBackendEnabled()) {
      return {
        outcome: 'no_backend',
        requestedAt: nowIso(),
      };
    }

    try {
      const response = await apiClient.post<{ requestedAt: string; grantsRevoked: number }>(
        endpoints.account.requestDeletion(),
        {},
      );
      return { outcome: 'access_removed', ...response };
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'conflict') {
        return {
          outcome: 'records_would_be_stranded',
          patientIds: strandedIdsFrom(error),
        };
      }
      throw error;
    }
  },

  /**
   * A copy of everything this account can read, returned inline.
   *
   * Not a link to a generated file: an export sitting in an object store is a
   * second copy of somebody's medical history with a URL on it, waiting to be
   * found. Handing it back in the response means there is nothing extra to
   * protect, expire or forget.
   */
  async requestDataExport(): Promise<DataExport> {
    if (!isBackendEnabled()) {
      return { outcome: 'no_backend', exportedAt: nowIso(), records: [] };
    }

    const response = await apiClient.post<{
      exportedAt: string;
      records: ExportedRecord[];
    }>(endpoints.account.requestExport(), {});

    return { outcome: 'ready', ...response };
  },

  /**
   * A copy of **one** person's record.
   *
   * Separate from `requestDataExport`, and the difference is the point. An
   * account that helps with three parents holds three different people's
   * medical histories; a screen that offers "a copy of Amma's record" and calls
   * the account-wide endpoint hands over the other two as well. Each of those
   * records has its own answer about who may read it, so each is asked for by
   * name — and the response says which role it came out under.
   */
  async exportRecord(patientId: string): Promise<RecordExport> {
    if (!isBackendEnabled()) {
      return { outcome: 'no_backend', exportedAt: nowIso() };
    }

    const response = await apiClient.get<{
      exportedAt: string;
      exportedUnderRole: string;
      record: unknown;
    }>(endpoints.patients.export(patientId));

    return { outcome: 'ready', ...response };
  },

  /**
   * Deletes one record and everything in it.
   *
   * Takes the record's name, typed by the person deleting it, because this is
   * the one irreversible action in the app and a mis-tap on a confirm button is
   * the likeliest way somebody loses a parent's entire history.
   */
  async deleteRecord(patientId: string, confirmName: string): Promise<RecordDeletionResult> {
    if (!isBackendEnabled()) {
      return { outcome: 'local_only' };
    }

    const response = await apiClient.delete<{ itemsRemoved: number; pagesRemoved: number }>(
      endpoints.patients.remove(patientId),
      { body: { confirmName } },
    );

    return { outcome: 'deleted', ...response };
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
