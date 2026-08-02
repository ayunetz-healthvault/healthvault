import {
  isValidEmail,
  isValidPhone,
  normaliseText,
  parseList,
  validateFollowUpDraft,
  validateParentDraft,
} from './validation';

import type { FollowUpDraft, ParentDraft } from '@/types/domain';

const parentDraft = (overrides: Partial<ParentDraft> = {}): ParentDraft => ({
  fullName: 'Lakshmi Iyer',
  relationship: 'mother',
  dateOfBirth: '1955-04-18',
  bloodGroup: 'B+',
  city: 'Chennai',
  phone: '+91 98400 12345',
  conditions: [],
  allergies: [],
  primaryDoctor: '',
  notes: '',
  ...overrides,
});

const followUpDraft = (overrides: Partial<FollowUpDraft> = {}): FollowUpDraft => ({
  parentId: 'par_1',
  title: 'Review lab report',
  kind: 'doctor_visit',
  dueDate: '2026-08-06',
  dueTime: '10:30',
  notes: '',
  sourceDocumentId: null,
  doctorCategory: null,
  ...overrides,
});

describe('isValidPhone', () => {
  it.each(['9840012345', '+91 98400 12345', '+91-98400-12345', '098400 12345'])(
    'accepts %p',
    (value) => {
      expect(isValidPhone(value)).toBe(true);
    },
  );

  it.each(['12345', 'not a phone', '+91 98400 123456789'])('rejects %p', (value) => {
    expect(isValidPhone(value)).toBe(false);
  });
});

describe('isValidEmail', () => {
  it.each(['admin@ayunetz.in', 'a.b+c@example.co.uk'])('accepts %p', (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each(['no-at-sign', 'missing@domain', '@example.com', 'spaces @example.com'])(
    'rejects %p',
    (value) => {
      expect(isValidEmail(value)).toBe(false);
    },
  );
});

describe('validateParentDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateParentDraft(parentDraft())).toEqual({ valid: true, errors: {} });
  });

  it('requires a name', () => {
    const result = validateParentDraft(parentDraft({ fullName: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.fullName).toBe('Please enter a name.');
  });

  it('rejects a one-character name', () => {
    expect(validateParentDraft(parentDraft({ fullName: 'L' })).errors.fullName).toBe(
      'Name is too short.',
    );
  });

  it('treats an absent date of birth as valid', () => {
    expect(validateParentDraft(parentDraft({ dateOfBirth: null })).valid).toBe(true);
  });

  it('rejects a malformed date of birth', () => {
    expect(validateParentDraft(parentDraft({ dateOfBirth: '18/04/1955' })).errors.dateOfBirth).toBe(
      'Enter the date as YYYY-MM-DD.',
    );
  });

  it('rejects a date of birth in the future', () => {
    expect(validateParentDraft(parentDraft({ dateOfBirth: '2099-01-01' })).errors.dateOfBirth).toBe(
      'Date of birth cannot be in the future.',
    );
  });

  it('allows an empty phone number but rejects a malformed one', () => {
    expect(validateParentDraft(parentDraft({ phone: '' })).valid).toBe(true);
    expect(validateParentDraft(parentDraft({ phone: '123' })).errors.phone).toBeDefined();
  });

  it('caps the notes length', () => {
    expect(
      validateParentDraft(parentDraft({ notes: 'x'.repeat(1001) })).errors.notes,
    ).toBeDefined();
  });
});

describe('validateFollowUpDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateFollowUpDraft(followUpDraft())).toEqual({ valid: true, errors: {} });
  });

  it('requires a title', () => {
    expect(validateFollowUpDraft(followUpDraft({ title: '' })).errors.title).toBe(
      'Give this follow-up a short title.',
    );
  });

  it('requires a parent', () => {
    expect(validateFollowUpDraft(followUpDraft({ parentId: '' })).errors.parentId).toBe(
      'Choose who this follow-up is for.',
    );
  });

  it('requires a valid due date', () => {
    expect(validateFollowUpDraft(followUpDraft({ dueDate: '6th August' })).errors.dueDate).toBe(
      'Choose a due date.',
    );
  });

  it('allows a null time but rejects a malformed one', () => {
    expect(validateFollowUpDraft(followUpDraft({ dueTime: null })).valid).toBe(true);
    expect(validateFollowUpDraft(followUpDraft({ dueTime: '25:00' })).errors.dueTime).toBeDefined();
    expect(
      validateFollowUpDraft(followUpDraft({ dueTime: '10:30 am' })).errors.dueTime,
    ).toBeDefined();
  });
});

describe('normaliseText', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseText('  Type   2    diabetes  ')).toBe('Type 2 diabetes');
  });
});

describe('parseList', () => {
  it('splits on commas and newlines and drops empties', () => {
    expect(parseList('Diabetes, Hypertension\n\nAsthma,')).toEqual([
      'Diabetes',
      'Hypertension',
      'Asthma',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseList('   ')).toEqual([]);
  });
});
