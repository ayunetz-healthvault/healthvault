/**
 * What an account holds over one patient's record.
 *
 * Mirrors `backend/src/services/access/policy.ts`. Kept as a separate file
 * rather than folded into `domain.ts` because it is not a fact about a person's
 * health — it is a fact about permission, and the two have different rules
 * about where they may be logged and displayed.
 *
 * The client uses this to decide what to *draw*. It never decides what may be
 * read: the backend checks the grant on every request, and a client that
 * believes it is a manager still gets a 403 if it is not.
 */
export type GrantRole = 'self' | 'manager' | 'contributor' | 'viewer';

export type GrantStatus = 'active' | 'revoked';

export interface Grant {
  readonly patientId: string;
  readonly accountId: string;
  readonly role: GrantRole;
  readonly status: GrantStatus;
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly revokedAt?: string | undefined;
  readonly revokedBy?: string | undefined;
}

/** Plain descriptions, for the sharing screens. No jargon, no role names. */
export const ROLE_DESCRIPTIONS: Record<GrantRole, { label: string; detail: string }> = {
  self: {
    label: 'This is their own record',
    detail: 'They decide who else can see it, and they can take access back at any time.',
  },
  manager: {
    label: 'Looks after this record',
    detail: 'Can see everything, add documents and notes, and decide who else has access.',
  },
  contributor: {
    label: 'Helps with this record',
    detail: 'Can see everything and add documents and notes. Cannot change who has access.',
  },
  viewer: {
    label: 'Can only look',
    detail: 'Can see the record. Cannot add or change anything, including notes.',
  },
};

/** Whether this role may write. Mirrors the backend's permission table. */
export const canContribute = (role: GrantRole): boolean => role !== 'viewer';

/** Whether this role may invite or revoke. */
export const canManageAccess = (role: GrantRole): boolean =>
  role === 'self' || role === 'manager';
