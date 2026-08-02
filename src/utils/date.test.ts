import {
  byCreatedAtDesc,
  byDueDateAsc,
  calculateAge,
  daysUntil,
  describeDueDate,
  formatDate,
  formatTime,
  isOverdue,
  isValidIsoDate,
  isoToday,
  toCalendarDate,
} from './date';

// Fixed reference so "today" never drifts under the tests.
const REFERENCE = new Date('2026-07-30T12:00:00.000Z');

describe('isValidIsoDate', () => {
  it('accepts a well-formed calendar date', () => {
    expect(isValidIsoDate('2026-07-30')).toBe(true);
  });

  it.each(['30-07-2026', '2026/07/30', '2026-13-01', '', 'not a date'])('rejects %p', (value) => {
    expect(isValidIsoDate(value)).toBe(false);
  });
});

describe('formatDate', () => {
  it('uses a month name so DD/MM is never ambiguous', () => {
    expect(formatDate('2026-08-04')).toBe('4 Aug 2026');
  });

  it('falls back to a dash for unparseable input', () => {
    expect(formatDate('nonsense')).toBe('—');
  });
});

describe('formatTime', () => {
  it('renders a 24-hour string as a 12-hour clock', () => {
    expect(formatTime('14:30')).toBe('2:30 pm');
  });

  it('returns null when there is no time', () => {
    expect(formatTime(null)).toBeNull();
  });
});

describe('daysUntil', () => {
  it('is zero for today', () => {
    expect(daysUntil('2026-07-30', REFERENCE)).toBe(0);
  });

  it('is positive for a future date', () => {
    expect(daysUntil('2026-08-02', REFERENCE)).toBe(3);
  });

  it('is negative for a past date', () => {
    expect(daysUntil('2026-07-27', REFERENCE)).toBe(-3);
  });
});

describe('describeDueDate', () => {
  it.each([
    ['2026-07-30', 'Today'],
    ['2026-07-31', 'Tomorrow'],
    ['2026-07-29', 'Yesterday'],
    ['2026-08-02', 'In 3 days'],
    ['2026-07-27', '3 days ago'],
  ])('describes %p as %p', (input, expected) => {
    expect(describeDueDate(input, REFERENCE)).toBe(expected);
  });

  it('falls back to an absolute date beyond a month out', () => {
    expect(describeDueDate('2026-12-25', REFERENCE)).toBe('25 Dec 2026');
  });
});

describe('isOverdue', () => {
  it('is false on the due date itself', () => {
    expect(isOverdue('2026-07-30', REFERENCE)).toBe(false);
  });

  it('is true once the date has passed', () => {
    expect(isOverdue('2026-07-29', REFERENCE)).toBe(true);
  });
});

describe('calculateAge', () => {
  it('counts whole years', () => {
    expect(calculateAge('1955-04-18', REFERENCE)).toBe(71);
  });

  it('has not counted a birthday that is still ahead this year', () => {
    expect(calculateAge('1955-12-01', REFERENCE)).toBe(70);
  });

  it('returns null when the date of birth is unknown', () => {
    expect(calculateAge(null, REFERENCE)).toBeNull();
  });

  it('returns null for an unparseable date of birth', () => {
    expect(calculateAge('not-a-date', REFERENCE)).toBeNull();
  });
});

describe('isoToday', () => {
  it('returns a valid calendar date', () => {
    expect(isValidIsoDate(isoToday())).toBe(true);
  });

  it('offsets by whole days', () => {
    const today = new Date(`${isoToday()}T00:00:00.000Z`).getTime();
    const inAWeek = new Date(`${isoToday(7)}T00:00:00.000Z`).getTime();
    expect(inAWeek - today).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('toCalendarDate', () => {
  it('applies the supplied time', () => {
    const result = toCalendarDate('2026-08-04', '14:30');
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(30);
  });

  it('defaults to 09:00 when no time is given', () => {
    const result = toCalendarDate('2026-08-04', null);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
  });
});

describe('sort comparators', () => {
  it('orders due dates soonest first', () => {
    const items = [{ dueDate: '2026-09-01' }, { dueDate: '2026-08-01' }, { dueDate: '2026-08-15' }];
    expect(items.sort(byDueDateAsc).map((item) => item.dueDate)).toEqual([
      '2026-08-01',
      '2026-08-15',
      '2026-09-01',
    ]);
  });

  it('orders timestamps newest first', () => {
    const items = [
      { createdAt: '2026-01-01T00:00:00.000Z' },
      { createdAt: '2026-07-01T00:00:00.000Z' },
      { createdAt: '2026-04-01T00:00:00.000Z' },
    ];
    expect(items.sort(byCreatedAtDesc).map((item) => item.createdAt)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });
});
