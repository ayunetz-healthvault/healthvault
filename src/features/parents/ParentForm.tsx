import { useState } from 'react';

import { Button, ChipSelect, TextField } from '@/components';
import type { BloodGroup, ParentDraft, Relationship } from '@/types/domain';
import { RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS } from '@/types/labels';
import { parseList, validateParentDraft, type ValidationErrors } from '@/utils/validation';

const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];

export const emptyParentDraft = (): ParentDraft => ({
  fullName: '',
  relationship: 'mother',
  dateOfBirth: null,
  bloodGroup: 'unknown',
  city: '',
  phone: '',
  conditions: [],
  allergies: [],
  primaryDoctor: '',
  notes: '',
});

export interface ParentFormProps {
  initial: ParentDraft;
  submitLabel: string;
  onSubmit: (draft: ParentDraft) => void;
  onCancel: () => void;
  testID?: string | undefined;
}

/**
 * Shared add/edit form.
 *
 * Only the name is required. A caregiver capturing a report at 11pm should not
 * be blocked because they cannot remember a blood group — everything else can
 * be filled in later from the edit screen.
 */
export function ParentForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  testID,
}: ParentFormProps): React.JSX.Element {
  const [draft, setDraft] = useState<ParentDraft>(initial);
  const [conditionsText, setConditionsText] = useState(initial.conditions.join(', '));
  const [allergiesText, setAllergiesText] = useState(initial.allergies.join(', '));
  const [errors, setErrors] = useState<ValidationErrors<ParentDraft>>({});

  const patch = (update: Partial<ParentDraft>): void =>
    setDraft((current) => ({ ...current, ...update }));

  const handleSubmit = (): void => {
    const candidate: ParentDraft = {
      ...draft,
      fullName: draft.fullName.trim(),
      conditions: parseList(conditionsText),
      allergies: parseList(allergiesText),
    };
    const result = validateParentDraft(candidate);
    setErrors(result.errors);
    if (result.valid) onSubmit(candidate);
  };

  return (
    <>
      <TextField
        label="Full name"
        value={draft.fullName}
        onChangeText={(value) => patch({ fullName: value })}
        placeholder="Lakshmi Iyer"
        autoCapitalize="words"
        required
        error={errors.fullName}
        testID={testID ? `${testID}-name` : 'parent-form-name'}
      />

      <ChipSelect
        label="Relationship"
        options={RELATIONSHIP_OPTIONS.map((value) => ({
          value,
          label: RELATIONSHIP_LABELS[value],
        }))}
        value={draft.relationship}
        onChange={(value: Relationship) => patch({ relationship: value })}
        testID={testID ? `${testID}-relationship` : 'parent-form-relationship'}
      />

      <TextField
        label="Date of birth"
        value={draft.dateOfBirth ?? ''}
        onChangeText={(value) => patch({ dateOfBirth: value.trim().length === 0 ? null : value })}
        placeholder="1955-04-18"
        keyboardType="numbers-and-punctuation"
        hint="Year first, e.g. 1955-04-18. Used to show their age."
        error={errors.dateOfBirth}
        testID={testID ? `${testID}-dob` : 'parent-form-dob'}
      />

      <ChipSelect
        label="Blood group"
        options={BLOOD_GROUPS.map((value) => ({
          value,
          label: value === 'unknown' ? 'Not known' : value,
        }))}
        value={draft.bloodGroup}
        onChange={(value: BloodGroup) => patch({ bloodGroup: value })}
        testID={testID ? `${testID}-blood` : 'parent-form-blood'}
      />

      <TextField
        label="City in India"
        value={draft.city}
        onChangeText={(value) => patch({ city: value })}
        placeholder="Chennai"
        autoCapitalize="words"
        error={errors.city}
        testID={testID ? `${testID}-city` : 'parent-form-city'}
      />

      <TextField
        label="Phone number"
        value={draft.phone}
        onChangeText={(value) => patch({ phone: value })}
        placeholder="+91 98400 12345"
        keyboardType="phone-pad"
        error={errors.phone}
        testID={testID ? `${testID}-phone` : 'parent-form-phone'}
      />

      <TextField
        label="Ongoing conditions"
        value={conditionsText}
        onChangeText={setConditionsText}
        placeholder="Type 2 diabetes, Hypertension"
        hint="Separate each one with a comma."
        multiline
        testID={testID ? `${testID}-conditions` : 'parent-form-conditions'}
      />

      <TextField
        label="Allergies"
        value={allergiesText}
        onChangeText={setAllergiesText}
        placeholder="Sulfa drugs"
        hint="Separate each one with a comma."
        multiline
        testID={testID ? `${testID}-allergies` : 'parent-form-allergies'}
      />

      <TextField
        label="Usual doctor or clinic"
        value={draft.primaryDoctor}
        onChangeText={(value) => patch({ primaryDoctor: value })}
        placeholder="Dr. Meera Krishnan, Apollo Clinic Adyar"
        testID={testID ? `${testID}-doctor` : 'parent-form-doctor'}
      />

      <TextField
        label="Notes"
        value={draft.notes}
        onChangeText={(value) => patch({ notes: value })}
        placeholder="Anything useful to remember — mobility, hearing, preferred appointment times."
        multiline
        error={errors.notes}
        testID={testID ? `${testID}-notes` : 'parent-form-notes'}
      />

      <Button
        label={submitLabel}
        onPress={handleSubmit}
        testID={testID ? `${testID}-submit` : 'parent-form-submit'}
      />
      <Button
        label="Cancel"
        variant="ghost"
        onPress={onCancel}
        testID={testID ? `${testID}-cancel` : 'parent-form-cancel'}
      />
    </>
  );
}
