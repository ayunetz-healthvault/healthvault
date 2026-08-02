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
  | { status: 'failed'; message: string };

/** Default appointment length; long enough to be useful, short enough to move. */
const DEFAULT_DURATION_MINUTES = 60;
/** A day's notice beats an hour's when the appointment is in another country. */
const DEFAULT_REMINDER_MINUTES = 24 * 60;

export const calendarService = {
  async getPermission(): Promise<CalendarPermission> {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  },

  async requestPermission(): Promise<CalendarPermission> {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
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

    try {
      const eventId = await Calendar.createEventAsync(targetId, {
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
      });
      return { status: 'created', eventId, calendarTitle: target?.title ?? 'your calendar' };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Could not add the event.',
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
