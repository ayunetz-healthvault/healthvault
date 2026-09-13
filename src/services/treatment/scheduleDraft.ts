/**
 * Helping somebody turn a medicine into a schedule, without deciding for them.
 *
 * The line this file walks: a prescription that says "twice a day" tells you
 * *how many* times, and says nothing whatever about *when*. Eight and eight is
 * a guess; eight and two is a guess; and a guess that becomes a reminder to
 * take a drug is the failure mode this whole module exists to avoid.
 *
 * So the frequency is read for a count and turned into a prompt — "choose two
 * times" — and never into times. Nothing here pre-selects a clock time, and
 * `timesFromFrequency` does not exist on purpose.
 */

/** `HH:mm`, 24-hour, with both parts in range. */
export const isValidTimeOfDay = (value: string): boolean => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) return false;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

/**
 * How many times a day a frequency asks for, when it says so unambiguously.
 *
 * Null for anything else — including "as needed", "before food" and every
 * phrasing not listed. A null here means the screen asks the person how often
 * rather than guessing, which is the right outcome for a field transcribed
 * from handwriting.
 */
export const dosesPerDayFrom = (frequency: string): number | null => {
  const text = frequency.trim().toLowerCase();
  if (text.length === 0) return null;

  // "As needed" is not a frequency. A schedule built from one would produce
  // reminders for doses that are, by definition, not due on a clock.
  if (/\b(as needed|sos|prn|when required|if needed)\b/.test(text)) return null;

  /**
   * Counted words first, then the bare "daily" fallback.
   *
   * Order matters and getting it wrong is not cosmetic: "thrice daily" matches
   * `daily` too, and testing that first read three doses a day as one.
   */
  if (/\b(four times|4 times|qds|qid)\b/.test(text)) return 4;
  if (/\b(thrice|three times|3 times|tds|tid)\b/.test(text)) return 3;
  if (/\b(twice|2 times|two times|bd|bid)\b/.test(text)) return 2;
  if (/\b(once|1 time|one time|od|daily|every day)\b/.test(text)) return 1;

  return null;
};

/**
 * The prompt shown above the time chooser.
 *
 * Quotes the prescription rather than paraphrasing it, so somebody comparing
 * the screen with the paper in their hand sees the same words.
 */
export const describeFrequency = (frequency: string): string => {
  const count = dosesPerDayFrom(frequency);

  if (count === null) {
    return frequency.trim().length === 0
      ? 'Choose the times you take this.'
      : `The prescription says “${frequency.trim()}”. Choose the times that means for you.`;
  }

  return `The prescription says “${frequency.trim()}” — choose ${
    count === 1 ? 'the time' : `the ${count === 2 ? 'two' : count === 3 ? 'three' : 'four'} times`
  } you take it.`;
};

export interface ScheduleDraftErrors {
  readonly name?: string | undefined;
  readonly times?: string | undefined;
  readonly startDate?: string | undefined;
}

export interface ScheduleDraftInput {
  readonly name: string;
  readonly times: string[];
  readonly startDate: string;
}

/**
 * What is still missing before this can be confirmed.
 *
 * A time is required, with no default. A schedule with no times is a medicine
 * nobody has said when they take — which is exactly the mention it came from,
 * and confirming it would add nothing but a false sense that it was decided.
 */
export const validateScheduleDraft = (draft: ScheduleDraftInput): ScheduleDraftErrors => {
  const errors: { name?: string; times?: string; startDate?: string } = {};

  if (draft.name.trim().length === 0) errors.name = 'Enter the name of the medicine.';

  if (draft.times.length === 0) {
    errors.times = 'Add at least one time. Nothing is scheduled until you choose when.';
  } else if (draft.times.some((time) => !isValidTimeOfDay(time))) {
    errors.times = 'Enter each time as HH:mm, for example 08:00.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) {
    errors.startDate = 'Enter the start date as YYYY-MM-DD.';
  }

  return errors;
};

/** Adds a time, keeping the list sorted and free of duplicates. */
export const withTime = (times: string[], candidate: string): string[] => {
  const time = candidate.trim();
  if (!isValidTimeOfDay(time) || times.includes(time)) return times;
  return [...times, time].sort();
};
