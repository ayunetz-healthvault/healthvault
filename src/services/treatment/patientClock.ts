/**
 * What day it is *for the patient*.
 *
 * Every dose question is asked in the patient's zone, not the reader's. A
 * daughter in Berlin opening her mother's record at 22:00 is looking at her
 * mother's tomorrow, and a screen that used the device's date would ask her
 * whether a tablet due in six hours had been taken.
 *
 * The default is India because that is who the app is for, and it is a
 * *default*, not an assumption: a schedule stores its own zone and this is only
 * consulted when creating one or when there is no schedule to ask.
 */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** The local calendar date in a named zone, as `YYYY-MM-DD`. */
export const localDateIn = (timezone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** The local wall-clock time in a named zone, as `HH:mm`. */
export const localTimeIn = (timezone: string, now: Date = new Date()): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
};

/**
 * A dose time as a person reads it, with the zone named when it is not theirs.
 *
 * The zone is spelled out rather than abbreviated: "IST" is ambiguous (India
 * and Israel both claim it) and a caregiver reading a time for a medicine
 * should not have to guess.
 */
export const formatDoseTime = (
  isoInstant: string,
  timezone: string,
  options: { showZone?: boolean } = {},
): string => {
  const rendered = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoInstant));

  return options.showZone === true ? `${rendered} (${timezone.split('/').pop() ?? timezone})` : rendered;
};
