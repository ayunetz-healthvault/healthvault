import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, Text } from '@/components/ui';
import { describeDose } from '@/services/treatment/occurrences';
import { formatDoseTime } from '@/services/treatment/patientClock';
import { spacing } from '@/theme';
import type { DoseOccurrence } from '@/types/treatment';

/**
 * One dose, and the two things a person can honestly say about it.
 *
 * ## The rules this component holds
 *
 * - **"I haven't taken it" is a statement, not a default.** The card offers it
 *   as an explicit action next to "I've taken it". Nothing here ever infers a
 *   missed dose from silence, and an unanswered dose reads "not recorded".
 * - **A helper's entry says so.** When somebody other than the patient records
 *   a dose, the card says "recorded by a helper" rather than presenting it as
 *   the patient's own confirmation. They are different claims.
 * - **Undo is always available and never destructive.** Tapping the wrong
 *   button at seven in the morning is the most likely mistake this screen will
 *   see, and it must not require a support call.
 *
 * The buttons are large because the primary reader is somebody in their
 * seventies who has just woken up.
 */

export interface DoseCardProps {
  occurrence: DoseOccurrence;
  timezone: string;
  /** True when the person using the app is the patient. */
  bySelf: boolean;
  onTaken: () => void;
  onMissed: () => void;
  onUndo: () => void;
  testID?: string | undefined;
}

export function DoseCard({
  occurrence,
  timezone,
  bySelf,
  onTaken,
  onMissed,
  onUndo,
  testID,
}: DoseCardProps): React.JSX.Element {
  const due = formatDoseTime(occurrence.dueAt, timezone);
  const recorded = occurrence.state !== null;

  return (
    <Card tone="quiet" style={styles.card} testID={testID}>
      <Text variant="caption" tone="secondary">
        Due at {due}
      </Text>
      <Text variant="heading">{occurrence.medicineName}</Text>
      {occurrence.dosage ? (
        <Text variant="callout" tone="secondary">
          {occurrence.dosage}
        </Text>
      ) : null}

      <View style={styles.status}>
        <Badge
          label={describeDose(occurrence)}
          tone={
            occurrence.state === 'taken'
              ? 'success'
              : occurrence.state === 'missed'
                ? 'warning'
                : 'neutral'
          }
        />
      </View>

      {recorded ? (
        <Button
          label="That was a mistake"
          variant="secondary"
          icon="arrow-undo-outline"
          onPress={onUndo}
          style={styles.action}
          accessibilityHint="Removes what was recorded for this dose. Nothing is deleted from the history."
          testID={`${testID ?? 'dose'}-undo`}
        />
      ) : (
        <>
          <Button
            label="I've taken it"
            icon="checkmark-circle-outline"
            onPress={onTaken}
            style={styles.action}
            testID={`${testID ?? 'dose'}-taken`}
          />
          {/*
            Offered, not assumed. This is the only way a dose becomes "missed",
            and it takes somebody saying so.
          */}
          <Button
            label={bySelf ? "I haven't taken it" : 'Record as not taken'}
            variant="secondary"
            icon="close-circle-outline"
            onPress={onMissed}
            style={styles.action}
            testID={`${testID ?? 'dose'}-missed`}
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  card: { gap: spacing.xs, marginTop: spacing.lg },
  status: { alignItems: 'flex-start', marginTop: spacing.xs },
});
