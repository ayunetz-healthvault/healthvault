/**
 * Who may do what to a record.
 *
 * Pure, and deliberately so. Every authorisation decision in this service
 * reduces to `permits(role, action)`, which means the rules can be enumerated
 * in a test rather than inferred by reading route handlers — and a new route
 * cannot invent a permission that is not on this list.
 *
 * The vocabulary matters. A **patient** is the subject of a record. An
 * **account** is a person who signs in. They are not the same thing and the
 * previous schema conflated them: a parent existed only inside the caregiver's
 * partition, so "share my mother's record" had no expressible answer short of
 * handing over the caregiver's whole tenant.
 */

/**
 * What an account holds over one patient's record.
 *
 * Four, and no more, because every extra role is a combination somebody has to
 * reason about at 11pm.
 */
export type GrantRole =
  /**
   * The patient themselves. Only ever held by the account whose own record it
   * is, and it cannot be granted — a self grant is created by claiming a
   * record, never by somebody else's decision.
   */
  | 'self'
  /**
   * Legitimate management authority: the caregiver who created a record for a
   * parent who has no account of their own, or who was given full charge of it.
   *
   * Distinct from `self` on purpose. A manager can run the record day to day
   * and can invite helpers, but the record is not *about* them, and the
   * migration must never turn a manager into a self.
   */
  | 'manager'
  /** A helper who can add to the record but cannot change who reaches it. */
  | 'contributor'
  /** Can read. Cannot write anything, including their own observations. */
  | 'viewer';

/**
 * Everything an account can attempt against a record.
 *
 * Named for the user-visible act rather than the HTTP verb, so the table below
 * reads as a description of the product.
 */
export type Action =
  | 'read_record'
  | 'write_record'
  | 'upload_document'
  | 'delete_document'
  /** Confirm a treatment schedule, or record a dose against one. */
  | 'record_treatment'
  /** Create, complete or reassign a follow-up. */
  | 'manage_tasks'
  /** Add an observation, question or note. */
  | 'contribute_notes'
  /** See who else holds access. */
  | 'read_grants'
  /**
   * Answer, or withdraw, a consent question for this record.
   *
   * Separate from `manage_grants` because they are different powers. Sharing a
   * record with one more helper is not the same as agreeing, on somebody
   * else's behalf, that their prescriptions may be sent to a language model.
   */
  | 'manage_consent'
  /** Invite somebody, change their role, or revoke them. */
  | 'manage_grants'
  /** Hand the record to a different owner, or delete the record itself. */
  | 'transfer_or_delete_record';

/**
 * The whole authorisation model, as one table.
 *
 * Four properties are worth stating because each is a decision:
 *
 * 1. **Only `self` and `manager` may `manage_grants`.** A contributor cannot
 *    widen their own access or add another helper; that is the difference
 *    between sharing a record and losing control of it.
 * 2. **Only `self` may `transfer_or_delete_record`.** A manager runs the
 *    record; they do not get to delete the subject's medical history, and the
 *    caregiver who created a profile does not own the person it describes.
 * 3. **A `viewer` writes nothing at all**, including notes. "Read-only" that
 *    quietly permits appending is not read-only.
 * 4. **Only `self` and `manager` may `manage_consent`.** A contributor can add
 *    documents to a record; they cannot decide that the record's owner has
 *    agreed to have them read by a provider.
 */
const PERMISSIONS: Record<GrantRole, ReadonlySet<Action>> = {
  self: new Set<Action>([
    'read_record',
    'write_record',
    'upload_document',
    'delete_document',
    'record_treatment',
    'manage_tasks',
    'contribute_notes',
    'read_grants',
    'manage_grants',
    'manage_consent',
    'transfer_or_delete_record',
  ]),
  manager: new Set<Action>([
    'read_record',
    'write_record',
    'upload_document',
    'delete_document',
    'record_treatment',
    'manage_tasks',
    'contribute_notes',
    'read_grants',
    'manage_grants',
    /**
     * A manager may answer for the patient — that is what running a record for
     * a parent who does not use the app means. The answer is stored marked as
     * given on their behalf, so it can never later be read as the patient's
     * own; see `ConsentRecord.onBehalfOfPatient`.
     */
    'manage_consent',
  ]),
  contributor: new Set<Action>([
    'read_record',
    'write_record',
    'upload_document',
    'record_treatment',
    'manage_tasks',
    'contribute_notes',
    'read_grants',
  ]),
  viewer: new Set<Action>(['read_record', 'read_grants']),
};

/** Roles one account may hand to another. `self` is absent, deliberately. */
export const GRANTABLE_ROLES: readonly GrantRole[] = ['manager', 'contributor', 'viewer'];

export const isGrantableRole = (value: string): value is GrantRole =>
  (GRANTABLE_ROLES as readonly string[]).includes(value);

export type GrantStatus = 'active' | 'revoked';

export interface Grant {
  readonly patientId: string;
  /** The account this grant is *for*. */
  readonly accountId: string;
  readonly role: GrantRole;
  readonly status: GrantStatus;
  /** The account that created it. Equal to `accountId` for a self grant. */
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly revokedAt?: string | undefined;
  readonly revokedBy?: string | undefined;
}

/** Does this role permit this action? The only question the routes ask. */
export const permits = (role: GrantRole, action: Action): boolean =>
  PERMISSIONS[role].has(action);

/**
 * The decision for a specific grant.
 *
 * A revoked grant permits nothing, checked here rather than at each call site:
 * a route that looked up a grant and forgot the status check would keep working
 * perfectly for a helper whose access had been withdrawn.
 */
export const allows = (grant: Grant | null, action: Action): boolean =>
  grant !== null && grant.status === 'active' && permits(grant.role, action);

/**
 * Whether `actor` may hand `role` to somebody else on this record.
 *
 * Separate from `allows(grant, 'manage_grants')` because holding the permission
 * is not enough — the role being handed out matters too. Nobody grants `self`:
 * being the subject of a record is a fact about a person, not a permission
 * somebody else can confer. Without this check, a manager could make an
 * arbitrary account the patient.
 */
export const canGrantRole = (actor: Grant | null, role: string): role is GrantRole =>
  allows(actor, 'manage_grants') && isGrantableRole(role);

/**
 * Whether `actor` may revoke `target`.
 *
 * The self grant cannot be revoked by anybody, including its holder: a record
 * whose subject has lost access to it is unreachable, and there is no flow to
 * recover it. A manager revoking another manager is allowed — two people with
 * full charge of a record have to be able to resolve a dispute — but nobody
 * revokes the patient.
 */
export const canRevoke = (actor: Grant | null, target: Grant): boolean =>
  allows(actor, 'manage_grants') && target.role !== 'self';
