import { sendMutation } from './mutationSender';
import { createSyncService, type FlushReport, type SyncService } from './syncService';

import { isBackendEnabled } from '@/config/env';
import { currentVaultAccountId } from '@/services/storage/activeVault';
import type { EnqueueInput } from './outbox';

/**
 * The outgoing half of sync, as one thing a screen can call.
 *
 * `syncService` is the engine and `mutationSender` is the map from a change to
 * a request; neither knows which account is signed in, and a screen should not
 * have to. This does.
 *
 * ## Queue first, send second
 *
 * A change is written to the encrypted outbox before anything is sent, and the
 * send is a separate step that may fail. That ordering is the whole point: a
 * caregiver in a lift has still recorded what they recorded, and the screen can
 * say "saved on this phone" truthfully rather than showing a tick it cannot
 * back up.
 */

const services = new Map<string, SyncService>();

/** One service per account, so two accounts never share a queue. */
const serviceFor = (accountId: string): SyncService => {
  const existing = services.get(accountId);
  if (existing !== undefined) return existing;

  const created = createSyncService(accountId);
  services.set(accountId, created);
  return created;
};

/** The service for whoever is signed in, or null when nobody is. */
export const currentSyncService = (): SyncService | null => {
  const accountId = currentVaultAccountId();
  return accountId === null ? null : serviceFor(accountId);
};

/**
 * Records a change and tries to send it.
 *
 * Returns whether it reached the server. Callers use it to decide what to say,
 * never whether to keep the change — the change is already saved either way.
 */
export const pushChange = async (input: EnqueueInput): Promise<{ delivered: boolean }> => {
  const service = currentSyncService();
  if (service === null) return { delivered: false };

  await service.enqueue(input);

  if (!isBackendEnabled()) return { delivered: false };

  const report = await service.flush(sendMutation);
  return { delivered: report.committed > 0 };
};

/** Sends anything still waiting. Safe to call on a refresh or a foreground. */
export const flushPending = async (): Promise<FlushReport | null> => {
  const service = currentSyncService();
  if (service === null || !isBackendEnabled()) return null;

  return service.flush(sendMutation);
};

/** Forgets the cached services. Called on sign-out, alongside the vault close. */
export const resetSyncServices = (): void => {
  services.clear();
};
