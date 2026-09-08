import { apiClient } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/errors';
import type { GrantRole } from '@/types/access';
import type { MedicalDocument, ParentProfile } from '@/types/domain';

/**
 * Reading the shared record back.
 *
 * The outbox pushes; this pulls. Both are needed and they fail differently: a
 * push that fails leaves work on the phone, while a pull that fails leaves the
 * phone showing something *older* than the truth — which is why the last-sync
 * time is displayed on every screen that shows a record.
 *
 * ## Records that have gone
 *
 * The list of patients is authoritative. A record the server no longer returns
 * is one this account can no longer reach — revoked, or deleted — and the
 * cached copy is removed rather than left visible. That is the only way
 * revocation reaches a device that already has the data, and it is exactly as
 * strong as "the next time this phone is online", which the UI says.
 */

export interface RemotePatient {
  readonly patientId: string;
  readonly fullName: string;
  readonly relationship: string;
  readonly dateOfBirth?: string | undefined;
  readonly city?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PulledRecords {
  readonly patients: { patient: RemotePatient; role: GrantRole }[];
  readonly documentsByPatient: Record<string, MedicalDocument[]>;
  /** Patients that were cached and are no longer reachable. */
  readonly removedPatientIds: string[];
}

interface RemoteDocument {
  readonly documentId: string;
  readonly parentId: string;
  readonly title: string;
  readonly category: string;
  readonly documentDate: string;
  readonly pageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Maps a server document onto the shape the app already uses.
 *
 * `pages` comes back empty rather than invented: the server holds page *count*
 * and object keys, not the local URIs the capture flow produced. A document
 * pulled from the server is one to read, and its originals are fetched through
 * the short-lived page URLs when somebody actually looks.
 */
const toDocument = (remote: RemoteDocument): MedicalDocument => ({
  id: remote.documentId,
  parentId: remote.parentId,
  title: remote.title,
  category: remote.category as MedicalDocument['category'],
  documentDate: remote.documentDate,
  pages: [],
  status: 'ready',
  uploadProgress: 100,
  summaryId: null,
  failureReason: null,
  createdAt: remote.createdAt,
  updatedAt: remote.updatedAt,
});

/** Maps a server patient onto the local profile shape. */
export const toParentProfile = (
  remote: RemotePatient,
  existing: ParentProfile | undefined,
): ParentProfile => ({
  // Anything the server does not hold is kept from the local copy rather than
  // blanked: conditions, allergies and the doctor's name are still only local
  // until their own endpoints exist, and losing them on every sync would be a
  // spectacular way to destroy what the user typed.
  ...(existing ?? {
    id: remote.patientId,
    bloodGroup: 'unknown' as const,
    phone: '',
    conditions: [],
    allergies: [],
    primaryDoctor: '',
    notes: '',
    avatarColor: '#145B48',
  }),
  id: remote.patientId,
  fullName: remote.fullName,
  relationship: remote.relationship as ParentProfile['relationship'],
  dateOfBirth: remote.dateOfBirth ?? existing?.dateOfBirth ?? null,
  city: remote.city ?? existing?.city ?? '',
  createdAt: remote.createdAt,
  updatedAt: remote.updatedAt,
});

/**
 * Fetches everything this account can currently reach.
 *
 * `cachedPatientIds` is what the device already has, so the caller can be told
 * which of them have gone. Passing it in rather than reading a store keeps this
 * function pure enough to test against a fake server.
 */
export const pullRecords = async (cachedPatientIds: string[]): Promise<PulledRecords> => {
  const { patients } = await apiClient.get<{
    patients: { patient: RemotePatient; role: GrantRole }[];
  }>(endpoints.patients.list());

  const reachable = new Set(patients.map((entry) => entry.patient.patientId));
  const documentsByPatient: Record<string, MedicalDocument[]> = {};

  for (const { patient } of patients) {
    try {
      const { documents } = await apiClient.get<{ documents: RemoteDocument[] }>(
        endpoints.documents.listForPatient(patient.patientId),
      );
      documentsByPatient[patient.patientId] = documents.map(toDocument);
    } catch (error) {
      /**
       * One record failing does not fail the sync.
       *
       * A grant withdrawn between the list call and this one is a 404, and the
       * right response is to carry on with the others — the patient list on the
       * next pull will drop it. Throwing here would mean one revoked record
       * stopped the whole family from updating.
       */
      if (error instanceof ApiError && (error.kind === 'not_found' || error.kind === 'forbidden')) {
        reachable.delete(patient.patientId);
        continue;
      }
      throw error;
    }
  }

  return {
    patients: patients.filter((entry) => reachable.has(entry.patient.patientId)),
    documentsByPatient,
    removedPatientIds: cachedPatientIds.filter((id) => !reachable.has(id)),
  };
};
