import { apiClient } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/errors';
import { toDocumentSummary } from '@/services/processing/summaryMapper';
import type { ProcessDocumentResponse } from '@/services/processing/types';
import type { GrantRole } from '@/types/access';
import type {
  DocumentSummary,
  FollowUp,
  FollowUpKind,
  FollowUpStatus,
  MedicalDocument,
  ParentProfile,
} from '@/types/domain';
import type { Observation, ObservationImpact } from '@/types/observations';
import type { DoseEvent, DoseState, TreatmentSchedule } from '@/types/treatment';

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
  /**
   * Summaries fetched during this pull, keyed by the server's document id.
   *
   * Only the ones this device did not already hold. A document whose status
   * says `ready` is one somebody will tap expecting to read something, so the
   * content is fetched here rather than left to fail on the summary screen with
   * nothing to show and no explanation.
   */
  readonly summariesByDocumentId: Record<string, DocumentSummary>;
  /**
   * The shared task list, keyed by patient.
   *
   * Follow-ups are pulled and not merely pushed, because they are the one
   * record whose entire point is that somebody else acts on it. Sending them
   * and never fetching them meant a task created on one phone existed nowhere
   * else — the endpoint was there, and nothing ever called it.
   */
  readonly followUpsByPatient: Record<string, FollowUp[]>;
  /**
   * What daily care produced, keyed by patient.
   *
   * The three records a carer actually creates. Pulled for the same reason
   * follow-ups are: a note written by whoever was there is worth nothing to
   * the person who comes next if it stays on the first phone, and a dose
   * nobody else can see is how two people give the same tablet twice.
   */
  readonly observationsByPatient: Record<string, Observation[]>;
  readonly schedulesByPatient: Record<string, TreatmentSchedule[]>;
  readonly doseEventsByPatient: Record<string, DoseEvent[]>;
  /** Patients that were cached and are no longer reachable. */
  readonly removedPatientIds: string[];
}

export interface PullOptions {
  /**
   * Server document ids this device already has a summary for.
   *
   * Passed in rather than read from the store so this stays testable without
   * one, and so a caller can force a refetch by passing nothing.
   */
  readonly cachedSummaryDocumentIds?: readonly string[];
}

/**
 * The backend's processing vocabulary, mirrored.
 *
 * Not imported: the two packages do not share a dependency tree, and the
 * written API contract is what keeps them in step (see backend/README.md).
 */
type RemoteProcessingStatus =
  | 'awaiting_upload'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'manual_review';

interface RemoteDocument {
  readonly documentId: string;
  readonly parentId: string;
  readonly title: string;
  readonly category: string;
  readonly documentDate: string;
  readonly pageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Null when the pipeline has never written a state for this document. */
  readonly processing?: {
    readonly status: RemoteProcessingStatus;
    /** A code, never a message — see ADR-001. */
    readonly failureCode?: string | undefined;
  } | null;
  readonly hasSummary?: boolean;
}

