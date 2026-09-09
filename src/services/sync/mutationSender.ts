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
    case 'observation':
      return sendObservation(mutation);
    case 'treatment':
      return sendTreatment(mutation);
    case 'dose_event':
      return sendDoseEvent(mutation);
    /**
     * Still deliberately not sent. Documents have their own upload path, and a
     * patient profile has no write endpoint beyond the one that creates it — so
     * nothing enqueues either, and a mutation that reached here would be a bug
     * rather than a network problem.
     */
    case 'patient':
    case 'document':
    default:
      throw unsupported(mutation);
  }
};

/**
 * One follow-up, sent under the id the phone gave it.
 *
 * ## Why the id travels with the create
 *
 * A follow-up is written on the device and queued; the request may not leave
 * for hours. The server used to mint its own id on arrival and the app went on
 * holding the one it had generated, so every later change — marking the
 * appointment done, moving it, deleting it — addressed an id the server had
 * never heard of and came back 404. Sending `followUpId` makes the device's id
 * the record's id, once, and every later request lands on the same row.
 *
 * That also makes the create idempotent. A request that commits and loses its
 * response on the way back looks exactly like one that never arrived, and the
 * retry carries the same id: the server answers with the task that already
 * exists rather than a second copy of Thursday's appointment. This is the same
 * argument as `Mutation.id` one level up, applied to the record itself.
 */
/**
 * A note somebody wrote, sent under the id this device gave it.
 *
 * Same identity rule as a follow-up, and the same reason: the note is written
 * on a phone that may not reach the server for hours, so the device's id is the
 * id, a retry of a lost response returns the note rather than a second copy of
 * it, and every later edit lands on the same row.
 *
 * An update carries the version it was made against. The server refuses a stale
 * one with a 409, which `classify` turns into a conflict a person resolves —
 * never a silent overwrite of what the other family member wrote.
 */
const sendObservation = async (mutation: Mutation): Promise<void> => {
  const { patientId, entityId, operation, payload, baseVersion } = mutation;

  if (operation === 'delete') {
    await apiClient.delete(endpoints.observations.remove(patientId, entityId));
    return;
  }

  if (operation === 'update') {
    await apiClient.patch(endpoints.observations.update(patientId, entityId), {
      ...asObject(payload),
      version: baseVersion ?? 1,
    });
    return;
  }

  await apiClient.post(endpoints.observations.create(patientId), {
    ...asObject(payload),
    observationId: entityId,
  });
};

/**
 * A medicine somebody confirmed, or the moment they stopped it.
 *
 * There is no general update: changing what somebody takes produces a new
 * schedule, because what they were taking before is part of the record. So an
 * `update` here means exactly one thing — this schedule has ended — and it is
 * sent to the endpoint that says so.
 */
const sendTreatment = async (mutation: Mutation): Promise<void> => {
  const { patientId, entityId, operation, payload } = mutation;

  if (operation === 'update') {
    await apiClient.post(endpoints.treatments.supersede(patientId, entityId), asObject(payload));
    return;
  }

  if (operation === 'delete') {
    /**
     * There is no delete. A medicine somebody was taking is not something the
     * record can forget, and an endpoint that pretended otherwise would be
     * worse than this refusal — which reaches the user as "saved on this
     * phone" rather than as an eternal retry.
     */
    throw unsupported(mutation);
  }

  await apiClient.post(endpoints.treatments.confirm(patientId), {
    ...asObject(payload),
    scheduleId: entityId,
  });
};

/**
 * One dose, appended.
 *
 * Create only, on both sides. Undo is another create that supersedes this one,
 * so there is no update to send and no delete to send: the id makes the append
 * idempotent, and two taps on one tablet stay one event.
 */
const sendDoseEvent = async (mutation: Mutation): Promise<void> => {
  const { patientId, entityId, operation, payload } = mutation;

  if (operation !== 'create') throw unsupported(mutation);

  await apiClient.post(endpoints.doseEvents.append(patientId), {
    ...asObject(payload),
    eventId: entityId,
  });
};

/** A payload as an object, or an empty one. Never a silent `undefined` spread. */
const asObject = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

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

  const body = { ...asObject(payload), followUpId: entityId };

  const { followUp } = await apiClient.post<{ followUp: { followUpId: string } }>(
    endpoints.followUps.create(patientId),
    body,
  );

  /**
   * The response is read rather than discarded, and disagreement is loud.
   *
   * A server that answered with a different id would put this device back where
   * it started — holding a local id nothing else knows — and the failure would
   * show up later as a 404 on an edit, a long way from its cause. There is no
   * silent reconciliation here on purpose: the id is the device's to set, and a
   * server that overrode it is a contract violation, not a merge.
   */
  if (followUp?.followUpId !== undefined && followUp.followUpId !== entityId) {
    throw new ApiError(
      'conflict',
      'The server saved this follow-up under a different id, so later changes to it could not be sent.',
    );
  }
};
