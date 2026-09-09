import { createHash, randomBytes } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { StackConfig } from '../../config/stack.js';
import {
  GRANT_PREFIX,
  GSI2_NAME,
  accountGsiPk,
  grantGsiSk,
  grantSk,
  invitationSk,
  patientPk,
  type AccountId,
  type PatientId,
} from '../records/keys.js';
import { TTL_ATTRIBUTE } from '../records/tableDefinition.js';
import type { Grant, GrantRole } from './policy.js';

/**
 * Grants and invitations.
 *
 * Split from `RecordRepository` because the two answer different questions and
 * must not be able to answer each other's. `RecordRepository` reads and writes a
 * patient's data *given* that access is settled; this decides whether it is. One
 * repository that did both would make it possible to fetch a document and its
 * authorisation in a single call — and then to forget the second half.
 */

export interface Invitation {
  readonly patientId: PatientId;
  /** The role the invitation confers when accepted. Never `self`. */
  readonly role: GrantRole;
  readonly invitedBy: AccountId;
  readonly createdAt: string;
  /** ISO-8601. After this the invitation is dead, claimed or not. */
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly acceptedBy?: AccountId | undefined;
  readonly acceptedAt?: string | undefined;
  /**
   * A one-way hash of the address it was sent to, when there was one.
   *
   * Enough to tell one pending invitation from another; not enough to recover
   * an address from a database dump. The plaintext lives in whatever sent the
   * message, not here.
   */
  readonly inviteeHint?: string | undefined;
}

export interface IssuedInvitation {
  /** Shown once, to the inviter. Never stored and never logged. */
  readonly token: string;
  readonly invitation: Invitation;
}

export type AcceptResult =
  | { readonly outcome: 'accepted'; readonly grant: Grant }
  /** Wrong, spent, revoked or expired — deliberately one indistinguishable answer. */
  | { readonly outcome: 'rejected' }
  /** The account already holds an active grant; nothing changed. */
  | { readonly outcome: 'already_granted'; readonly grant: Grant };

export interface AccessRepository {
  /**
   * Records that an account is the subject of a patient record.
   *
   * Returns null if the patient already has a subject, which is what stops a
   * second account claiming a record that is already somebody's.
   */
  createSelfGrant(patientId: PatientId, accountId: AccountId): Promise<Grant | null>;
  /** Records management authority over a record created on somebody's behalf. */
  createManagerGrant(patientId: PatientId, accountId: AccountId): Promise<Grant | null>;

  getGrant(patientId: PatientId, accountId: AccountId): Promise<Grant | null>;
  listGrantsForPatient(patientId: PatientId): Promise<Grant[]>;
  /** Every patient this account holds a grant on, revoked ones included. */
  listGrantsForAccount(accountId: AccountId): Promise<Grant[]>;

  revokeGrant(
    patientId: PatientId,
    accountId: AccountId,
    revokedBy: AccountId,
  ): Promise<Grant | null>;

  createInvitation(input: {
    patientId: PatientId;
    role: GrantRole;
    invitedBy: AccountId;
    ttlSeconds: number;
    inviteeHint?: string | undefined;
  }): Promise<IssuedInvitation>;

  listInvitationsForPatient(patientId: PatientId): Promise<Invitation[]>;

  /** Exchanges a token for a grant. Single use, enforced atomically. */
  acceptInvitation(token: string, accountId: AccountId, now?: Date): Promise<AcceptResult>;

  revokeInvitation(patientId: PatientId, token: string): Promise<boolean>;
}

/**
 * An invitation token: `<patientId>.<secret>`.
 *
 * The patient id travels in the token so the token alone can find its own row
 * by exact key — no scan, and no second index whose only job is to look up a
 * credential. That is safe because a patient id is a generated identifier, not
 * a secret, and it is never what protects the record: the secret half is 32
 * bytes from the CSPRNG, and a grant check runs on every read regardless.
 *
 * Only the hash of the secret is stored. An invitation token is a bearer
 * credential for a few days, so a table dump containing them would be a set of
 * working keys to other people's medical records.
 *
 * SHA-256 with no salt is right here and would be wrong for a password: the
 * input is already 256 bits of entropy, so there is nothing to brute-force, and
 * a per-row salt would break the lookup-by-hash this depends on.
 */
const TOKEN_SEPARATOR = '.';

const newToken = (patientId: PatientId): string =>
  `${patientId}${TOKEN_SEPARATOR}${randomBytes(32).toString('base64url')}`;

const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

interface ParsedToken {
  readonly patientId: PatientId;
  readonly secretHash: string;
}

