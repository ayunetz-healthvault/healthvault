import {
  describeFrequency,
  dosesPerDayFrom,
  isValidTimeOfDay,
  validateScheduleDraft,
  withTime,
} from './scheduleDraft';

/**
 * Helping somebody choose times, without choosing for them.
 *
 * The rule under test throughout: a frequency says how many times a day, and
 * nothing at all about when. Anything that turned "twice a day" into 08:00 and
 * 20:00 would be this app making a clinical decision from handwriting.
 */

describe('reading a frequency', () => {
  it.each([
    ['Once a day', 1],
    ['OD', 1],
    ['Twice a day after food', 2],
    ['BD', 2],
    ['Thrice daily', 3],
    ['TDS', 3],
    ['Four times a day', 4],
  ])('reads %s as %i doses', (frequency, expected) => {
    expect(dosesPerDayFrom(frequency)).toBe(expected);
  });

  /**
   * "As needed" is not a frequency. A schedule built from one would produce
   * reminders for doses that are, by definition, not due at a time.
   */
  it.each(['As needed', 'SOS', 'PRN', 'When required'])('refuses to count "%s"', (frequency) => {
    expect(dosesPerDayFrom(frequency)).toBeNull();
  });

  it('gives up on anything it does not recognise', () => {
    expect(dosesPerDayFrom('Alternate days, morning')).toBeNull();
    expect(dosesPerDayFrom('')).toBeNull();
  });
});

describe('the prompt above the time chooser', () => {
  it('quotes the prescription rather than paraphrasing it', () => {
    expect(describeFrequency('Twice a day after food')).toContain('“Twice a day after food”');
  });

  it('asks for the right number of times', () => {
    expect(describeFrequency('BD')).toContain('two times');
  });

  it('asks plainly when it cannot tell', () => {
    expect(describeFrequency('Alternate days')).toContain('Choose the times');
  });
});

describe('a time of day', () => {
  it.each(['00:00', '08:00', '23:59'])('accepts %s', (time) => {
    expect(isValidTimeOfDay(time)).toBe(true);
  });

  it.each(['8:00', '24:00', '08:60', 'morning', ''])('rejects %s', (time) => {
    expect(isValidTimeOfDay(time)).toBe(false);
  });
});

describe('collecting the times', () => {
  it('keeps them sorted', () => {
    expect(withTime(withTime([], '20:00'), '08:00')).toEqual(['08:00', '20:00']);
  });

  it('ignores a duplicate rather than scheduling two doses at once', () => {
    expect(withTime(['08:00'], '08:00')).toEqual(['08:00']);
  });

  it('ignores anything that is not a time', () => {
    expect(withTime(['08:00'], 'morning')).toEqual(['08:00']);
  });
});

describe('what has to be true before confirming', () => {
  const valid = { name: 'Metformin', times: ['08:00'], startDate: '2026-09-08' };

  it('accepts a complete draft', () => {
    expect(validateScheduleDraft(valid)).toEqual({});
  });

  /**
   * The important one. A schedule with no times is the mention it came from,
   * and confirming it would add nothing but the appearance of a decision.
   */
  it('refuses a schedule with no times', () => {
    expect(validateScheduleDraft({ ...valid, times: [] }).times).toContain('at least one time');
  });

  it('refuses a medicine with no name', () => {
    expect(validateScheduleDraft({ ...valid, name: '  ' }).name).toBeDefined();
  });

  it('refuses a start date that is not a date', () => {
    expect(validateScheduleDraft({ ...valid, startDate: 'today' }).startDate).toBeDefined();
  });
});
