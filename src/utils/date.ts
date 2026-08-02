import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import type { IsoDate, IsoDateTime } from '@/types/domain';

dayjs.extend(relativeTime);

/**
 * Date helpers.
 *
 * The whole app deals with two audiences on two clocks: a caregiver abroad and
 * a parent in India. Follow-up dates are therefore stored as plain calendar
 * dates (`YYYY-MM-DD`), not instants — "the 4th" means the 4th in Chennai
 * regardless of where the person reading the screen happens to be.
 */

export const nowIso = (): IsoDateTime => new Date().toISOString();

export const toIsoDate = (value: Date): IsoDate => dayjs(value).format('YYYY-MM-DD');

export const parseIsoDate = (value: IsoDate): Date => dayjs(value, 'YYYY-MM-DD').toDate();

/**
 * Strict `YYYY-MM-DD` check.
 *
 * `dayjs('2026-13-01').isValid()` is true — it rolls the month over into the
 * next year — so the parsed date is formatted back and compared, which rejects
 * both an impossible month and a 31st of February.
 */
export const isValidIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dayjs(value);
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === value;
};

/** `4 Aug 2026` — month names avoid the DD/MM vs MM/DD ambiguity entirely. */
export const formatDate = (value: IsoDate | IsoDateTime): string => {
  const d = dayjs(value);
  return d.isValid() ? d.format('D MMM YYYY') : '—';
};

/** `4 Aug 2026, 10:30 am`. */
export const formatDateTime = (value: IsoDateTime): string => {
  const d = dayjs(value);
  return d.isValid() ? d.format('D MMM YYYY, h:mm a') : '—';
};

/** `10:30 am` from an `HH:mm` string. */
export const formatTime = (value: string | null): string | null => {
  if (!value) return null;
  const d = dayjs(`2000-01-01T${value}`);
  return d.isValid() ? d.format('h:mm a') : null;
};

/** Whole days from today to `value`. Negative means the date has passed. */
export const daysUntil = (value: IsoDate, from: Date = new Date()): number =>
  dayjs(value).startOf('day').diff(dayjs(from).startOf('day'), 'day');

/**
 * Short, human phrasing for a due date. Deliberately plain: "In 3 days" beats
 * "in 3 days' time" for someone skimming a dashboard at 6am.
 */
export const describeDueDate = (value: IsoDate, from: Date = new Date()): string => {
  const days = daysUntil(value, from);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days <= 30) return `In ${days} days`;
  if (days < -1 && days >= -30) return `${Math.abs(days)} days ago`;
  return formatDate(value);
};

export const isOverdue = (value: IsoDate, from: Date = new Date()): boolean =>
  daysUntil(value, from) < 0;

/** Age in whole years, or null when the date of birth is unknown. */
export const calculateAge = (
  dateOfBirth: IsoDate | null,
  from: Date = new Date(),
): number | null => {
  if (!dateOfBirth || !isValidIsoDate(dateOfBirth)) return null;
  const years = dayjs(from).diff(dayjs(dateOfBirth), 'year');
  return years >= 0 && years < 130 ? years : null;
};

/** `YYYY-MM-DD` for today, or offset by `days`. */
export const isoToday = (days = 0): IsoDate => dayjs().add(days, 'day').format('YYYY-MM-DD');

/**
 * Combines a calendar date and an optional `HH:mm` into a JS Date, used only
 * when writing a device-calendar event. Defaults to 09:00 local.
 */
export const toCalendarDate = (date: IsoDate, time: string | null): Date => {
  const [hours, minutes] = (time ?? '09:00').split(':');
  return dayjs(date)
    .hour(Number(hours ?? 9))
    .minute(Number(minutes ?? 0))
    .second(0)
    .millisecond(0)
    .toDate();
};

/** Sorts ascending by due date; used for the dashboard's "next up" list. */
export const byDueDateAsc = <T extends { dueDate: IsoDate }>(a: T, b: T): number =>
  a.dueDate.localeCompare(b.dueDate);

/** Sorts descending by an ISO timestamp field; used for the document timeline. */
export const byCreatedAtDesc = <T extends { createdAt: IsoDateTime }>(a: T, b: T): number =>
  b.createdAt.localeCompare(a.createdAt);
