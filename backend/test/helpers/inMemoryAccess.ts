import type {
  AcceptResult,
  AccessRepository,
  Invitation,
  IssuedInvitation,
} from '../../src/services/access/AccessRepository.js';
import type { Grant } from '../../src/services/access/policy.js';
import type { ConsentRecord } from '../../src/services/consent/policy.js';
import type {
  AuditEntry,
  DeletionMarker,
  PatientRecord,
  PatientRecordRepository,
} from '../../src/services/records/PatientRecordRepository.js';
import type {
  DocumentRecord,
  FollowUpRecord,
  ProcessingRecord,
  SummaryRecord,
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

  const key = (patientId: string, id: string): string => `${patientId}::${id}`;

  return {
    async putPatient(patient) {
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

      for (const store of [documents, processing, summaries, followUps]) {
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
     * repository keeps it: the marker outlives the sweep, and the caller takes
     * it down once the objects are gone too.
     */
    async beginDeletion(marker) {
      const existing = deletions.get(marker.patientId);
      if (existing !== undefined) return existing;
      deletions.set(marker.patientId, marker);
      return marker;
    },
    async getDeletion(patientId) {
      return deletions.get(patientId) ?? null;
    },
    async clearDeletion(patientId) {
      deletions.delete(patientId);
    },

    async putDocument(patientId, document) {
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

    async putFollowUp(patientId, followUp) {
      followUps.set(key(patientId, followUp.followUpId), followUp);
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
    },

    async appendConsent(record) {
      // Append-only, exactly like the real one: the history is the point.
      consent.push(record);
    },
    async listConsent(patientId) {
      return consent
        .filter((record) => record.patientId === patientId)
        .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
    },

    async appendAudit(entry) {
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
