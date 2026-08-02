import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Callout, ChipSelect, EmptyState, Screen, Text, TextField } from '@/components';
import { useVaultStore } from '@/state/vaultStore';
import { spacing } from '@/theme';
import type { DoctorCategory, FollowUpDraft, FollowUpKind } from '@/types/domain';
import {
  DOCTOR_CATEGORY_LABELS,
  DOCTOR_CATEGORY_OPTIONS,
  FOLLOW_UP_KIND_LABELS,
  FOLLOW_UP_KIND_OPTIONS,
} from '@/types/labels';
import { isoToday } from '@/utils/date';
import { validateFollowUpDraft, type ValidationErrors } from '@/utils/validation';

/**
 * Create a follow-up.
 *
 * Accepts `parentId`, `documentId` and `doctorCategory` as query params so the
 * summary screen can hand off a pre-filled form — the common path is reading a
 * report and immediately booking the thing it asks for.
 */
export default function NewFollowUpScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{
    parentId?: string;
    documentId?: string;
    doctorCategory?: string;
  }>();

  const parents = useVaultStore((state) => state.parents);
  const addFollowUp = useVaultStore((state) => state.addFollowUp);

  const suggestedDoctor = DOCTOR_CATEGORY_OPTIONS.includes(params.doctorCategory as DoctorCategory)
    ? (params.doctorCategory as DoctorCategory)
    : null;

  const [draft, setDraft] = useState<FollowUpDraft>({
    parentId: params.parentId ?? parents[0]?.id ?? '',
    title: '',
    kind: 'doctor_visit',
    dueDate: isoToday(7),
    dueTime: null,
    notes: '',
    sourceDocumentId: params.documentId ?? null,
    doctorCategory: suggestedDoctor,
  });
  const [timeText, setTimeText] = useState('');
  const [errors, setErrors] = useState<ValidationErrors<FollowUpDraft>>({});

  const patch = (update: Partial<FollowUpDraft>): void =>
    setDraft((current) => ({ ...current, ...update }));

  const handleSubmit = (): void => {
    const candidate: FollowUpDraft = {
      ...draft,
      title: draft.title.trim(),
      dueTime: timeText.trim().length === 0 ? null : timeText.trim(),
    };
    const result = validateFollowUpDraft(candidate);
    setErrors(result.errors);
    if (!result.valid) return;

    const created = addFollowUp(candidate);
    router.replace(`/follow-up/${created.id}`);
  };

  if (parents.length === 0) {
    return (
      <Screen testID="followup-new-no-parents">
        <EmptyState
          icon="person-add-outline"
          title="Add a parent first"
          message="Follow-ups belong to a person, so create a profile before adding one."
          actionLabel="Add a parent"
          onAction={() => router.replace('/parent/new')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      testID="followup-new"
      footer={
        <>
          <Button label="Save follow-up" onPress={handleSubmit} testID="followup-new-submit" />
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        New follow-up
      </Text>

      {params.documentId ? (
        <Callout
          tone="info"
          message="This follow-up will be linked to the document you were just reading."
          testID="followup-new-linked"
        />
      ) : null}

      <TextField
        label="What needs doing?"
        value={draft.title}
        onChangeText={(value) => patch({ title: value })}
        placeholder="Review diabetes panel with Dr. Meera"
        required
        error={errors.title}
        testID="followup-new-title"
      />

      {parents.length > 1 ? (
        <ChipSelect
          label="Who is it for?"
          options={parents.map((parent) => ({ value: parent.id, label: parent.fullName }))}
          value={draft.parentId}
          onChange={(value) => patch({ parentId: value })}
          error={errors.parentId}
          testID="followup-new-parent"
        />
      ) : null}

      <ChipSelect
        label="Type"
        options={FOLLOW_UP_KIND_OPTIONS.map((value) => ({
          value,
          label: FOLLOW_UP_KIND_LABELS[value],
        }))}
        value={draft.kind}
        onChange={(value: FollowUpKind) => patch({ kind: value })}
        testID="followup-new-kind"
      />

      <TextField
        label="Due date"
        value={draft.dueDate}
        onChangeText={(value) => patch({ dueDate: value })}
        placeholder="2026-08-06"
        keyboardType="numbers-and-punctuation"
        hint="Year first, e.g. 2026-08-06. This is the date in India."
        required
        error={errors.dueDate}
        testID="followup-new-date"
      />

      <TextField
        label="Time (optional)"
        value={timeText}
        onChangeText={setTimeText}
        placeholder="10:30"
        keyboardType="numbers-and-punctuation"
        hint="24-hour clock, e.g. 14:00 for 2pm. Leave blank if it is not fixed."
        error={errors.dueTime}
        testID="followup-new-time"
      />

      <ChipSelect
        label="Doctor category (optional)"
        options={[
          { value: 'none' as const, label: 'Not applicable' },
          ...DOCTOR_CATEGORY_OPTIONS.map((value) => ({
            value,
            label: DOCTOR_CATEGORY_LABELS[value],
          })),
        ]}
        value={draft.doctorCategory ?? 'none'}
        onChange={(value) =>
          patch({ doctorCategory: value === 'none' ? null : (value as DoctorCategory) })
        }
        testID="followup-new-doctor"
      />

      <TextField
        label="Notes"
        value={draft.notes}
        onChangeText={(value) => patch({ notes: value })}
        placeholder="What to carry, what to ask, who is taking them."
        multiline
        error={errors.notes}
        testID="followup-new-notes"
      />

      <Callout
        tone="neutral"
        message="Nothing is added to your phone's calendar automatically. You can add a reminder from the next screen if you want one."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.xl, marginTop: spacing.lg },
});
