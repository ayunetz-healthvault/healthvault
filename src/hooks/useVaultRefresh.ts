import { useCallback, useState } from 'react';

import { pullIntoVault } from '@/services/sync/pullService';

/**
 * Pull-to-refresh, with something honest to say afterwards.
 *
 * The `notice` is the reason this is a hook and not two lines in each screen.
 * A refresh has three outcomes and they are not interchangeable: the records
 * were updated, there is no server in this build, or the phone could not reach
 * one. Only the first means what is on the screen is current, and a spinner
 * that stops tells the user nothing about which of the three happened.
 */

export interface VaultRefresh {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  /** Null when the last refresh succeeded, or when none has been attempted. */
  readonly notice: string | null;
  readonly dismissNotice: () => void;
}

export const useVaultRefresh = (): VaultRefresh => {
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void pullIntoVault()
      .then((result) => {
        setNotice(
          result.outcome === 'applied'
            ? null
            : result.outcome === 'no_backend'
              ? 'This is a demonstration build, so there is nothing to sync with.'
              : // Deliberately not "sync failed": what the user needs to know is
                // that the screen may be out of date, not that a request 500ed.
                'These records could not be updated just now, so what you see may be out of date.',
        );
      })
      .finally(() => setRefreshing(false));
  }, []);

  return { refreshing, onRefresh, notice, dismissNotice: useCallback(() => setNotice(null), []) };
};
