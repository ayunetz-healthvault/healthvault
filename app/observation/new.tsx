import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import {
  Button,
  Callout,
  ChipSelect,
  EmptyState,
  Screen,
  SectionHeader,
  TextField,
} from '@/components';
import { useSessionStore } from '@/state/sessionStore';
import { selectParent, useVaultSnapshot, useVaultStore } from '@/state/vaultStore';
import { IMPACT_LABELS, type ObservationImpact } from '@/types/observations';
import { isValidIsoDate, isoToday } from '@/utils/date';

/**
 * Writing down something you noticed.
 *
 * ## What this screen deliberately does not have
 *
 * A severity scale, a body-part picker, a list of symptoms to choose from, or
 * anything that turns "a funny feeling in my chest after the stairs" into a
 * classification. The moment this app assigns clinical weight to a text box it
 * is practising medicine, and the note a doctor can actually use is the one in
 * the person's own words.
 *
 * `impact` is the nearest thing to a scale here and is about the person's *day*
 * rather than their condition — "a little", "moderately", "a lot" — which is a
 * question they can answer and nobody can mistake for a grading.
 *
 * It also does not send anything to anybody. There is no "tell the doctor"
 * button, because this app does not message clinicians.
 */
export default function NewObservationScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ patientId?: string }>();

  const vault = useVaultSnapshot();
  const user = useSessionStore((state) => state.user);
  const selfRecordId = useSessionStore((state) => state.selfRecordId);
  const addObservation = useVaultStore((state) => state.addObservation);

  const patientId = params.patientId ?? selfRecordId ?? vault.parents[0]?.id ?? '';
  const parent = selectParent(vault, patientId);

  const [text, setText] = useState('');
  const [impact, setImpact] = useState<ObservationImpact>('a_little');
  const [occurredOn, setOccurredOn] = useState(isoToday());
  const [errors, setErrors] = useState<{ text?: string; occurredOn?: string }>({});

  if (!parent) {
    return (
      <Screen testID="observation-new-missing">
        <EmptyState
          icon="person-add-outline"
          title="No record chosen"
          message="Notes belong to a person, so open this from their record."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const handleSave = (): void => {
    const found: { text?: string; occurredOn?: string } = {};
    if (text.trim().length === 0) found.text = 'Write what you noticed, in your own words.';
    if (!isValidIsoDate(occurredOn)) found.occurredOn = 'Enter the date as YYYY-MM-DD.';

    setErrors(found);
    if (found.text !== undefined || found.occurredOn !== undefined) return;

    addObservation({
      patientId: parent.id,
      text,
      /**
       * Midday rather than midnight.
       *
       * The person gave a day, not a time. Storing 00:00 makes a note about
       * Tuesday sort into Monday night for anyone in a zone behind, and midday
       * is the reading least likely to move the note to the wrong day.
       */
      occurredAt: `${occurredOn}T12:00:00.000Z`,
      impact,
      recordedBy: user?.id ?? 'usr_local',
      recordedBySelf: parent.id === selfRecordId,
    });

    router.back();
  };

  return (
    <Screen
      testID="observation-new"
      footer={<Button label="Save this note" onPress={handleSave} testID="observation-save" />}
    >
      <SectionHeader
        title={
          parent.id === selfRecordId ? 'How are you feeling?' : `A note about ${parent.fullName}`
        }
      />

      <TextField
        label="What did you notice?"
        hint="Your own words are best. Nobody is going to reword this."
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={4}
        required
        error={errors.text}
        testID="observation-text"
      />

      <TextField
        label="When was this?"
        hint="YYYY-MM-DD. The day it happened, not the day you are writing it."
        value={occurredOn}
        onChangeText={setOccurredOn}
        error={errors.occurredOn}
        testID="observation-date"
      />

      <ChipSelect
        label="How much did it affect the day?"
        options={(Object.keys(IMPACT_LABELS) as ObservationImpact[]).map((value) => ({
          value,
          label: IMPACT_LABELS[value],
        }))}
        value={impact}
        onChange={setImpact}
        hint="About the day, not about how serious it is. Only a doctor can say that."
        testID="observation-impact"
      />

      <Callout
        tone="neutral"
        message="This is saved for you and anyone you have given access to. It is not sent to a doctor, and this app does not decide what it means."
        testID="observation-disclaimer"
      />
    </Screen>
  );
}
