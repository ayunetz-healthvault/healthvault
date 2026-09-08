import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadIdentityConfig } from '../../src/config/identity.js';
import { loadStackConfig } from '../../src/config/stack.js';
import { createLocalIssuer } from '../../src/services/identity/localIssuer.js';
import { createTokenVerifier } from '../../src/services/identity/TokenVerifier.js';
import { inMemoryAccessRepository, inMemoryPatientRepository } from '../helpers/inMemoryAccess.js';

/**
 * Who may reach whose record.
 *
 * The positive cases here are the short half. Most of this file is the negative
 * matrix KOO-03 asks for — an unrelated account, a helper reaching across to a
 * second patient, a read-only grant attempting a write, a forged patient id, an
 * expired invitation, a spent invitation, and a revoked helper still holding a
 * valid token. Each of those, allowed by accident, is one family's medical
 * records reachable by a stranger.
 *
 * Storage is in-memory: these prove the route decisions, not DynamoDB's
 * conditional writes. Those are in `test/integration/access.test.ts`, which
 * skips without the local stack.
 */

const identity = loadIdentityConfig('local', 'ap-south-1', {
  AYUNETZ_IDENTITY_ISSUER: 'http://localhost:4000/local-identity',
  AYUNETZ_IDENTITY_AUDIENCE: 'ayunetz-local-app',
});

const issuer = createLocalIssuer(identity, 'local');
const verifier = createTokenVerifier(identity, createLocalJWKSet(await issuer.jwks()));

const silent = (): NodeJS.WritableStream =>
  ({ write: () => true }) as unknown as NodeJS.WritableStream;

let app: FastifyInstance;
let access: ReturnType<typeof inMemoryAccessRepository>;
let patients: ReturnType<typeof inMemoryPatientRepository>;

/** Distinct accounts, each with a real signed token for its own subject. */
const tokens = new Map<string, string>();
const tokenFor = async (accountId: string): Promise<string> => {
  const existing = tokens.get(accountId);
  if (existing !== undefined) return existing;
  const minted = await issuer.issueFor({
    ownerId: accountId,
    email: `${accountId}@example.invalid`,
  });
  tokens.set(accountId, minted);
  return minted;
};

const auth = async (accountId: string): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await tokenFor(accountId)}`,
});

beforeEach(async () => {
  access = inMemoryAccessRepository();
  patients = inMemoryPatientRepository();
  app = buildApp({
    stack: loadStackConfig(),
    identity,
    verifier,
    access,
    patients,
    logStream: silent(),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

/** Creates a record, returning its id. `subject` decides self vs manager. */
const createPatient = async (
  accountId: string,
  subject: 'me' | 'someone_else' = 'someone_else',
  fullName = 'Meera Nair',
): Promise<string> => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/patients',
    headers: await auth(accountId),
    payload: { fullName, relationship: 'mother', subject },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { patient: { patientId: string } }).patient.patientId;
};

const invite = async (
  accountId: string,
  patientId: string,
  role: 'manager' | 'contributor' | 'viewer',
): Promise<string> => {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/patients/${patientId}/invitations`,
    headers: await auth(accountId),
    payload: { role },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { token: string }).token;
};

const accept = async (accountId: string, token: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/invitations/accept',
    headers: await auth(accountId),
    payload: { token },
  });

describe('creating a record', () => {
  it('gives the creator the self grant when the record is their own', async () => {
    const patientId = await createPatient('alice', 'me');
    expect(await access.getGrant(patientId, 'alice')).toMatchObject({
      role: 'self',
      status: 'active',
    });
  });

  /**
   * The distinction the old schema could not make. A caregiver who creates a
   * profile for their mother runs the record; they are not its subject, and
   * they must not be able to delete her medical history.
   */
  it('gives the creator only management authority for somebody else’s record', async () => {
    const patientId = await createPatient('alice', 'someone_else');
    expect(await access.getGrant(patientId, 'alice')).toMatchObject({ role: 'manager' });
  });

  it('lists a record under the account that can reach it', async () => {
    await createPatient('alice');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/patients',
      headers: await auth('alice'),
    });
    expect((response.json() as { patients: unknown[] }).patients).toHaveLength(1);
  });

  it('records who created it, for provenance rather than for access', async () => {
    const patientId = await createPatient('alice');
    expect(await patients.getPatient(patientId)).toMatchObject({
      createdByAccountId: 'alice',
    });
  });
});

