import { isValidIsoDate } from './date';

import type { FollowUpDraft, ParentDraft } from '@/types/domain';

/**
 * Form validation.
 *
 * Errors are keyed by field name so screens can render them inline next to the
 * offending input rather than in a single alert — much easier to act on,
 * especially at a larger accessibility text size.
 */

export type ValidationErrors<T> = Partial<Record<keyof T, string>>;

export interface ValidationResult<T> {
  valid: boolean;
  errors: ValidationErrors<T>;
}

/** Accepts +91 forms as well as bare 10-digit Indian mobile numbers. */
const PHONE_PATTERN = /^(\+?\d{1,3}[\s-]?)?\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isValidPhone = (value: string): boolean =>
  PHONE_PATTERN.test(value.replace(/[\s-]/g, ''));

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export const validateParentDraft = (draft: ParentDraft): ValidationResult<ParentDraft> => {
  const errors: ValidationErrors<ParentDraft> = {};

  const name = draft.fullName.trim();
  if (name.length === 0) {
    errors.fullName = 'Please enter a name.';
  } else if (name.length < 2) {
    errors.fullName = 'Name is too short.';
  } else if (name.length > 80) {
    errors.fullName = 'Name is too long (80 characters max).';
  }

  if (draft.dateOfBirth) {
    if (!isValidIsoDate(draft.dateOfBirth)) {
      errors.dateOfBirth = 'Enter the date as YYYY-MM-DD.';
    } else if (new Date(draft.dateOfBirth).getTime() > Date.now()) {
      errors.dateOfBirth = 'Date of birth cannot be in the future.';
    }
  }

  if (draft.phone.trim().length > 0 && !isValidPhone(draft.phone)) {
    errors.phone = 'Enter a 10-digit number, optionally with a country code.';
  }

  if (draft.city.trim().length > 60) {
    errors.city = 'City name is too long.';
  }

  if (draft.notes.length > 1000) {
    errors.notes = 'Notes are limited to 1000 characters.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
};

export const validateFollowUpDraft = (draft: FollowUpDraft): ValidationResult<FollowUpDraft> => {
  const errors: ValidationErrors<FollowUpDraft> = {};

  const title = draft.title.trim();
  if (title.length === 0) {
    errors.title = 'Give this follow-up a short title.';
  } else if (title.length > 100) {
    errors.title = 'Title is too long (100 characters max).';
  }

  if (!draft.parentId) {
    errors.parentId = 'Choose who this follow-up is for.';
  }

  if (!isValidIsoDate(draft.dueDate)) {
    errors.dueDate = 'Choose a due date.';
  }

  if (draft.dueTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.dueTime)) {
    errors.dueTime = 'Enter the time as HH:mm.';
  }

  if (draft.notes.length > 500) {
    errors.notes = 'Notes are limited to 500 characters.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
};

/** Trims and collapses runs of whitespace — used before persisting free text. */
export const normaliseText = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Splits a comma or newline separated field into a clean list. */
export const parseList = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((entry) => normaliseText(entry))
    .filter((entry) => entry.length > 0);
