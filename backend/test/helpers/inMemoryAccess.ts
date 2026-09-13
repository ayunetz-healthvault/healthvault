import type {
  AcceptResult,
  AccessRepository,
  Invitation,
  IssuedInvitation,
} from '../../src/services/access/AccessRepository.js';
import type { Grant } from '../../src/services/access/policy.js';
import type { ConsentRecord } from '../../src/services/consent/policy.js';
import {
  AlreadyExistsError,
  RecordDeletedError,
  type AuditEntry,
  type DeletionMarker,
  type PatientRecord,
  type PatientRecordRepository,
} from '../../src/services/records/PatientRecordRepository.js';
import type {
  DocumentRecord,
  DoseEventRecord,
  FollowUpRecord,
  ObservationRecord,
  ProcessingRecord,
  SummaryRecord,
  TreatmentScheduleRecord,
} from '../../src/services/records/RecordRepository.js';

/**
 * In-memory stand-ins for the two repositories, so the authorisation matrix can
 * be exercised without DynamoDB.
 *
 * ## What these prove, and what they do not
 *
 * They prove the **routes**: which caller gets which status code, which role
 * may do what, that a revoked grant stops working, that an invitation is spent
 * once. Those are decisions made in `access.ts` and `policy.ts`, and a fake
 * store exercises them exactly as a real one would.
 *
 * They do **not** prove the storage semantics the real repository leans on —
 * the conditional writes that make "claim this invitation" and "revoke this
 * grant" atomic under a race. Those are DynamoDB's, and only an integration
 * test against DynamoDB can show them working. `test/integration/access.test.ts`
 * does that, and skips when the local stack is not running.
 *
 * The conditional behaviour is modelled here anyway, so a route that depends on
 * it fails in both places rather than passing here and breaking on AWS.
 */

export const inMemoryAccessRepository = (): AccessRepository => {
  const grants = new Map<string, Grant>();
  const invitations = new Map<string, Invitation>();
  let tokenCounter = 0;

  const key = (patientId: string, accountId: string): string => `${patientId}::${accountId}`;

  const putIfAbsent = (grant: Grant): Grant | null => {
    if (grants.has(key(grant.patientId, grant.accountId))) return null;
    grants.set(key(grant.patientId, grant.accountId), grant);
    return grant;
  };

  const listForPatient = (patientId: string): Grant[] =>
    [...grants.values()].filter((grant) => grant.patientId === patientId);

  return {
    async createSelfGrant(patientId, accountId) {
      if (listForPatient(patientId).some((grant) => grant.role === 'self')) return null;
      return putIfAbsent({
        patientId,
        accountId,
        role: 'self',
        status: 'active',
        grantedBy: accountId,
        grantedAt: new Date().toISOString(),
      });
    },

    async createManagerGrant(patientId, accountId) {
      return putIfAbsent({
        patientId,
        accountId,
        role: 'manager',
        status: 'active',
        grantedBy: accountId,
        grantedAt: new Date().toISOString(),
      });
    },

    async getGrant(patientId, accountId) {
      return grants.get(key(patientId, accountId)) ?? null;
    },

    async listGrantsForPatient(patientId) {
      return listForPatient(patientId);
    },

    async listGrantsForAccount(accountId) {
      return [...grants.values()].filter((grant) => grant.accountId === accountId);
    },

    async revokeGrant(patientId, accountId, revokedBy) {
      const existing = grants.get(key(patientId, accountId));
      // Models the conditional write: only an active grant can be revoked, so a
      // second revoke cannot rewrite who withdrew access and when.
      if (existing === undefined || existing.status !== 'active') return null;

      const revoked: Grant = {
        ...existing,
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy,
      };
      grants.set(key(patientId, accountId), revoked);
      return revoked;
    },

    async createInvitation({ patientId, role, invitedBy, ttlSeconds, inviteeHint }) {
      tokenCounter += 1;
      const token = `${patientId}.secret-${tokenCounter}`;
      const now = new Date();
      const invitation: Invitation = {
        patientId,
        role,
        invitedBy,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        status: 'pending',
        ...(inviteeHint === undefined ? {} : { inviteeHint }),
      };
      invitations.set(token, invitation);
      return { token, invitation } satisfies IssuedInvitation;
    },

    async listInvitationsForPatient(patientId) {
      return [...invitations.values()].filter((invitation) => invitation.patientId === patientId);
    },

    async acceptInvitation(token, accountId, now = new Date()): Promise<AcceptResult> {
      const invitation = invitations.get(token);
      if (
        invitation === undefined ||
        invitation.status !== 'pending' ||
        new Date(invitation.expiresAt).getTime() <= now.getTime()
      ) {
        return { outcome: 'rejected' };
      }

      const existing = grants.get(key(invitation.patientId, accountId));
      if (existing !== undefined && existing.status === 'active') {
        return { outcome: 'already_granted', grant: existing };
      }

      // Burn first, as the real one does.
      invitations.set(token, {
        ...invitation,
        status: 'accepted',
        acceptedBy: accountId,
        acceptedAt: now.toISOString(),
      });

      const grant: Grant = {
        patientId: invitation.patientId,
        accountId,
        role: invitation.role,
        status: 'active',
        grantedBy: invitation.invitedBy,
        grantedAt: now.toISOString(),
      };
      grants.set(key(grant.patientId, grant.accountId), grant);
      return { outcome: 'accepted', grant };
    },

    async revokeInvitation(patientId, token) {
      const invitation = invitations.get(token);
      if (
        invitation === undefined ||
        invitation.patientId !== patientId ||
        invitation.status !== 'pending'
      ) {
        return false;
      }
      invitations.set(token, { ...invitation, status: 'revoked' });
      return true;
    },
  };
};

