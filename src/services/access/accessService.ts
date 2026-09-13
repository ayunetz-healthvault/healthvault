import { apiClient } from '../api/client';
import { endpoints } from '../api/endpoints';

import type { Grant, GrantRole } from '@/types/access';

/**
 * Sharing a record, and taking it back.
 *
 * Every call here is authorised on the server against a grant. The client's job
 * is to ask and to render the answer; it decides nothing, and a screen that
 * believes the user is a manager still gets a 403 if they are not.
 */

export interface Invitation {
  readonly patientId: string;
  readonly role: GrantRole;
  readonly invitedBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'revoked';
  readonly acceptedBy?: string | undefined;
  readonly acceptedAt?: string | undefined;
}

export interface IssuedInvitation {
  /**
   * Shown once, and then gone.
   *
   * The server keeps only a hash, so this is the single moment the token exists
   * in readable form. It is handed to the user to pass on however they choose —
   * the app deliberately does not send it, because sending an invitation to a
   * real person is an outward action and not one to take on somebody's behalf
   * without them seeing exactly what goes.
   */
  readonly token: string;
  readonly invitation: Invitation;
}

export const accessService = {
  /** Who can reach this record, and on what terms. */
  async grantsFor(patientId: string): Promise<Grant[]> {
    const { grants } = await apiClient.get<{ grants: Grant[] }>(endpoints.access.grants(patientId));
    return grants;
  },

  async pendingInvitations(patientId: string): Promise<Invitation[]> {
    const { invitations } = await apiClient.get<{ invitations: Invitation[] }>(
      endpoints.access.invitations(patientId),
    );
    return invitations.filter((invitation) => invitation.status === 'pending');
  },

  /**
   * Invites somebody to help with this record.
   *
   * `inviteeHint` is hashed server-side before it is stored, so the address is
   * never at rest in the database — it exists only in whatever the user uses to
   * pass the invitation on.
   */
  async invite(
    patientId: string,
    role: Exclude<GrantRole, 'self'>,
    inviteeHint?: string,
  ): Promise<IssuedInvitation> {
    return apiClient.post<IssuedInvitation>(endpoints.access.invitations(patientId), {
      role,
      ...(inviteeHint === undefined ? {} : { inviteeHint }),
    });
  },

  /** Exchanges an invitation for access. Requires a signed-in account. */
  async acceptInvitation(token: string): Promise<{ grant: Grant; alreadyGranted: boolean }> {
    return apiClient.post<{ grant: Grant; alreadyGranted: boolean }>(
      endpoints.access.acceptInvitation(),
      { token },
    );
  },

  /**
   * Withdraws somebody's access.
   *
   * Immediate for every server operation. What it cannot reach is a copy
   * already on a device that is offline, or a download URL already issued —
   * both are bounded, and both are stated in the UI rather than glossed over.
   */
  async revoke(patientId: string, accountId: string): Promise<void> {
    await apiClient.delete(endpoints.access.revoke(patientId, accountId));
  },
};

/**
 * What revocation does not do, in the words the screen uses.
 *
 * Kept beside the call so the promise and the mechanism cannot drift. Somebody
 * withdrawing access from a family member deserves to know exactly what that
 * achieves, not a reassuring sentence.
 */
export const REVOCATION_LIMITS =
  'They will not be able to open this record again. Anything they already ' +
  'downloaded stays on their phone until it next connects, and anything they ' +
  'saved or shared elsewhere cannot be taken back.';
