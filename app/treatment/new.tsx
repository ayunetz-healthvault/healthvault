import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components';
import { DEFAULT_TIMEZONE, localDateIn } from '@/services/treatment/patientClock';
import {
  describeFrequency,
  validateScheduleDraft,
  withTime,
  type ScheduleDraftErrors,
} from '@/services/treatment/scheduleDraft';
import { useSessionStore } from '@/state/sessionStore';
import { selectParent, useVaultSnapshot, useVaultStore } from '@/state/vaultStore';
import { spacing } from '@/theme';

/**
 * Confirming that somebody is actually taking a medicine.
 *
 * ## Why this screen exists at all
 *
 * Because a summary must never become a schedule by itself. What the pipeline
 * produces is a *mention*: a name and a frequency read off a photograph of a
 * prescription that may have been in a drawer for two years. What this screen
 * produces is a statement by a person — this medicine, these times, from this
 * date — and only that can generate a card telling somebody to take a drug.
 *
 * The reading is carried in as parameters and shown as a starting point. Every
 * field is editable, and the times start **empty**: "twice a day" says how many
 * times and nothing about when, and filling in eight and eight would be this
 * screen making a clinical decision on somebody's behalf.
 */
export default function ConfirmMedicineScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{
    patientId?: string;
    documentId?: string;
    name?: string;
    dosage?: string;
    frequency?: string;
  }>();

  const vault = useVaultSnapshot();
  const user = useSessionStore((state) => state.user);
  const confirmSchedule = useVaultStore((state) => state.confirmSchedule);

  const parent = params.patientId ? selectParent(vault, params.patientId) : undefined;

  const [name, setName] = useState(params.name ?? '');
  const [dosage, setDosage] = useState(params.dosage ?? '');
  const [times, setTimes] = useState<string[]>([]);
  const [pendingTime, setPendingTime] = useState('');
  const [startDate, setStartDate] = useState(localDateIn(DEFAULT_TIMEZONE));
  const [errors, setErrors] = useState<ScheduleDraftErrors>({});

  if (!parent) {
    return (
      <Screen testID="treatment-new-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="No person chosen"
          message="Open this from a person’s record so the medicine is filed against them."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const addTime = (): void => {
    const next = withTime(times, pendingTime);
    if (next === times) {
      setErrors({ ...errors, times: 'Enter the time as HH:mm, for example 08:00.' });
      return;
    }
    setTimes(next);
    setPendingTime('');
    setErrors({ ...errors, times: undefined });
  };

  const handleConfirm = (): void => {
    const found = validateScheduleDraft({ name, times, startDate });
    setErrors(found);
    if (Object.values(found).some((message) => message !== undefined)) return;

    confirmSchedule({
      patientId: parent.id,
      name: name.trim(),
      dosage: dosage.trim(),
      times,
      // The patient's zone, not the phone's: a daughter abroad confirming her
      // mother's medicine is setting her mother's 8 a.m., not her own.
      timezone: DEFAULT_TIMEZONE,
      startDate,
      endDate: null,
      source: params.documentId ? { documentId: params.documentId, page: 1 } : null,
      confirmedBy: user?.id ?? 'usr_local',
    });

    router.back();
  };

  return (
    <Screen
      testID="treatment-new"
      footer={
        <Button
          label="Yes, this is being taken"
          onPress={handleConfirm}
          testID="treatment-confirm"
        />
      }
    >
      <SectionHeader title={`A medicine for ${parent.fullName}`} />

      {params.documentId ? (
        <Callout
          tone="info"
          title="Read from a document"
          message="This was read off a prescription automatically. Check it against the original before confirming — nothing is scheduled until you do."
          testID="treatment-from-document"
        />
      ) : null}

      <TextField
        label="Medicine"
        value={name}
        onChangeText={setName}
        required
        error={errors.name}
        testID="treatment-name"
      />

      <TextField
        label="Dose"
        hint="As written on the prescription, for example 500 mg."
        value={dosage}
        onChangeText={setDosage}
        testID="treatment-dosage"
      />

      <Card style={styles.times} testID="treatment-times">
        <Text variant="bodyStrong">When is it taken?</Text>
        <Text variant="callout" tone="secondary">
          {describeFrequency(params.frequency ?? '')}
        </Text>

        <View style={styles.chosen}>
          {times.length === 0 ? (
            <Text variant="caption" tone="secondary">
              No times chosen yet.
            </Text>
          ) : (
            times.map((time) => (
              <Badge key={time} label={time} tone="brand" testID={`treatment-time-${time}`} />
            ))
          )}
        </View>

        <TextField
          label="Add a time"
          hint="24-hour, for example 08:00 or 20:30."
          value={pendingTime}
          onChangeText={setPendingTime}
          keyboardType="numbers-and-punctuation"
          error={errors.times}
          testID="treatment-time-input"
        />
        <Button
          label="Add this time"
          variant="secondary"
          size="medium"
          onPress={addTime}
          testID="treatment-add-time"
        />
      </Card>

      <TextField
        label="Starting from"
        hint="YYYY-MM-DD."
        value={startDate}
        onChangeText={setStartDate}
        error={errors.startDate}
        testID="treatment-start-date"
      />

      <Callout
        tone="neutral"
        message="Confirming this creates reminders on the Today screen. It does not change the prescription, and it is not medical advice — if the times differ from what your doctor said, follow your doctor."
        testID="treatment-disclaimer"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chosen: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginVertical: spacing.sm },
  times: { gap: spacing.sm, marginTop: spacing.md },
});