describe('an account with no grant', () => {
  it('cannot read a record it was never given', async () => {
    const patientId = await createPatient('alice');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${patientId}`,
      headers: await auth('mallory'),
    });

    expect(response.statusCode).toBe(404);
  });

  /**
   * The same 404 as a record that does not exist. Distinguishing them turns any
   * endpoint taking an id into a way to test whether that id is real.
   */
  it('gets the same answer for a real record and an invented one', async () => {
    const patientId = await createPatient('alice');

    const real = await app.inject({
      method: 'GET',
      url: `/v1/patients/${patientId}`,
      headers: await auth('mallory'),
    });
    const forged = await app.inject({
      method: 'GET',
      url: '/v1/patients/pat_00000000-0000-4000-8000-000000000000',
      headers: await auth('mallory'),
    });

    expect(real.statusCode).toBe(forged.statusCode);
    expect(real.json()).toEqual(forged.json());
  });

  it('does not see it in its own list of records', async () => {
    await createPatient('alice');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/patients',
      headers: await auth('mallory'),
    });
    expect((response.json() as { patients: unknown[] }).patients).toEqual([]);
  });

  it('cannot invite anybody to it', async () => {
    const patientId = await createPatient('alice');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/invitations`,
      headers: await auth('mallory'),
      payload: { role: 'contributor' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('is refused before authentication as well', async () => {
    const patientId = await createPatient('alice');
    const response = await app.inject({ method: 'GET', url: `/v1/patients/${patientId}` });
    expect(response.statusCode).toBe(401);
  });
});

describe('invitations', () => {
  it('lets an invited account reach the record afterwards', async () => {
    const patientId = await createPatient('alice');
    const token = await invite('alice', patientId, 'contributor');

    expect((await accept('bob', token)).statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/patients/${patientId}`,
      headers: await auth('bob'),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { role: string }).role).toBe('contributor');
  });

  /** A leaked invitation is an offer, not a key. */
  it('reads nothing on its own, without an account behind it', async () => {
    const patientId = await createPatient('alice');
    const token = await invite('alice', patientId, 'viewer');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(response.statusCode).toBe(401);
  });

  it('is spent after one use', async () => {
    const patientId = await createPatient('alice');
    const token = await invite('alice', patientId, 'viewer');

    expect((await accept('bob', token)).statusCode).toBe(200);
    expect((await accept('carol', token)).statusCode).toBe(404);
    expect(await access.getGrant(patientId, 'carol')).toBeNull();
  });

  it('is refused once it has expired', async () => {
    const patientId = await createPatient('alice');
    const issued = await access.createInvitation({
      patientId,
      role: 'viewer',
      invitedBy: 'alice',
      ttlSeconds: -1,
    });

    expect((await accept('bob', issued.token)).statusCode).toBe(404);
  });

  it('is refused once it has been withdrawn', async () => {
    const patientId = await createPatient('alice');
    const token = await invite('alice', patientId, 'viewer');

    expect(await access.revokeInvitation(patientId, token)).toBe(true);
    expect((await accept('bob', token)).statusCode).toBe(404);
  });

  it('answers the same way for a wrong token as for a spent one', async () => {
    const patientId = await createPatient('alice');
    const token = await invite('alice', patientId, 'viewer');
    await accept('bob', token);

    const spent = await accept('carol', token);
    const nonsense = await accept('carol', `${patientId}.not-a-real-token`);

    expect(spent.statusCode).toBe(nonsense.statusCode);
    expect(spent.json()).toEqual(nonsense.json());
  });

  /**
   * Being the subject of a record is a fact about a person, not a permission
   * somebody else can confer.
   */
  it('cannot confer the self role', async () => {
    const patientId = await createPatient('alice', 'me');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/invitations`,
      headers: await auth('alice'),
      payload: { role: 'self' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('never stores the address it was sent to in the clear', async () => {
    const patientId = await createPatient('alice');
    await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/invitations`,
      headers: await auth('alice'),
      payload: { role: 'viewer', inviteeHint: 'bob@example.invalid' },
    });

    const [stored] = await access.listInvitationsForPatient(patientId);
    expect(stored?.inviteeHint).toBeDefined();
    expect(stored?.inviteeHint).not.toContain('bob');
    expect(stored?.inviteeHint).not.toContain('@');
  });

  it('attributes the grant to the inviter, never to the person accepting', async () => {
    const patientId = await createPatient('alice');
    const token = await invite('alice', patientId, 'contributor');
    await accept('bob', token);

    expect(await access.getGrant(patientId, 'bob')).toMatchObject({ grantedBy: 'alice' });
  });
});

describe('a helper cannot widen their own access', () => {
  it('refuses a contributor trying to invite somebody', async () => {
    const patientId = await createPatient('alice');
    await accept('bob', await invite('alice', patientId, 'contributor'));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/invitations`,
      headers: await auth('bob'),
      payload: { role: 'manager' },
    });

    // 403, not 404: bob can see this record, so pretending it is missing would
    // only be confusing. What he may not do is the honest answer.
    expect(response.statusCode).toBe(403);
  });

  it('refuses a viewer trying to invite somebody', async () => {
    const patientId = await createPatient('alice');
    await accept('bob', await invite('alice', patientId, 'viewer'));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/patients/${patientId}/invitations`,
      headers: await auth('bob'),
      payload: { role: 'viewer' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a contributor trying to revoke the owner', async () => {
    const patientId = await createPatient('alice', 'me');
    await accept('bob', await invite('alice', patientId, 'contributor'));

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/alice`,
      headers: await auth('bob'),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('revocation', () => {
  it('stops the helper reading the record on the next request', async () => {
    const patientId = await createPatient('alice');
    await accept('bob', await invite('alice', patientId, 'contributor'));

    const before = await app.inject({
      method: 'GET',
      url: `/v1/patients/${patientId}`,
      headers: await auth('bob'),
    });
    expect(before.statusCode).toBe(200);

    const removal = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/bob`,
      headers: await auth('alice'),
    });
    expect(removal.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/v1/patients/${patientId}`,
      // The same token as before. Revocation must not depend on the client
      // discarding anything.
      headers: await auth('bob'),
    });
    expect(after.statusCode).toBe(404);
  });

  it('removes the record from the helper’s list', async () => {
    const patientId = await createPatient('alice');
    await accept('bob', await invite('alice', patientId, 'viewer'));
    await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/bob`,
      headers: await auth('alice'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/patients',
      headers: await auth('bob'),
    });
    expect((response.json() as { patients: unknown[] }).patients).toEqual([]);
  });

  /**
   * A record whose subject cannot reach it is unreachable, and there is no
   * recovery flow.
   */
  it('never revokes the subject’s own access', async () => {
    const patientId = await createPatient('alice', 'me');
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/alice`,
      headers: await auth('alice'),
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not rewrite who withdrew access when revoked twice', async () => {
    const patientId = await createPatient('alice');
    await accept('bob', await invite('alice', patientId, 'viewer'));
    await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/bob`,
      headers: await auth('alice'),
    });
    const first = await access.getGrant(patientId, 'bob');

    const second = await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/bob`,
      headers: await auth('alice'),
    });

    expect(second.statusCode).toBe(409);
    expect(await access.getGrant(patientId, 'bob')).toEqual(first);
  });

  it('lets a re-invited helper back in, as a fresh grant', async () => {
    const patientId = await createPatient('alice');
    await accept('bob', await invite('alice', patientId, 'viewer'));
    await app.inject({
      method: 'DELETE',
      url: `/v1/patients/${patientId}/grants/bob`,
      headers: await auth('alice'),
    });

    await accept('bob', await invite('alice', patientId, 'contributor'));

    expect(await access.getGrant(patientId, 'bob')).toMatchObject({
      role: 'contributor',
      status: 'active',
    });
  });
});

describe('one helper, two patients', () => {
  /**
   * The cross-record case. A helper trusted with one parent's record must not
   * reach the other's, even though both grants sit on the same account.
   */
  it('does not let access to one record imply access to another', async () => {
    const mother = await createPatient('alice', 'someone_else', 'Meera Nair');
    const father = await createPatient('alice', 'someone_else', 'Ravi Nair');

    await accept('bob', await invite('alice', mother, 'contributor'));

    expect(
      (await app.inject({ method: 'GET', url: `/v1/patients/${mother}`, headers: await auth('bob') }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/patients/${father}`, headers: await auth('bob') }))
        .statusCode,
    ).toBe(404);
  });

  it('shows each account only the records it holds a grant on', async () => {
    const mother = await createPatient('alice');
    await createPatient('alice');
    await accept('bob', await invite('alice', mother, 'viewer'));

    const alices = await app.inject({
      method: 'GET',
      url: '/v1/patients',
      headers: await auth('alice'),
    });
    const bobs = await app.inject({
      method: 'GET',
      url: '/v1/patients',
      headers: await auth('bob'),
    });

    expect((alices.json() as { patients: unknown[] }).patients).toHaveLength(2);
    expect((bobs.json() as { patients: unknown[] }).patients).toHaveLength(1);
  });
});

describe('the audit trail', () => {
  it('records who did what, without any clinical detail', async () => {
    const patientId = await createPatient('alice', 'me', 'Meera Nair');
    await accept('bob', await invite('alice', patientId, 'contributor'));

    const entries = await patients.listAudit(patientId);
    const serialised = JSON.stringify(entries);

    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['create', 'invite', 'accept_invitation']),
    );
    // The patient's name is clinical context and has no business in a trail
    // that everyone with access can read.
    expect(serialised).not.toContain('Meera');
  });
});
