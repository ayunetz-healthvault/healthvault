import { describe, expect, it } from 'vitest';

import {
  allows,
  canGrantRole,
  canRevoke,
  GRANTABLE_ROLES,
  isGrantableRole,
  permits,
  type Action,
  type Grant,
  type GrantRole,
} from '../../src/services/access/policy.js';

/**
 * The authorisation table, enumerated.
 *
 * These tests are the specification. A role's permissions are not something to
 * infer by reading route handlers, and a change to the table that nobody
 * intended should fail here rather than surface as a helper who can suddenly
 * delete somebody's medical history.
 */

const grant = (patch: Partial<Grant> = {}): Grant => ({
  patientId: 'pat_1',
  accountId: 'acc_1',
  role: 'contributor',
  status: 'active',
  grantedBy: 'acc_owner',
  grantedAt: '2026-09-01T00:00:00.000Z',
  ...patch,
});

const ALL_ROLES: GrantRole[] = ['self', 'manager', 'contributor', 'viewer'];

const ALL_ACTIONS: Action[] = [
  'read_record',
  'write_record',
  'upload_document',
  'delete_document',
  'record_treatment',
  'manage_tasks',
  'contribute_notes',
  'read_grants',
  'manage_grants',
  'transfer_or_delete_record',
];

describe('the permission table', () => {
  it('lets every role read the record it is a grant on', () => {
    for (const role of ALL_ROLES) expect(permits(role, 'read_record')).toBe(true);
  });

  it('gives self every action', () => {
    for (const action of ALL_ACTIONS) expect(permits('self', action)).toBe(true);
  });

  /**
   * A caregiver who created a profile runs the record. They are not its
   * subject, and deleting somebody's medical history is not a thing to do on
   * their behalf.
   */
  it('does not let a manager delete or transfer the record', () => {
    expect(permits('manager', 'transfer_or_delete_record')).toBe(false);
    expect(permits('self', 'transfer_or_delete_record')).toBe(true);
  });

  /** The line between sharing a record and losing control of it. */
  it('lets only self and manager change who has access', () => {
    expect(permits('self', 'manage_grants')).toBe(true);
    expect(permits('manager', 'manage_grants')).toBe(true);
    expect(permits('contributor', 'manage_grants')).toBe(false);
    expect(permits('viewer', 'manage_grants')).toBe(false);
  });

  it('lets a contributor add to the record but not delete documents from it', () => {
    expect(permits('contributor', 'upload_document')).toBe(true);
    expect(permits('contributor', 'contribute_notes')).toBe(true);
    expect(permits('contributor', 'delete_document')).toBe(false);
  });

  /** "Read-only" that quietly permits appending is not read-only. */
  it('lets a viewer write nothing at all, notes included', () => {
    const writes: Action[] = [
      'write_record',
      'upload_document',
      'delete_document',
      'record_treatment',
      'manage_tasks',
      'contribute_notes',
      'manage_grants',
      'transfer_or_delete_record',
    ];
    for (const action of writes) expect(permits('viewer', action)).toBe(false);
  });

  it('is monotonic from viewer to contributor to manager', () => {
    for (const action of ALL_ACTIONS) {
      if (permits('viewer', action)) expect(permits('contributor', action)).toBe(true);
      if (permits('contributor', action)) expect(permits('manager', action)).toBe(true);
      if (permits('manager', action)) expect(permits('self', action)).toBe(true);
    }
  });
});

describe('allows', () => {
  it('permits nothing without a grant', () => {
    for (const action of ALL_ACTIONS) expect(allows(null, action)).toBe(false);
  });

  /**
   * The check that a route handler would forget. A revoked helper whose grant
   * row still exists must not keep working.
   */
  it('permits nothing once a grant is revoked, whatever the role was', () => {
    for (const role of ALL_ROLES) {
      const revoked = grant({ role, status: 'revoked' });
      for (const action of ALL_ACTIONS) expect(allows(revoked, action)).toBe(false);
    }
  });

  it('permits an active grant exactly what its role permits', () => {
    expect(allows(grant({ role: 'contributor' }), 'upload_document')).toBe(true);
    expect(allows(grant({ role: 'contributor' }), 'manage_grants')).toBe(false);
  });
});

describe('canGrantRole', () => {
  it('lets an owner hand out the three grantable roles', () => {
    for (const role of GRANTABLE_ROLES) {
      expect(canGrantRole(grant({ role: 'self' }), role)).toBe(true);
    }
  });

  /**
   * Being the subject of a record is a fact about a person, not a permission
   * somebody else can confer. Without this, a manager could make an arbitrary
   * account the patient.
   */
  it('never lets anybody hand out the self role', () => {
    expect(canGrantRole(grant({ role: 'self' }), 'self')).toBe(false);
    expect(canGrantRole(grant({ role: 'manager' }), 'self')).toBe(false);
    expect(isGrantableRole('self')).toBe(false);
  });

  it('refuses a role that is not in the model', () => {
    expect(canGrantRole(grant({ role: 'self' }), 'admin')).toBe(false);
    expect(canGrantRole(grant({ role: 'self' }), '')).toBe(false);
  });

  /** A helper widening their own access is the whole threat model. */
  it('does not let a contributor or viewer grant anything', () => {
    for (const role of ['contributor', 'viewer'] as const) {
      for (const target of GRANTABLE_ROLES) {
        expect(canGrantRole(grant({ role }), target)).toBe(false);
      }
    }
  });

  it('does not let a revoked owner grant anything', () => {
    expect(canGrantRole(grant({ role: 'self', status: 'revoked' }), 'viewer')).toBe(false);
  });
});

describe('canRevoke', () => {
  it('lets an owner revoke a helper', () => {
    expect(canRevoke(grant({ role: 'self' }), grant({ role: 'contributor' }))).toBe(true);
  });

  it('lets a manager revoke another manager, so a dispute is resolvable', () => {
    expect(canRevoke(grant({ role: 'manager' }), grant({ role: 'manager' }))).toBe(true);
  });

  /**
   * A record whose subject has lost access to it is unreachable, and there is
   * no flow to recover it.
   */
  it('never revokes the self grant, not even by its own holder', () => {
    expect(canRevoke(grant({ role: 'self' }), grant({ role: 'self' }))).toBe(false);
    expect(canRevoke(grant({ role: 'manager' }), grant({ role: 'self' }))).toBe(false);
  });

  it('does not let a contributor revoke anybody', () => {
    expect(canRevoke(grant({ role: 'contributor' }), grant({ role: 'viewer' }))).toBe(false);
  });
});
