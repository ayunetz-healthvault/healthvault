import { render, screen } from '@testing-library/react-native';

import { SyncStatus } from './SyncStatus';

import type { SyncSummary } from '@/services/sync/types';

/**
 * The indicator a caregiver abroad reads to decide whether to trust what is on
 * the screen. Every assertion here is about wording, because the wording is the
 * only part a user can act on.
 */

const NOW = new Date('2026-09-08T10:00:00.000Z');

const summary = (patch: Partial<SyncSummary> = {}): SyncSummary => ({
  lastSyncedAt: '2026-09-08T09:55:00.000Z',
  pending: 0,
  failed: 0,
  conflicts: 0,
  rejected: 0,
  ...patch,
});

const renderStatus = async (value: SyncSummary): Promise<void> => {
  await render(<SyncStatus summary={value} now={NOW} testID="sync" />);
};

describe('SyncStatus', () => {
  it('always says when the last sync was', async () => {
    await renderStatus(summary());

    expect(screen.getByText('Synced 5 minutes ago')).toBeTruthy();
  });

  /** A blank here would read as "fine". */
  it('says plainly when nothing has ever synced', async () => {
    await renderStatus(summary({ lastSyncedAt: null }));

    expect(screen.getByText('Not synced yet')).toBeTruthy();
  });

  /**
   * The distinction the whole story turns on: saved *here* is not saved to the
   * record everyone else can see.
   */
  it('says a pending change is on this phone and not yet shared', async () => {
    await renderStatus(summary({ pending: 2 }));

    expect(screen.getByText(/saved on this phone, not yet shared/i)).toBeTruthy();
  });

  it('puts a conflict above everything else waiting', async () => {
    await renderStatus(summary({ pending: 3, failed: 1, conflicts: 1 }));

    expect(screen.getByText(/somebody else edited the same thing/i)).toBeTruthy();
    expect(screen.queryByText(/not yet shared/i)).toBeNull();
  });

  it('says a rejected change could not be saved to the shared record', async () => {
    await renderStatus(summary({ rejected: 1 }));

    expect(screen.getByText(/could not be saved to the shared record/i)).toBeTruthy();
  });

  it('offers a retry for a change that simply did not send', async () => {
    await renderStatus(summary({ failed: 2 }));

    expect(screen.getByText(/try again/i)).toBeTruthy();
  });

  it('says only the time when there is nothing outstanding', async () => {
    await renderStatus(summary());

    expect(screen.queryByText(/not yet shared/i)).toBeNull();
    expect(screen.queryByText(/could not be saved/i)).toBeNull();
  });

  /** An icon on its own means nothing to somebody who has not learned it. */
  it('never relies on the icon to carry the meaning', async () => {
    await renderStatus(summary({ conflicts: 1 }));

    expect(screen.getByText(/need checking/i)).toBeTruthy();
  });
});
