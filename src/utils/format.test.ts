import { avatarColorFor, formatBytes, initialsOf, maskEmail, pluralise, truncate } from './format';

import { avatarColors } from '@/theme';

describe('initialsOf', () => {
  it.each([
    ['Lakshmi Iyer', 'LI'],
    ['Ramesh', 'R'],
    ['ananya rao sharma', 'AS'],
  ])('turns %p into %p', (input, expected) => {
    expect(initialsOf(input)).toBe(expected);
  });

  it('falls back to a question mark for empty input', () => {
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('avatarColorFor', () => {
  it('always returns a colour from the palette', () => {
    expect(avatarColors).toContain(avatarColorFor('Lakshmi Iyer'));
  });

  it('is stable for the same name', () => {
    expect(avatarColorFor('Ramesh Iyer')).toBe(avatarColorFor('Ramesh Iyer'));
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 KB'],
    [512, '512 B'],
    [2048, '2 KB'],
    [1_572_864, '1.5 MB'],
  ])('formats %p as %p', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('handles nonsense input without throwing', () => {
    expect(formatBytes(Number.NaN)).toBe('0 KB');
  });
});

describe('pluralise', () => {
  it('uses the singular for one', () => {
    expect(pluralise(1, 'document')).toBe('1 document');
  });

  it('uses the plural otherwise', () => {
    expect(pluralise(0, 'document')).toBe('0 documents');
    expect(pluralise(3, 'document')).toBe('3 documents');
  });

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'person', 'people')).toBe('2 people');
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('Short title', 20)).toBe('Short title');
  });

  it('clips on a word boundary and adds an ellipsis', () => {
    const result = truncate('Quarterly diabetes panel report', 20);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe('maskEmail', () => {
  it('hides most of the local part', () => {
    expect(maskEmail('admin@ayunetz.in')).toBe('ad***@ayunetz.in');
  });

  it('leaves a non-email string untouched', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});

describe('pluralise — words ending in y', () => {
  it('pluralises a consonant-then-y word properly', () => {
    // "2 summarys" appeared on the account-deletion screen, which lists what
    // is about to be erased. Sloppy copy there reads as a sloppy product.
    expect(pluralise(2, 'summary')).toBe('2 summaries');
    expect(pluralise(1, 'summary')).toBe('1 summary');
  });

  it.each([
    [0, 'summary', '0 summaries'],
    [3, 'category', '3 categories'],
    [2, 'day', '2 days'],
    [2, 'key', '2 keys'],
  ])('pluralises %i %s as "%s"', (count, singular, expected) => {
    expect(pluralise(count, singular)).toBe(expected);
  });

  it('still lets an explicit plural win', () => {
    expect(pluralise(2, 'person', 'people')).toBe('2 people');
  });

  it('leaves the regular words the app already uses alone', () => {
    expect(pluralise(2, 'document')).toBe('2 documents');
    expect(pluralise(2, 'follow-up')).toBe('2 follow-ups');
    expect(pluralise(2, 'page')).toBe('2 pages');
    expect(pluralise(2, 'parent profile')).toBe('2 parent profiles');
  });
});
