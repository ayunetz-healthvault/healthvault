import { create } from 'zustand';

import type { Grant, GrantRole } from '@/types/access';

/**
 * What this account may do with each record it can reach.
 *
 * Deliberately **not** persisted. A role cached on the device and read on the
 * next cold start would show a revoked helper their old permissions until the
 * first request failed — and the first thing they would see is a record they no
 * longer have. Roles come from the server on every sync, and until they do the
 * app has no opinion.
 *
 * This decides what to *draw*. It never decides what may be read: the backend
 * checks the grant on every request.
 */

interface AccessState {
  /** Role per patient, as of the last sync. */
  roles: Record<string, GrantRole>;
  /** Who else can reach each record, when it has been looked up. */
  grants: Record<string, Grant[]>;

  setRoles: (roles: Record<string, GrantRole>) => void;
  setGrants: (patientId: string, grants: Grant[]) => void;
  /** Drops everything about a record this account can no longer reach. */
  forgetPatient: (patientId: string) => void;
  clear: () => void;
}

export const useAccessStore = create<AccessState>()((set) => ({
  roles: {},
  grants: {},

  setRoles: (roles) => set({ roles }),

  setGrants: (patientId, grants) =>
    set((state) => ({ grants: { ...state.grants, [patientId]: grants } })),

  forgetPatient: (patientId) =>
    set((state) => {
      const { [patientId]: removedRole, ...roles } = state.roles;
      const { [patientId]: removedGrants, ...grants } = state.grants;
      void removedRole;
      void removedGrants;
      return { roles, grants };
    }),

  clear: () => set({ roles: {}, grants: {} }),
}));

/**
 * The role this account holds on a record, or null.
 *
 * Null means "not known yet", which is different from "no access" and must be
 * rendered as such: a screen that treats an unknown role as read-only hides
 * controls from somebody who has every right to them, and one that treats it as
 * full access shows controls that will fail.
 */
export const selectRole = (state: AccessState, patientId: string): GrantRole | null =>
  state.roles[patientId] ?? null;