const parseToken = (token: string): ParsedToken | null => {
  const separator = token.indexOf(TOKEN_SEPARATOR);
  if (separator <= 0 || separator === token.length - 1) return null;

  const patientId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  // A patient id is a key component; anything outside this alphabet would let a
  // crafted token address a partition of the caller's choosing.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(patientId)) return null;

  return { patientId, secretHash: hashSecret(secret) };
};

/**
 * Note on timing: this file never compares two digests.
 *
 * The stored value *is* the sort key, so matching a token is an exact-key read
 * that DynamoDB performs — there is no string comparison here to leak where two
 * candidates diverge, and adding a constant-time compare would be comparing a
 * value with itself.
 */

const stripKeys = <T>(item: Record<string, unknown> | undefined): T | null => {
  if (item === undefined) return null;
  const { PK, SK, GSI2PK, GSI2SK, [TTL_ATTRIBUTE]: ttl, ...rest } = item;
  void PK;
  void SK;
  void GSI2PK;
  void GSI2SK;
  void ttl;
  return rest as T;
};

export const createAccessRepository = (config: StackConfig): AccessRepository => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config.clients.records), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const TableName = config.recordsTable;

  const grantItem = (grant: Grant): Record<string, unknown> => ({
    PK: patientPk(grant.patientId),
    SK: grantSk(grant.accountId),
    GSI2PK: accountGsiPk(grant.accountId),
    GSI2SK: grantGsiSk(grant.patientId),
    ...grant,
  });

  /**
   * Writes a grant only if this account does not already have one.
   *
   * Conditional rather than read-then-write: two devices accepting at the same
   * moment would both see "no grant" and both write, and the second write would
   * silently reset the first one's timestamps and grantor.
   */
  const putGrantIfAbsent = async (grant: Grant): Promise<Grant | null> => {
    try {
      await client.send(
        new PutCommand({
          TableName,
          Item: grantItem(grant),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return grant;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
  };

  const roleGrant = (
    patientId: PatientId,
    accountId: AccountId,
    role: GrantRole,
    grantedBy: AccountId,
  ): Grant => ({
    patientId,
    accountId,
    role,
    status: 'active',
    grantedBy,
    grantedAt: new Date().toISOString(),
  });

  const readGrant = async (patientId: PatientId, accountId: AccountId): Promise<Grant | null> => {
    const response = await client.send(
      new GetCommand({ TableName, Key: { PK: patientPk(patientId), SK: grantSk(accountId) } }),
    );
    return stripKeys<Grant>(response.Item);
  };

  const listGrantsForPatient = async (patientId: PatientId): Promise<Grant[]> => {
    const response = await client.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': patientPk(patientId), ':prefix': GRANT_PREFIX },
      }),
    );
    return (response.Items ?? []).flatMap((item) => {
      const grant = stripKeys<Grant>(item);
      return grant === null ? [] : [grant];
    });
  };

  return {
    async createSelfGrant(patientId, accountId) {
      /**
       * A record has exactly one subject.
       *
       * Checked across the whole patient partition, not just this account's
       * row: the risk is not one account claiming twice, it is a *second*
       * account claiming a record that already belongs to somebody.
       */
      const existing = await listGrantsForPatient(patientId);
      if (existing.some((grant) => grant.role === 'self')) return null;

      return putGrantIfAbsent(roleGrant(patientId, accountId, 'self', accountId));
    },

    createManagerGrant: (patientId, accountId) =>
      putGrantIfAbsent(roleGrant(patientId, accountId, 'manager', accountId)),

    getGrant: readGrant,
    listGrantsForPatient,

    async listGrantsForAccount(accountId) {
      const response = await client.send(
        new QueryCommand({
          TableName,
          IndexName: GSI2_NAME,
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': accountGsiPk(accountId) },
        }),
      );
      return (response.Items ?? []).flatMap((item) => {
        const grant = stripKeys<Grant>(item);
        return grant === null ? [] : [grant];
      });
    },

    async revokeGrant(patientId, accountId, revokedBy) {
      try {
        const response = await client.send(
          new UpdateCommand({
            TableName,
            Key: { PK: patientPk(patientId), SK: grantSk(accountId) },
            UpdateExpression: 'SET #status = :revoked, revokedAt = :now, revokedBy = :by',
            /**
             * Only an existing, active grant can be revoked.
             *
             * Without the status condition a second revoke would overwrite the
             * first one's timestamp and actor — quietly rewriting who withdrew
             * access and when, which is the one thing an audit trail is for.
             */
            ConditionExpression: 'attribute_exists(PK) AND #status = :active',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':revoked': 'revoked',
              ':active': 'active',
              ':now': new Date().toISOString(),
              ':by': revokedBy,
            },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return stripKeys<Grant>(response.Attributes);
      } catch (error) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return null;
        throw error;
      }
    },

    async createInvitation({ patientId, role, invitedBy, ttlSeconds, inviteeHint }) {
      const token = newToken(patientId);
      const parsed = parseToken(token);
      if (parsed === null) throw new Error('Generated an invitation token that cannot be parsed.');

      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      const invitation: Invitation = {
        patientId,
        role,
        invitedBy,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'pending',
        ...(inviteeHint === undefined ? {} : { inviteeHint }),
      };

      await client.send(
        new PutCommand({
          TableName,
          Item: {
            PK: patientPk(patientId),
            SK: invitationSk(parsed.secretHash),
            ...invitation,
            /**
             * Swept a week after expiry. The sweep is tidy-up, never the
             * control: `acceptInvitation` compares the timestamp itself,
             * because DynamoDB deletes within 48 hours of a TTL rather than at
             * it — and DynamoDB Local does not delete at all.
             */
            [TTL_ATTRIBUTE]: Math.floor(expiresAt.getTime() / 1000) + 7 * 24 * 60 * 60,
          },
        }),
      );

      return { token, invitation };
    },

    async listInvitationsForPatient(patientId) {
      const response = await client.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': patientPk(patientId), ':prefix': 'INVITE#' },
        }),
      );
      return (response.Items ?? []).flatMap((item) => {
        const invitation = stripKeys<Invitation>(item);
        return invitation === null ? [] : [invitation];
      });
    },

    async acceptInvitation(token, accountId, now = new Date()) {
      const parsed = parseToken(token);
      if (parsed === null) return { outcome: 'rejected' };

      const response = await client.send(
        new GetCommand({
          TableName,
          Key: {
            PK: patientPk(parsed.patientId),
            SK: invitationSk(parsed.secretHash),
          },
        }),
      );
      const invitation = stripKeys<Invitation>(response.Item);

      /**
       * One answer for every failure.
       *
       * Wrong token, spent, revoked and expired are deliberately
       * indistinguishable. Telling them apart turns this endpoint into a way to
       * probe which invitations exist for a patient id.
       */
      if (
        invitation === null ||
        invitation.status !== 'pending' ||
        invitation.patientId !== parsed.patientId ||
        new Date(invitation.expiresAt).getTime() <= now.getTime()
      ) {
        return { outcome: 'rejected' };
      }

      const existing = await readGrant(invitation.patientId, accountId);
      if (existing !== null && existing.status === 'active') {
        return { outcome: 'already_granted', grant: existing };
      }

      /**
       * Burn the token first, conditionally.
       *
       * If two devices race, exactly one wins this update and the other is told
       * the invitation is spent. Creating the grant first would let both
       * succeed, and one invitation would have produced two grants.
       */
      try {
        await client.send(
          new UpdateCommand({
            TableName,
            Key: { PK: patientPk(parsed.patientId), SK: invitationSk(parsed.secretHash) },
            UpdateExpression: 'SET #status = :accepted, acceptedBy = :by, acceptedAt = :now',
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':accepted': 'accepted',
              ':pending': 'pending',
              ':by': accountId,
              ':now': now.toISOString(),
            },
          }),
        );
      } catch (error) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
          return { outcome: 'rejected' };
        }
        throw error;
      }

      const grant: Grant = {
        patientId: invitation.patientId,
        accountId,
        role: invitation.role,
        status: 'active',
        // The inviter, not the invitee. "Who let this person in" is the
        // question an audit answers, and the answer is never "themselves".
        grantedBy: invitation.invitedBy,
        grantedAt: now.toISOString(),
      };

      // Unconditional: a previously revoked grant for this account is replaced,
      // which is what re-inviting somebody means.
      await client.send(new PutCommand({ TableName, Item: grantItem(grant) }));

      return { outcome: 'accepted', grant };
    },

    async revokeInvitation(patientId, token) {
      const parsed = parseToken(token);
      if (parsed === null || parsed.patientId !== patientId) return false;

      try {
        await client.send(
          new UpdateCommand({
            TableName,
            Key: { PK: patientPk(patientId), SK: invitationSk(parsed.secretHash) },
            UpdateExpression: 'SET #status = :revoked',
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':revoked': 'revoked', ':pending': 'pending' },
          }),
        );
        return true;
      } catch (error) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },
  };
};
