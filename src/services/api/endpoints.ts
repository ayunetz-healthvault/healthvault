/**
 * The contract between this app and API Gateway.
 *
 * Written down before the backend exists so the mock services and the eventual
 * Lambda handlers cannot drift. Every route below is authenticated with a
 * Cognito ID token via an API Gateway JWT authorizer; the caregiver's `sub`
 * becomes the DynamoDB partition key, which is what enforces tenancy.
 *
 * TODO(backend): mirror this file in the CDK/SAM stack as the route definitions.
 */
export const endpoints = {
  // --- Parents (DynamoDB: PK=USER#<sub>, SK=PARENT#<parentId>) -------------
  parents: {
    list: () => '/v1/parents',
    create: () => '/v1/parents',
    get: (parentId: string) => `/v1/parents/${parentId}`,
    update: (parentId: string) => `/v1/parents/${parentId}`,
    remove: (parentId: string) => `/v1/parents/${parentId}`,
  },

  // --- Documents (DynamoDB: PK=USER#<sub>, SK=DOC#<parentId>#<documentId>) --
  documents: {
    listForParent: (parentId: string) => `/v1/parents/${parentId}/documents`,
    create: () => '/v1/documents',
    get: (documentId: string) => `/v1/documents/${documentId}`,
    remove: (documentId: string) => `/v1/documents/${documentId}`,
    /**
     * Returns a short-lived S3 presigned PUT per page. The client never holds
     * AWS credentials; the Lambda signs with its execution role and the object
     * lands in the SSE-KMS encrypted bucket.
     */
    presignUpload: (documentId: string) => `/v1/documents/${documentId}/uploads`,
    /** Marks all pages uploaded; the Lambda then enqueues the SQS job. */
    completeUpload: (documentId: string) => `/v1/documents/${documentId}/uploads/complete`,
  },

  // --- Processing (SQS -> Lambda worker -> Bedrock/OpenAI -> DynamoDB) ------
  processing: {
    /** Poll target for the processing screen. */
    status: (documentId: string) => `/v1/documents/${documentId}/processing`,
    retry: (documentId: string) => `/v1/documents/${documentId}/processing/retry`,
  },

  // --- Summaries -----------------------------------------------------------
  summaries: {
    getForDocument: (documentId: string) => `/v1/documents/${documentId}/summary`,
  },

  // --- Follow-ups ----------------------------------------------------------
  followUps: {
    list: () => '/v1/follow-ups',
    create: () => '/v1/follow-ups',
    get: (followUpId: string) => `/v1/follow-ups/${followUpId}`,
    update: (followUpId: string) => `/v1/follow-ups/${followUpId}`,
    remove: (followUpId: string) => `/v1/follow-ups/${followUpId}`,
  },

  // --- Account -------------------------------------------------------------
  account: {
    me: () => '/v1/account',
    privacy: () => '/v1/account/privacy',
    /** Kicks off the asynchronous GDPR/DPDP-style erasure job. */
    requestDeletion: () => '/v1/account/deletion-request',
    /** Full data export, delivered as a presigned S3 download. */
    requestExport: () => '/v1/account/export-request',
  },
} as const;
