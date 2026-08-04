import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import type { FollowUp, ParentProfile } from '@/types/domain';
import { FOLLOW_UP_KIND_LABELS } from '@/types/labels';
import { toCalendarDate } from '@/utils/date';

/**
 * Device-calendar integration.
 *
 * ## Consent model
 * Writing to somebody's personal calendar is intrusive, so this service never
 * writes on its own initiative. Two gates must both be open:
 *
 *   1. `privacy.calendarSyncEnabled` — the standing setting, off by default.
 *   2. A per-event confirmation dialog showing the exact title, date, time and
 *      target calendar, which the user has to accept.
 *
 * `addFollowUpToCalendar` is only ever called from the confirmation handler.
 * Nothing in the app calls it in the background.
 */

export type CalendarPermission = 'granted' | 'denied' | 'undetermined';

export interface CalendarTarget {
  id: string;
  title: string;
  /** e.g. "Google — ananya@gmail.com". Shown so the user knows where it lands. */
  sourceName: string;
}

export interface CalendarEventPreview {
  title: string;
  startDate: Date;
  endDate: Date;
  notes: string;
  location: string;
  /** Minutes before the event. */
  reminderMinutes: number;
}

export type CalendarWriteResult =
  | { status: 'created'; eventId: string; calendarTitle: string }
  | { status: 'permission_denied' }
  | { status: 'no_writable_calendar' }
  /** This platform has no calendar to write to — the web preview, chiefly. */
  | { status: 'unavailable' }
  | { status: 'failed'; message: string };

/**
 * Whether there is a device calendar at all.
 *
 * On web there is not, and `expo-calendar`'s permission request never settles
 * there — it neither resolves nor rejects. Awaiting it leaves the confirmation
 * dialog spinning forever with no error and no way out but Cancel, which is
 * exactly what happened in the browser preview.
 */
const isCalendarAvailable = (): boolean => Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Generous, because a permission prompt waits on a human.
 *
 * This is defence in depth rather than the fix for any known bug: a native call
 * that never returns must not be able to strand the UI indefinitely.
 */
const CALL_TIMEOUT_MS = 45_000;

class CalendarTimeoutError extends Error {
  constructor() {
    super('The calendar did not respond.');
    this.name = 'CalendarTimeoutError';
  }
}

const withTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  // The handle is cleared in `finally`, not left to expire. A pending 45-second
  // timer per call keeps the event loop alive — Jest noticed before a user
  // would have, but on a phone it is a wakeful app holding a timer for nothing.
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CalendarTimeoutError()), CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** Default appointment length; long enough to be useful, short enough to move. */
const DEFAULT_DURATION_MINUTES = 60;
/** A day's notice beats an hour's when the appointment is in another country. */
const DEFAULT_REMINDER_MINUTES = 24 * 60;

export const calendarService = {
  /** Whether this device has a calendar the app could write to. */
  isAvailable(): boolean {
    return isCalendarAvailable();
  },

  async getPermission(): Promise<CalendarPermission> {
    if (!isCalendarAvailable()) return 'denied';

    try {
      const { status } = await withTimeout(Calendar.getCalendarPermissionsAsync());
      if (status === 'granted') return 'granted';
      if (status === 'denied') return 'denied';
      return 'undetermined';
    } catch {
      // Treated as denied rather than thrown: a settings screen reading this
      // must render, not crash.
      return 'denied';
    }
  },

  async requestPermission(): Promise<CalendarPermission> {
    if (!isCalendarAvailable()) return 'denied';

    try {
      const { status } = await withTimeout(Calendar.requestCalendarPermissionsAsync());
      return status === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  },

  /** Calendars the app is actually allowed to write into. */
  async getWritableCalendars(): Promise<CalendarTarget[]> {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return calendars
      .filter((calendar) => calendar.allowsModifications)
      .map((calendar) => ({
        id: calendar.id,
        title: calendar.title,
        sourceName: calendar.source?.name ?? 'Device',
      }));
  },

  async getDefaultCalendarId(): Promise<string | null> {
    if (Platform.OS === 'ios') {
      const calendar = await Calendar.getDefaultCalendarAsync();
      return calendar?.id ?? null;
    }
    const writable = await calendarService.getWritableCalendars();
    return writable[0]?.id ?? null;
  },

  /**
   * Builds exactly what will be written, so the confirmation dialog can show
   * the user the real thing rather than a paraphrase.
   */
  buildEventPreview(followUp: FollowUp, parent: ParentProfile | undefined): CalendarEventPreview {
    const startDate = toCalendarDate(followUp.dueDate, followUp.dueTime);
    const endDate = new Date(startDate.getTime() + DEFAULT_DURATION_MINUTES * 60 * 1000);
    const who = parent?.fullName ?? 'your parent';

    const noteLines = [
      `${FOLLOW_UP_KIND_LABELS[followUp.kind]} for ${who}.`,
      followUp.notes.trim(),
      parent?.primaryDoctor ? `Doctor: ${parent.primaryDoctor}` : '',
      'Added by Ayunetz Health Vault.',
    ].filter((line) => line.length > 0);

    return {
      title: `${followUp.title} — ${who}`,
      startDate,
      endDate,
      notes: noteLines.join('\n\n'),
      location: parent?.city ?? '',
      reminderMinutes: DEFAULT_REMINDER_MINUTES,
    };
  },

  /**
   * Writes the event. Call ONLY after the user has confirmed the preview.
   */
  async addFollowUpToCalendar(
    followUp: FollowUp,
    parent: ParentProfile | undefined,
    calendarId?: string,
  ): Promise<CalendarWriteResult> {
    if (!isCalendarAvailable()) return { status: 'unavailable' };

    // The whole sequence is guarded, not just the write. Looking up permission
    // and the default calendar are device calls too, and an unhandled throw in
    // any of them leaves the caller's spinner running with nothing to show.
    try {
      let permission = await calendarService.getPermission();
      if (permission !== 'granted') {
        permission = await calendarService.requestPermission();
      }
      if (permission !== 'granted') return { status: 'permission_denied' };

      const targetId = calendarId ?? (await calendarService.getDefaultCalendarId());
      if (!targetId) return { status: 'no_writable_calendar' };

      const writable = await calendarService.getWritableCalendars();
      const target = writable.find((calendar) => calendar.id === targetId);

      const preview = calendarService.buildEventPreview(followUp, parent);

      const eventId = await withTimeout(
        Calendar.createEventAsync(targetId, {
          title: preview.title,
          startDate: preview.startDate,
          endDate: preview.endDate,
          notes: preview.notes,
          location: preview.location,
          alarms: [{ relativeOffset: -preview.reminderMinutes }],
          availability: Calendar.Availability.BUSY,
          // Appointments are in the parent's local time, which is where the
          // appointment physically happens.
          timeZone: 'Asia/Kolkata',
        }),
      );

      return { status: 'created', eventId, calendarTitle: target?.title ?? 'your calendar' };
    } catch (error) {
      return {
        status: 'failed',
        message:
          error instanceof CalendarTimeoutError
            ? 'Your calendar did not respond, so nothing was added. Please try again.'
            : error instanceof Error
              ? error.message
              : 'Could not add the event.',
      };
    }
  },

  /** Used when a follow-up is deleted or cancelled. Failure is non-fatal. */
  async removeEvent(eventId: string): Promise<boolean> {
    try {
      await Calendar.deleteEventAsync(eventId);
      return true;
    } catch {
      return false;
    }
  },
};