export const inMemoryPatientRepository = (): PatientRecordRepository => {
  const patients = new Map<string, PatientRecord>();
  const documents = new Map<string, DocumentRecord>();
  const processing = new Map<string, ProcessingRecord>();
  const summaries = new Map<string, SummaryRecord>();
  const followUps = new Map<string, FollowUpRecord>();
  const consent: ConsentRecord[] = [];
  const audit: AuditEntry[] = [];
  const deletions = new Map<string, DeletionMarker>();
  const followUpClaims = new Map<string, { createdAt: string; deletedAt?: string }>();
  const observations = new Map<string, ObservationRecord>();
  const schedules = new Map<string, TreatmentScheduleRecord>();
  const doseEvents = new Map<string, DoseEventRecord>();

  /**
   * The condition the real repository attaches to every write.
   *
   * Modelled here rather than left to the integration tests, for the same
   * reason the conditional grant writes are: a route that depends on it must
   * fail in both places, not pass against the fake and break on AWS. A write
   * into a record that is being erased — or has been — is refused, and the
   * tombstone is what makes the second half of that sentence true.
   */
  const refuseIfDeleted = (patientId: string): void => {
    if (deletions.has(patientId)) throw new RecordDeletedError(patientId);
  };

  const key = (patientId: string, id: string): string => `${patientId}::${id}`;

  return {
    async putPatient(patient) {
      refuseIfDeleted(patient.patientId);
      patients.set(patient.patientId, patient);
    },
    async getPatient(patientId) {
      return patients.get(patientId) ?? null;
    },
    async deletePatient(patientId) {
      patients.delete(patientId);
    },

    async deleteEverythingFor(patientId) {
      const prefix = `${patientId}::`;
      let items = 0;

      for (const store of [
        documents,
        processing,
        summaries,
        followUps,
        followUpClaims,
        observations,
        schedules,
        doseEvents,
      ]) {
        for (const entryKey of [...store.keys()]) {
          if (entryKey.startsWith(prefix)) {
            store.delete(entryKey);
            items += 1;
          }
        }
      }

      if (patients.delete(patientId)) items += 1;

      const keptConsent = consent.filter((record) => record.patientId !== patientId);
      items += consent.length - keptConsent.length;
      consent.length = 0;
      consent.push(...keptConsent);

      const keptAudit = audit.filter((entry) => entry.patientId !== patientId);
      items += audit.length - keptAudit.length;
      audit.length = 0;
      audit.push(...keptAudit);

      return { items };
    },

    /**
     * The fence, modelled here because the routes depend on it.
     *
     * Kept out of `deleteEverythingFor` above for the same reason the real
     * repository keeps it: the marker outlives the sweep, and becomes the
     * tombstone that refuses writes for ever afterwards.
     */
    async beginDeletion(marker) {
      const existing = deletions.get(marker.patientId);
      if (existing !== undefined) return existing;

      const started: DeletionMarker = { ...marker, status: 'deleting' };
      deletions.set(marker.patientId, started);
      return started;
    },
    async getDeletion(patientId) {
      return deletions.get(patientId) ?? null;
    },
    async completeDeletion(patientId, completedAt) {
      const existing = deletions.get(patientId);
      if (existing === undefined) return;
      deletions.set(patientId, { ...existing, status: 'deleted', completedAt });
    },

    async putDocument(patientId, document) {
      refuseIfDeleted(patientId);
      documents.set(key(patientId, document.documentId), document);
    },
    async getDocument(patientId, documentId) {
      return documents.get(key(patientId, documentId)) ?? null;
    },
    async listDocuments(patientId) {
      return [...documents.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value);
    },
    async deleteDocument(patientId, documentId) {
      documents.delete(key(patientId, documentId));
    },

    async putProcessing(patientId, record) {
      refuseIfDeleted(patientId);
      processing.set(key(patientId, record.documentId), record);
    },
    async getProcessing(patientId, documentId) {
      return processing.get(key(patientId, documentId)) ?? null;
    },
    async listProcessing(patientId) {
      return [...processing.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value);
    },

    async putSummary(patientId, summary) {
      refuseIfDeleted(patientId);
      summaries.set(key(patientId, summary.documentId), summary);
    },
    async getSummary(patientId, documentId) {
      return summaries.get(key(patientId, documentId)) ?? null;
    },
    async listSummaryIds(patientId) {
      return [...summaries.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value.documentId);
    },

    /**
     * The claim, modelled because the route's idempotency now depends on it.
     *
     * A fake cannot show two concurrent creates racing, but it can show the
     * second one being refused — which is the behaviour the route is written
     * against, and the reason the loser no longer overwrites the winner.
     */
    async createFollowUp(patientId, followUp) {
      refuseIfDeleted(patientId);
      if (followUpClaims.has(key(patientId, followUp.followUpId))) {
        throw new AlreadyExistsError('follow_up', followUp.followUpId);
      }

      followUpClaims.set(key(patientId, followUp.followUpId), { createdAt: followUp.createdAt });
      followUps.set(key(patientId, followUp.followUpId), followUp);
    },

    async putFollowUp(patientId, followUp) {
      refuseIfDeleted(patientId);
      followUps.set(key(patientId, followUp.followUpId), followUp);
    },

    /**
     * Keyed by id here, so the move is a plain overwrite — the due date is only
     * part of the key in the real repository. What this fake does model is the
     * part the route depends on: moving a task leaves its claim alone, so a
     * delayed retry of the original create still finds the id taken rather than
     * free.
     */
    async moveFollowUp(patientId, _previousDueDate, followUp) {
      refuseIfDeleted(patientId);
      followUps.set(key(patientId, followUp.followUpId), followUp);
    },

    async followUpClaim(patientId, followUpId) {
      return followUpClaims.get(key(patientId, followUpId)) ?? null;
    },
    async listFollowUps(patientId) {
      return [...followUps.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value);
    },

    async getFollowUp(patientId, followUpId) {
      return followUps.get(key(patientId, followUpId)) ?? null;
    },
    /**
     * The due date is ignored here, and that is a real difference from the
     * DynamoDB implementation, where it is part of the sort key. Tests that
     * care about the key must exercise the real repository — see
     * `test/integration/recordRepository.test.ts`.
     */
    async deleteFollowUp(patientId, _dueDate, followUpId) {
      followUps.delete(key(patientId, followUpId));

      // The claim outlives the row, so a delayed duplicate of the original
      // create cannot put a deleted appointment back.
      const claim = followUpClaims.get(key(patientId, followUpId));
      if (claim !== undefined) {
        followUpClaims.set(key(patientId, followUpId), {
          ...claim,
          deletedAt: new Date().toISOString(),
        });
      }
    },

    async createObservation(patientId, observation) {
      refuseIfDeleted(patientId);
      if (observations.has(key(patientId, observation.observationId))) {
        throw new AlreadyExistsError('observation', observation.observationId);
      }
      observations.set(key(patientId, observation.observationId), observation);
    },
    async putObservation(patientId, observation) {
      refuseIfDeleted(patientId);
      observations.set(key(patientId, observation.observationId), observation);
    },
    async getObservation(patientId, observationId) {
      return observations.get(key(patientId, observationId)) ?? null;
    },
    async listObservations(patientId) {
      return [...observations.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value);
    },
    async deleteObservation(patientId, observationId) {
      observations.delete(key(patientId, observationId));
    },

    async createSchedule(patientId, schedule) {
      refuseIfDeleted(patientId);
      if (schedules.has(key(patientId, schedule.scheduleId))) {
        throw new AlreadyExistsError('treatment', schedule.scheduleId);
      }
      schedules.set(key(patientId, schedule.scheduleId), schedule);
    },
    async putSchedule(patientId, schedule) {
      refuseIfDeleted(patientId);
      schedules.set(key(patientId, schedule.scheduleId), schedule);
    },
    async getSchedule(patientId, scheduleId) {
      return schedules.get(key(patientId, scheduleId)) ?? null;
    },
    async listSchedules(patientId) {
      return [...schedules.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value);
    },

    /** Append-only here too: there is no update and no delete to model. */
    async appendDoseEvent(patientId, event) {
      refuseIfDeleted(patientId);
      if (doseEvents.has(key(patientId, event.eventId))) {
        throw new AlreadyExistsError('dose_event', event.eventId);
      }
      doseEvents.set(key(patientId, event.eventId), event);
    },
    async listDoseEvents(patientId) {
      return [...doseEvents.entries()]
        .filter(([entryKey]) => entryKey.startsWith(`${patientId}::`))
        .map(([, value]) => value);
    },

    async appendConsent(record) {
      refuseIfDeleted(record.patientId);
      // Append-only, exactly like the real one: the history is the point.
      consent.push(record);
    },
    async listConsent(patientId) {
      return consent
        .filter((record) => record.patientId === patientId)
        .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
    },

    async appendAudit(entry) {
      refuseIfDeleted(entry.patientId);
      audit.push(entry);
    },
    async listAudit(patientId, limit = 50) {
      return audit
        .filter((entry) => entry.patientId === patientId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit);
    },
  };
};
