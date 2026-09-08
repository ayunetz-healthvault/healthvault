import type { Mutation } from './types';

import { apiClient } from '@/services/api/client';
import { endpoints } from '@/services/api/endpoints';
import { ApiError } from '@/services/api/errors';

/**
 * Turning a queued change into a request.
 *
 * The outbox and the flush engine were built and tested without one of these,
 * which meant the queue worked perfectly and nothing was ever sent. This is the
 * missing half: one function that knows which endpoint each kind of change
 * belongs to, and nothing else.
 *
 * ## Why an unsupported entity is rejected rather than retried
 *
 * `classify` treats anything it does not recognise as retryable, which is right
 * for a connection failure and wrong for "this app has no endpoint for that".
 * A change with nowhere to go would be attempted six times over an hour and
 * then sit as `failed`, with a user told their note could not be sent for
 * reasons that will never change. Saying so immediately is kinder and truer.
 */

const unsupported = (mutation: Mutation): ApiError =>
  new ApiError(
    'forbidden',
    `This app cannot yet send ${mutation.entity} changes to the server. It is saved on this phone.`,
  );

export const sendMutation = async (mutation: Mutation): Promise<void> => {
  switch (mutation.entity) {
    case 'follow_up':
      return sendFollowUp(mutation);
    /**
     * Deliberately not sent yet. Documents have their own upload path, and
     * patients, observations, treatments and dose events have no `/v1`
     * endpoint — so nothing enqueues them, and a mutation that reached here
     * would be a bug rather than a network problem.
     */
    case 'patient':
    case 'document':
    case 'observation':
    case 'treatment':
    case 'dose_event':
    default:
      throw unsupported(mutation);
  }
};

const sendFollowUp = async (mutation: Mutation): Promise<void> => {
  const { patientId, entityId, operation, payload } = mutation;

  if (operation === 'delete') {
    await apiClient.delete(endpoints.followUps.remove(patientId, entityId));
    return;
  }

  if (operation === 'update') {
    await apiClient.patch(endpoints.followUps.update(patientId, entityId), payload);
    return;
  }

  await apiClient.post(endpoints.followUps.create(patientId), payload);
};
