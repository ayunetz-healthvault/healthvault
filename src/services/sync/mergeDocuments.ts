import type { MedicalDocument } from '@/types/domain';

/**
 * Putting what the server says next to what this phone already has.
 *
 * This is the half of reconciliation that decides *who is right*, and it is
 * separate from the fetching so the rules can be argued with in a test rather
 * than inferred from a network trace.
 *
 * Two things are true at once and the merge exists because of the tension:
 *
 * - **The server is authoritative about processing.** It ran the pipeline. A
 *   phone that has been offline for a day knows nothing about a summary
 *   written this morning, and must not overwrite it with a stale local guess.
 * - **The phone is authoritative about its own upload.** While bytes are
 *   leaving *this* device, the server's view is behind by definition — it
 *   still says `awaiting_upload` when page four of five is in flight. Taking
 *   the server's word there would stall the progress bar the user is watching.
 *
 * So: local wins while this device is mid-upload, the server wins afterwards.
 */

/** Statuses that mean "this device is still doing something about it". */
const LOCALLY_IN_FLIGHT: ReadonlySet<MedicalDocument['status']> = new Set([
  'draft',
  'uploading',
]);

/**
 * Identifies a local document that is the same record as a remote one.
 *
 * The match is on `remoteId` first, because that is what the server issued for
 * a document this device uploaded, and on `id` second, for a document that was
 * pulled in the first place (its id already is the server's).
 *
 * Getting this wrong is not a cosmetic bug: a missed match shows the family the
 * same report twice, one copy claiming to be ready and one still uploading.
 */
const remoteKeysOf = (document: MedicalDocument): string[] =>
  document.remoteId ? [document.remoteId, document.id] : [document.id];

export interface MergeInput {
  /** Every document currently on this device, across all patients. */
  readonly local: MedicalDocument[];
  /** What the server returned, keyed by patient. */
  readonly remoteByPatient: Record<string, MedicalDocument[]>;
  /** Patients this account can no longer reach. Their documents go with them. */
  readonly removedPatientIds: readonly string[];
}

/**
 * Merges a pull into the local document list.
 *
 * Returns a new list; nothing is mutated. Order is preserved for documents that
 * survive, with anything newly arrived appended — the screens sort by date, so
 * this only has to be stable, not clever.
 */
export const mergeDocuments = ({
  local,
  remoteByPatient,
  removedPatientIds,
}: MergeInput): MedicalDocument[] => {
  const removed = new Set(removedPatientIds);
  const pulledPatientIds = new Set(Object.keys(remoteByPatient));

  const remoteById = new Map<string, MedicalDocument>();
  for (const documents of Object.values(remoteByPatient)) {
    for (const document of documents) remoteById.set(document.id, document);
  }

  const matched = new Set<string>();
  const merged: MedicalDocument[] = [];

  for (const document of local) {
    // A revoked or deleted record takes its documents with it. This is the only
    // way withdrawing access reaches a phone that already holds the data.
    if (removed.has(document.parentId)) continue;

    const key = remoteKeysOf(document).find((candidate) => remoteById.has(candidate));
    const remote = key === undefined ? undefined : remoteById.get(key);

    if (remote === undefined) {
      /**
       * The server did not return it.
       *
       * For a patient that was not pulled at all — the request failed, or this
       * device is offline — that says nothing, so the document stays.
       *
       * For a patient that *was* pulled, an absent document has either been
       * deleted elsewhere or never left this phone. The difference is whether
       * the server ever knew about it, which is exactly what `remoteId` and an
       * in-flight status record. Keeping an unsent capture is the whole point
       * of capturing before uploading; keeping one the server has deleted would
       * quietly resurrect a record somebody removed.
       */
      const serverNeverKnew =
        !document.remoteId && LOCALLY_IN_FLIGHT.has(document.status);

      if (pulledPatientIds.has(document.parentId) && !serverNeverKnew) continue;

      merged.push(document);
      continue;
    }

    if (key !== undefined) matched.add(key);
    merged.push(mergeOne(document, remote));
  }

  // Anything the server returned that this device had never seen.
  for (const patientId of pulledPatientIds) {
    if (removed.has(patientId)) continue;
    for (const document of remoteByPatient[patientId] ?? []) {
      if (!matched.has(document.id)) merged.push(document);
    }
  }

  return merged;
};

/**
 * One document's worth of the same decision.
 *
 * Exported for tests, which is where the interesting cases live: the local copy
 * mid-upload, and the local copy that thinks it failed while the server has
 * since succeeded.
 */
export const mergeOne = (local: MedicalDocument, remote: MedicalDocument): MedicalDocument => {
  if (LOCALLY_IN_FLIGHT.has(local.status)) {
    /**
     * This device is still uploading. Keep its status, its progress and its
     * pages, but take the server's id and metadata — a rename made on another
     * phone is not in competition with an upload happening on this one.
     */
    return {
      ...local,
      remoteId: remote.id,
      title: remote.title,
      category: remote.category,
      documentDate: remote.documentDate,
      updatedAt: remote.updatedAt,
    };
  }

  return {
    ...remote,
    /**
     * The pages stay local. The server holds object keys, not the URIs on this
     * phone, so `remote.pages` is empty by construction — copying it over would
     * throw away the originals of a document this device captured, which are
     * the only thing anyone can check a summary against offline.
     */
    pages: local.pages.length > 0 ? local.pages : remote.pages,
    /** Keep the local identity so pages, sessions and summaries still resolve. */
    id: local.id,
    remoteId: remote.id === local.id ? (local.remoteId ?? null) : remote.id,
    /**
     * A review is a local fact about a person having looked, and no endpoint
     * carries it yet. It is kept rather than blanked; see KOO-08.
     */
    ...(local.reviewedAt === undefined ? {} : { reviewedAt: local.reviewedAt }),
    ...(local.reviewedBy === undefined ? {} : { reviewedBy: local.reviewedBy }),
    /**
     * The summary, if there is one, is stored under the *local* id, because
     * that is how `selectSummaryForDocument` finds it. `remote.summaryId` is
     * the server's document id — right about *whether* a summary exists, wrong
     * about where this device filed it.
     */
    summaryId: remote.summaryId === null ? null : (local.summaryId ?? remote.summaryId),
  };
};
