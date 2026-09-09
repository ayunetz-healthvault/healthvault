import { densityFor, resolveExperience, type Experience } from './experience';

import { useSessionStore } from '@/state/sessionStore';
import { useVaultStore } from '@/state/vaultStore';
import type { Density } from '@/theme';

export interface ResolvedExperience {
  experience: Experience;
  density: Density;
  /** The record the signed-in account is the subject of, when it has one. */
  selfRecordId: string | null;
}

/**
 * The signed-in account's experience, derived rather than chosen.
 *
 * Reads only from state the account cannot assert about itself: which record it
 * is the subject of (set from the server's grant answer) and how many other
 * records it can reach. There is no setter here and no preference behind it.
 */
export const useExperience = (): ResolvedExperience => {
  const selfRecordId = useSessionStore((state) => state.selfRecordId);
  const parentCount = useVaultStore((state) => state.parents.length);

  const experience = resolveExperience({
    hasSelfRecord: selfRecordId !== null,
    managedRecordCount: selfRecordId === null ? parentCount : Math.max(parentCount - 1, 0),
  });

  return { experience, density: densityFor(experience), selfRecordId };
};
