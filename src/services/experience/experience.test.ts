import { densityFor, homeRouteFor, resolveExperience } from './experience';

describe('resolveExperience', () => {
  it('gives a parent with only their own record the parent experience', () => {
    expect(resolveExperience({ hasSelfRecord: true, managedRecordCount: 0 })).toBe('parent');
  });

  it('gives a helper with no record of their own the caregiver experience', () => {
    expect(resolveExperience({ hasSelfRecord: false, managedRecordCount: 2 })).toBe('caregiver');
  });

  /**
   * The row that matters: being a helper does not take somebody's own health
   * off their home screen.
   */
  it('keeps a parent who also helps on their own Today screen', () => {
    expect(resolveExperience({ hasSelfRecord: true, managedRecordCount: 3 })).toBe('parent');
  });

  it('gives a brand-new account with neither the caregiver first-use shell', () => {
    expect(resolveExperience({ hasSelfRecord: false, managedRecordCount: 0 })).toBe('caregiver');
  });

  it('depends on nothing but the record relationship', () => {
    // Same inputs, same answer, every time — there is no preference, profile
    // field or client flag that can move an account between experiences.
    const inputs = { hasSelfRecord: false, managedRecordCount: 1 } as const;
    expect(resolveExperience(inputs)).toBe(resolveExperience({ ...inputs }));
  });
});

describe('densityFor', () => {
  it('sets the parent experience in the comfortable density', () => {
    expect(densityFor('parent')).toBe('comfortable');
  });

  it('leaves the caregiver experience at the standard density', () => {
    expect(densityFor('caregiver')).toBe('standard');
  });
});

describe('homeRouteFor', () => {
  it('sends each experience to its own URL space', () => {
    expect(homeRouteFor('parent')).toBe('/me');
    expect(homeRouteFor('caregiver')).toBe('/care');
  });

  it('never sends the two experiences to the same route', () => {
    expect(homeRouteFor('parent')).not.toBe(homeRouteFor('caregiver'));
  });
});
