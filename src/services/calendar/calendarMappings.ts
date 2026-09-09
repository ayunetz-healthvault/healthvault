import { currentVaultAccountId } from '@/services/storage/activeVault';
import { createEncryptedStore } from '@/services/storage/encryptedStore';
import { nowIso } from '@/utils/date';

/**
 * Which device calendar event, if any, corresponds to which follow-up.
 *
 * ## Why this is not a field on the follow-up
 *
 * It used to be: `FollowUp.calendarEventId`. That field is part of the shared
 * record, and a device calendar event id means nothing on any device but the
 * one that created it.
 *
 * The consequences were both wrong in different directions. A caregiver in
 * Berlin who added a visit to *her* calendar made the follow-up look already
 * added to her brother in Chennai, who then had no reminder. And if he added it
 * anyway, his event id overwrote hers, so cancelling the visit deleted nothing
 * on her phone.
 *
 * A calendar event is a fact about one device, so it is stored on that device,
 * encrypted, under the account that made it.
 */

const MAPPINGS_KEY = 'calendar-mappings';

export interface CalendarMapping {
  readonly followUpId: string;
  /** The device calendar the event was written into. */
  readonly calendarId: string;
  readonly eventId: string;
  readonly createdAt: string;
  /** What was written, so the user can be shown it again without guessing. */
  readonly title: string;
}

export interface CalendarMappings {
  all(): Promise<CalendarMapping[]>;
  /** The event for this follow-up on this device, if there is one. */
  find(followUpId: string): Promise<CalendarMapping | null>;
  remember(mapping: Omit<CalendarMapping, 'createdAt'>): Promise<void>;
  forget(followUpId: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The mappings for whoever is signed in, or null when nobody is.
 *
 * So a screen can ask "does this phone have an event for this task" without
 * knowing which account's store to look in — the same shape as
 * `currentSyncService`.
 */
export const currentCalendarMappings = (): CalendarMappings | null => {
  const accountId = currentVaultAccountId();
  return accountId === null ? null : createCalendarMappings(accountId);
};

export const createCalendarMappings = (accountId: string): CalendarMappings => {
  const store = createEncryptedStore(accountId);

  const read = async (): Promise<CalendarMapping[]> =>
    (await store.read<CalendarMapping[]>(MAPPINGS_KEY)) ?? [];

  return {
    all: read,

    async find(followUpId) {
      return (await read()).find((mapping) => mapping.followUpId === followUpId) ?? null;
    },

    async remember(mapping) {
      const existing = await read();
      await store.write(MAPPINGS_KEY, [
        // One event per follow-up per device. Replacing rather than appending
        // is what stops a retried "add to calendar" leaving two events and only
        // one of them removable.
        ...existing.filter((entry) => entry.followUpId !== mapping.followUpId),
        { ...mapping, createdAt: nowIso() },
      ]);
    },

    async forget(followUpId) {
      await store.write(
        MAPPINGS_KEY,
        (await read()).filter((mapping) => mapping.followUpId !== followUpId),
      );
    },

    async clear() {
      await store.remove(MAPPINGS_KEY);
    },
  };
};

/**
 * How much of a health record may go into a calendar entry.
 *
 * A calendar event is not private. It shows on a lock screen, syncs to whatever
 * the user's calendar syncs to, and is visible to anybody they share a calendar
 * with — a spouse, an employer, a family account. So the default is the
 * minimum that still makes the entry useful, and anything more is a deliberate
 * choice the user makes and can see before it is written.
 */
export type CalendarDetail =
  /** "Appointment" and a time. Nothing about who, or what for. */
  | 'minimal'
  /** Adds the person's first name and the kind of appointment. */
  | 'standard';

export const DEFAULT_CALENDAR_DETAIL: CalendarDetail = 'minimal';

export const describeCalendarDetail = (detail: CalendarDetail): string =>
  detail === 'minimal'
    ? 'Only “Appointment” and the time. Nothing about who it is for or what it is about.'
    : 'The person’s first name and the kind of appointment. Still no conditions, medicines or doctor’s name.';
