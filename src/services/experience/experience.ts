import type { Density } from '@/theme';

/**
 * Which of the two experiences an account sees.
 *
 * The reference prototype has a "Compare views" switch that flips between a
 * caregiver's phone and a parent's phone. That control is a design-review
 * surface and must not ship: in production the two experiences differ in what
 * they are *allowed to read*, so a switch between them would either be a lie
 * (same data, different chrome) or an impersonation control.
 *
 * So this resolves from the account's own relationship to records, and there is
 * deliberately no setter. See `docs/koode/DESIGN.md` → "Main user experience".
 */
export type Experience = 'caregiver' | 'parent';

export interface ExperienceInputs {
  /**
   * True when this account is the subject of a record it holds itself — the
   * `self` role in the grant model, not a profile somebody created *about*
   * them.
   */
  readonly hasSelfRecord: boolean;
  /**
   * How many records belonging to *other* people this account holds a grant on.
   * Zero for a parent who has not accepted any helper.
   */
  readonly managedRecordCount: number;
}

/**
 * The rule, stated once.
 *
 * | self record | manages others | experience  |
 * | ----------- | -------------- | ----------- |
 * | yes         | no             | parent      |
 * | yes         | yes            | parent      |
 * | no          | yes            | caregiver   |
 * | no          | no             | caregiver   |
 *
 * The interesting row is the second. Someone can be both a patient and a helper
 * — a daughter managing her mother's records who also has her own — and the
 * home screen has to pick one. It picks their own health, because the cost of
 * getting it wrong is asymmetric: a helper who lands on their own Today screen
 * reaches the family in one tap, while a patient who lands on a family
 * dashboard has to hunt for themselves among the people they help.
 *
 * The people they help are not hidden either way; they are the Family tab. That
 * is why `managedRecordCount` is part of the stated rule but does not appear in
 * the expression: it distinguishes rows that happen to share an answer, and the
 * tests name both rows so a later change to one cannot silently move the other.
 *
 * The last row is a new account that has neither. It gets the caregiver shell,
 * whose first-use state asks who the app is for — and answering that creates a
 * record, which is what moves the account to a different row here. Nothing
 * about this function grants access; it only decides which home screen renders.
 */
export const resolveExperience = (inputs: ExperienceInputs): Experience =>
  inputs.hasSelfRecord ? 'parent' : 'caregiver';

/**
 * Reading density for an experience.
 *
 * The parent's own screens are set larger — see `density` in the theme. This is
 * the only behavioural difference the experience is allowed to imply on its
 * own; everything else follows from grants.
 */
export const densityFor = (experience: Experience): Density =>
  experience === 'parent' ? 'comfortable' : 'standard';

/** Where each experience's home screen lives. */
export const homeRouteFor = (experience: Experience): '/care' | '/me' =>
  experience === 'parent' ? '/me' : '/care';
