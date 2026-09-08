/**
 * The contract between this app and API Gateway.
 *
 * Every route is authenticated with a Cognito ID token; the backend verifies it
 * and turns the subject into the calling **account**.
 *
 * ## Why almost everything is under a patient
 *
 * Tenancy used to be the account: `PK = USER#<sub>`, and a document belonged to
 * whoever uploaded it. That cannot express a shared record, so it changed —
 * clinical items belong to a **patient**, and an account reaches one only by
 * holding a grant. See ADR-005.
 *
 * The practical consequence is that the patient id is in the path rather than
 * inferred from the document. That is deliberate: it means a handler cannot
 * reach a document without having named whose record it is, and the grant check
 * has already run by then.
 */
export const endpoints = {
  // --- Patients and access (DynamoDB: PK=PATIENT#<patientId>) ---------------
  patients: {
    /** Every record this account holds an active grant on. */
    list: () => '/v1/patients',
    create: () => '/v1/patients',
    get: (patientId: string) => `/v1/patients/${patientId}`,
  },

  access: {
    /** Who can reach this record, and on what terms. */
    grants: (patientId: string) => `/v1/patients/${patientId}/grants`,
    /** Withdraws one account's access. Takes effect on the next request. */
    revoke: (patientId: string, accountId: string) =>
      `/v1/patients/${patientId}/grants/${accountId}`,
    invitations: (patientId: string) => `/v1/patients/${patientId}/invitations`,
    /** Exchanges an invitation token for a grant. Requires an account. */
    acceptInvitation: () => '/v1/invitations/accept',
    roles: () => '/v1/grant-roles',
  },

  /**
   * What has been agreed for this record, per purpose.
   *
   * Under the patient, not the account, because that is what it is about: one
   * person can hold records for a parent who agreed to storage and declined
   * summarisation, and for another who agreed to both.
   */
  consent: {
    current: (patientId: string) => `/v1/patients/${patientId}/consent`,
    /** Every decision ever made, for the "who agreed to what, when" view. */
    history: (patientId: string) => `/v1/patients/${patientId}/consent/history`,
  },

  // --- Documents (DynamoDB: PK=PATIENT#<patientId>, SK=DOC#<documentId>) ----
  documents: {
    listForPatient: (patientId: string) => `/v1/patients/${patientId}/documents`,
    create: (patientId: string) => `/v1/patients/${patientId}/documents`,
    get: (patientId: string, documentId: string) =>
      `/v1/patients/${patientId}/documents/${documentId}`,
    remove: (patientId: string, documentId: string) =>
      `/v1/patients/${patientId}/documents/${documentId}`,
    /**
     * Returns a short-lived presigned PUT per page. The client never holds AWS
     * credentials; the backend signs with its own role and the object lands
     * under the patient's prefix.
     */
    presignUpload: (patientId: string, documentId: string) =>
      `/v1/patients/${patientId}/documents/${documentId}/uploads`,
    /** Verifies every page arrived, then enqueues the processing job. */
    completeUpload: (patientId: string, documentId: string) =>
      `/v1/patients/${patientId}/documents/${documentId}/uploads/complete`,
  },

  // --- Processing (SQS -> worker -> summary provider -> DynamoDB) -----------
  processing: {
    /** Poll target for the processing screen. */
    status: (patientId: string, documentId: string) =>
      `/v1/patients/${patientId}/documents/${documentId}/processing`,
  },

  // --- Summaries -----------------------------------------------------------
  summaries: {
    getForDocument: (patientId: string, documentId: string) =>
      `/v1/patients/${patientId}/documents/${documentId}/summary`,
  },

  // --- Account -------------------------------------------------------------
  // Account-level, and deliberately not under a patient: these are about the
  // person signing in, not about a record they can reach.
  account: {
    me: () => '/v1/account',
    privacy: () => '/v1/account/privacy',
    /** Kicks off the asynchronous erasure job. */
    requestDeletion: () => '/v1/account/deletion-request',
    /** Full data export, delivered as a presigned download. */
    requestExport: () => '/v1/account/export-request',
  },
} as const;