interface RemoteFollowUp {
  readonly followUpId: string;
  readonly parentId: string;
  readonly title: string;
  readonly kind?: string | undefined;
  readonly dueDate: string;
  readonly dueTime?: string | null | undefined;
  readonly notes?: string | undefined;
  readonly status: string;
  readonly sourceDocumentId?: string | null | undefined;
  readonly doctorCategory?: string | null | undefined;
  readonly calendarEventId?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RemoteObservation {
  readonly observationId: string;
  readonly parentId: string;
  readonly text: string;
  readonly occurredAt: string;
  readonly impact: string;
  readonly recordedBy: string;
  readonly recordedBySelf: boolean;
  readonly recordedAt: string;
  readonly version: number;
  readonly updatedAt: string;
}

interface RemoteSchedule {
  readonly scheduleId: string;
  readonly parentId: string;
  readonly name: string;
  readonly dosage: string;
  readonly times: string[];
  readonly timezone: string;
  readonly startDate: string;
  readonly endDate?: string | null | undefined;
  readonly provenance: string;
  readonly sourceDocumentId?: string | null | undefined;
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly supersededAt?: string | null | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RemoteDoseEvent {
  readonly eventId: string;
  readonly parentId: string;
  readonly scheduleId: string;
  readonly occurrenceKey: string;
  readonly occurrenceAt: string;
  readonly state: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly recordedBySelf: boolean;
  readonly supersedesEventId?: string | null | undefined;
  readonly undo: boolean;
  readonly createdAt: string;
}

interface RemoteSummary {
  readonly documentId: string;
  /** The pipeline's output, unchanged — see `SummaryRecord` on the server. */
  readonly summary: unknown;
  readonly privacy?: unknown;
  readonly pipelineVersion: string;
  readonly createdAt: string;
}

/**
 * The backend's processing state, in the app's vocabulary.
 *
 * Every branch is written out rather than defaulted, because the default is
 * what caused the bug this replaces: every pulled document was mapped to
 * `ready`, so a queued or failed report looked finished on a second device.
 * Somebody would open it expecting a summary and find nothing — or, worse,
 * conclude there was nothing to find.
 */
const toAppStatus = (
  remote: RemoteProcessingStatus | null,
  hasSummary: boolean,
): MedicalDocument['status'] => {
  switch (remote) {
    /**
     * Another device is still adding pages. It is not *this* device's upload,
     * but "a document is on its way" is the truthful thing to show, and it is
     * the one state where the record is not yet complete on the server.
     */
    case 'awaiting_upload':
      return 'uploading';
    // Uploaded, waiting for a worker. The app's `uploaded` means exactly this.
    case 'queued':
      return 'uploaded';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    // Finished, and no summary is coming. The original is still readable.
    case 'manual_review':
      return 'needs_review';
    case 'ready':
      /**
       * `ready` with no summary row is a contradiction the server should not
       * produce — but a client that trusted it would open an empty summary
       * screen. Sending the reader to the original instead is the safe
       * reading of a state that should not exist.
       */
      return hasSummary ? 'ready' : 'needs_review';
    case null:
    default:
      /**
       * No processing record at all: the document exists and nothing has run.
       * `uploaded` says "it is here, nothing has happened yet", which is true
       * and claims nothing about a summary. An older server that does not send
       * the field lands here too, which is the right place for it — a client
       * talking to a server it does not fully understand should not be the one
       * announcing that a report is finished.
       */
      return 'uploaded';
  }
};

/**
 * Maps a server document onto the shape the app already uses.
 *
 * `pages` comes back empty rather than invented: the server holds page *count*
 * and object keys, not the local URIs the capture flow produced. A document
 * pulled from the server is one to read, and its originals are fetched through
 * the short-lived page URLs when somebody actually looks.
 *
 * Nothing else is invented either — which is what this replaces. The status
 * comes from the server's processing record, `summaryId` is set only when a
 * summary exists, and progress reads complete only when the upload is.
 */
const toDocument = (remote: RemoteDocument): MedicalDocument => {
  const hasSummary = remote.hasSummary ?? false;
  const status = toAppStatus(remote.processing?.status ?? null, hasSummary);

  return {
    id: remote.documentId,
    parentId: remote.parentId,
    title: remote.title,
    category: remote.category as MedicalDocument['category'],
    documentDate: remote.documentDate,
    pages: [],
    status,
    /**
     * Only a document past the upload stage is fully uploaded. Reporting 100%
     * for one another phone is still sending is the same lie in a smaller box
     * — and this device knows nothing about that upload's real progress, so
     * the honest number is the one it can defend.
     */
    uploadProgress: status === 'uploading' ? 0 : 100,
    /**
     * The document id, because summaries are keyed by document on the server.
     * Null when there is none: a client that always set an id would send a
     * screen looking for a summary that was never written.
     */
    summaryId: hasSummary ? remote.documentId : null,
    /**
     * The failure *code*, never a message. The server deliberately sends no
     * prose here, because a pipeline error can quote the text it was reading;
     * the screen turns the code into something a person can act on.
     */
    failureReason: remote.processing?.failureCode ?? null,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
  };
};

const IMPACTS: readonly ObservationImpact[] = ['a_little', 'moderately', 'a_lot'];

/**
 * A note from somebody else's phone.
 *
 * The text arrives unchanged, which is the whole point of it. An impact this
 * app does not recognise reads as `a_little` — the mildest of the three —
 * because the alternative is a screen rendering a value it has no label for,
 * and overstating how much somebody said a symptom affected them is the worse
 * way to be wrong.
 */
const toObservation = (remote: RemoteObservation): Observation => ({
  id: remote.observationId,
  patientId: remote.parentId,
  text: remote.text,
  occurredAt: remote.occurredAt,
  impact: IMPACTS.includes(remote.impact as ObservationImpact)
    ? (remote.impact as ObservationImpact)
    : 'a_little',
  recordedBy: remote.recordedBy,
  recordedBySelf: remote.recordedBySelf,
  recordedAt: remote.recordedAt,
  version: remote.version,
  updatedAt: remote.updatedAt,
});

/**
 * A medicine somebody confirmed, from wherever they confirmed it.
 *
 * `source` comes back as a document reference with page 1: the server keeps
 * the document id, not the page, and the page only ever decided where a
 * "check the original" link landed.
 */
const toSchedule = (remote: RemoteSchedule): TreatmentSchedule => ({
  id: remote.scheduleId,
  patientId: remote.parentId,
  name: remote.name,
  dosage: remote.dosage,
  times: [...remote.times].sort(),
  timezone: remote.timezone,
  startDate: remote.startDate,
  endDate: remote.endDate ?? null,
  provenance: remote.provenance === 'from_document' ? 'from_document' : 'manual',
  source: remote.sourceDocumentId ? { documentId: remote.sourceDocumentId, page: 1 } : null,
  confirmedBy: remote.confirmedBy,
  confirmedAt: remote.confirmedAt,
  supersededAt: remote.supersededAt ?? null,
  createdAt: remote.createdAt,
  updatedAt: remote.updatedAt,
});

/**
 * One dose event, exactly as the person who pressed the button left it.
 *
 * A state this app does not recognise is dropped by the caller rather than
 * guessed at: `taken` and `missed` are the only two answers anybody can give,
 * and inventing a third — or worse, reading an unknown one as `missed` —
 * would put a claim in the record that nobody made.
 */
const toDoseEvent = (remote: RemoteDoseEvent): DoseEvent | null => {
  if (remote.state !== 'taken' && remote.state !== 'missed') return null;

  return {
    id: remote.eventId,
    patientId: remote.parentId,
    scheduleId: remote.scheduleId,
    occurrenceKey: remote.occurrenceKey,
    occurrenceAt: remote.occurrenceAt,
    state: remote.state as DoseState,
    recordedAt: remote.recordedAt,
    recordedBy: remote.recordedBy,
    recordedBySelf: remote.recordedBySelf,
    supersedesEventId: remote.supersedesEventId ?? null,
    undo: remote.undo,
    createdAt: remote.createdAt,
  };
};

const FOLLOW_UP_KINDS: readonly FollowUpKind[] = [
  'doctor_visit',
  'lab_test',
  'medicine_refill',
  'vaccination',
  'physiotherapy',
  'other',
];

const FOLLOW_UP_STATUSES: readonly FollowUpStatus[] = [
  'scheduled',
  'completed',
  'missed',
  'cancelled',
];

/**
 * Maps a server follow-up onto the shape the screens already use.
 *
 * The two enums are checked rather than cast. A server that grew a new kind of
 * task would otherwise put a value the app has no label for straight into a
 * list somebody reads, and "other" is a truthful answer where an unrecognised
 * string is a rendering bug. The status falls back to `scheduled` for the same
 * reason and with more at stake: an unknown status must never be read as done.
 */
const toFollowUp = (remote: RemoteFollowUp): FollowUp => ({
  id: remote.followUpId,
  parentId: remote.parentId,
  title: remote.title,
  kind: FOLLOW_UP_KINDS.includes(remote.kind as FollowUpKind)
    ? (remote.kind as FollowUpKind)
    : 'other',
  dueDate: remote.dueDate,
  dueTime: remote.dueTime ?? null,
  notes: remote.notes ?? '',
  status: FOLLOW_UP_STATUSES.includes(remote.status as FollowUpStatus)
    ? (remote.status as FollowUpStatus)
    : 'scheduled',
  sourceDocumentId: remote.sourceDocumentId ?? null,
  doctorCategory: (remote.doctorCategory ?? null) as FollowUp['doctorCategory'],
  /**
   * Always null, whatever the server holds.
   *
   * A calendar event id names an event in one phone's calendar. Carrying
   * another device's id onto this one told the screen there was an event here
   * to remove, and handed that foreign id to this device's calendar API.
   * Whether *this* phone has an event for a task is a local question, answered
   * by `calendarMappings`.
   */
  calendarEventId: null,
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
export const pullRecords = async (
  cachedPatientIds: string[],
  options: PullOptions = {},
): Promise<PulledRecords> => {
  const { patients } = await apiClient.get<{
    patients: { patient: RemotePatient; role: GrantRole }[];
  }>(endpoints.patients.list());

  const alreadyHeld = new Set(options.cachedSummaryDocumentIds ?? []);
  const reachable = new Set(patients.map((entry) => entry.patient.patientId));
  const documentsByPatient: Record<string, MedicalDocument[]> = {};
  const summariesByDocumentId: Record<string, DocumentSummary> = {};
  const followUpsByPatient: Record<string, FollowUp[]> = {};
  const observationsByPatient: Record<string, Observation[]> = {};
  const schedulesByPatient: Record<string, TreatmentSchedule[]> = {};
  const doseEventsByPatient: Record<string, DoseEvent[]> = {};

  for (const { patient } of patients) {
    try {
      const { documents } = await apiClient.get<{ documents: RemoteDocument[] }>(
        endpoints.documents.listForPatient(patient.patientId),
      );
      const mapped = documents.map(toDocument);
      documentsByPatient[patient.patientId] = mapped;

      /**
       * Fetched in the same pass as the documents, and under the same
       * try/catch: a record whose grant was withdrawn between the list call and
       * this one drops out of the pull entirely rather than arriving with its
       * documents and no tasks.
       */
      const { followUps } = await apiClient.get<{ followUps?: RemoteFollowUp[] }>(
        endpoints.followUps.list(patient.patientId),
      );
      // An older server that does not send the field is read as "no tasks",
      // not as a crash mid-pull that would lose the documents fetched above.
      followUpsByPatient[patient.patientId] = (followUps ?? []).map(toFollowUp);

      /**
       * The daily-care records, in the same pass and the same try.
       *
       * Three more requests per patient, which is the honest cost of these
       * being shared at all: a note and a dose are what the second carer opens
       * the app to see.
       */
      const [notes, medicines, doses] = await Promise.all([
        apiClient.get<{ observations?: RemoteObservation[] }>(
          endpoints.observations.list(patient.patientId),
        ),
        apiClient.get<{ treatments?: RemoteSchedule[] }>(
          endpoints.treatments.list(patient.patientId),
        ),
        apiClient.get<{ doseEvents?: RemoteDoseEvent[] }>(
          endpoints.doseEvents.list(patient.patientId),
        ),
      ]);

      observationsByPatient[patient.patientId] = (notes.observations ?? []).map(toObservation);
      schedulesByPatient[patient.patientId] = (medicines.treatments ?? []).map(toSchedule);
      // A dose event whose state this app cannot read is dropped rather than
      // guessed at — see `toDoseEvent`.
      doseEventsByPatient[patient.patientId] = (doses.doseEvents ?? []).flatMap((event) => {
        const mapped = toDoseEvent(event);
        return mapped === null ? [] : [mapped];
      });

      for (const document of mapped) {
        if (document.status !== 'ready' || alreadyHeld.has(document.id)) continue;

        const summary = await pullSummary(patient.patientId, document);
        if (summary !== null) summariesByDocumentId[document.id] = summary;
      }
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
        /**
         * Nothing half-pulled is kept for a record that went away mid-pull.
         *
         * Its documents may already be in the map from the call that succeeded,
         * and leaving them there would apply a partial view of a record this
         * account can no longer reach.
         */
        delete documentsByPatient[patient.patientId];
        delete followUpsByPatient[patient.patientId];
        delete observationsByPatient[patient.patientId];
        delete schedulesByPatient[patient.patientId];
        delete doseEventsByPatient[patient.patientId];
        continue;
      }
      throw error;
    }
  }

  return {
    patients: patients.filter((entry) => reachable.has(entry.patient.patientId)),
    documentsByPatient,
    summariesByDocumentId,
    followUpsByPatient,
    observationsByPatient,
    schedulesByPatient,
    doseEventsByPatient,
    removedPatientIds: cachedPatientIds.filter((id) => !reachable.has(id)),
  };
};

/**
 * Fetches one document's summary, or returns null if there is nothing to show.
 *
 * A missing or malformed summary is not allowed to fail the pull. The document
 * still arrives, still says what state it is in, and the screen still offers
 * the original — which is more useful than a sync that stops on one bad row.
 * The `ready` status is not downgraded here: whether a summary *exists* is the
 * server's answer, and this device failing to read it is a different fact.
 */
const pullSummary = async (
  patientId: string,
  document: MedicalDocument,
): Promise<DocumentSummary | null> => {
  try {
    const { summary } = await apiClient.get<{ summary: RemoteSummary }>(
      endpoints.summaries.getForDocument(patientId, document.id),
    );

    /**
     * Reuses the mapper the upload path already validates through, rather than
     * a second, laxer reader. The stored record keeps the pipeline's output
     * unchanged, so it is the same shape that mapper was written for.
     */
    const response = {
      documentId: document.id,
      processingStatus: 'ready',
      summary: summary.summary,
      privacy: summary.privacy,
    } as ProcessDocumentResponse;

    return toDocumentSummary(response, document);
  } catch {
    return null;
  }
};
