import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '../ui';

import { SourceBadge } from './SourceBadge';

import { colors, radius, spacing } from '@/theme';
import type { MedicineMention } from '@/types/domain';

export interface MedicineRowProps {
  medicine: MedicineMention;
  /**
   * Offers to turn this mention into a schedule.
   *
   * Optional, and the wording is deliberate: the action is "somebody is taking
   * this", not "add to schedule". It opens a confirmation screen — it never
   * creates anything itself, because a row rendered from a model's reading of a
   * photograph must not be one tap away from a reminder to take a drug.
   */
  onConfirmTaking?: (() => void) | undefined;
  /** True when a confirmed schedule for this medicine already exists. */
  alreadyScheduled?: boolean | undefined;
  testID?: string | undefined;
}

/**
 * A medicine named in the document.
 *
 * Note the framing: these are medicines *mentioned in the document*, not
 * instructions from this app. The screen that renders these says so, and
 * nothing here is phrased as a recommendation.
 */
export function MedicineRow({
  medicine,
  onConfirmTaking,
  alreadyScheduled = false,
  testID,
}: MedicineRowProps): React.JSX.Element {
  return (
    <View
      style={styles.row}
      testID={testID}
      accessible
      accessibilityLabel={`${medicine.name}, ${medicine.dosage}. ${medicine.frequency}. For ${medicine.purpose}.`}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="medical-outline" size={20} color={colors.primary} />
      </View>

      <View style={styles.body}>
        <View style={styles.headline}>
          <Text variant="bodyStrong" numberOfLines={2} style={styles.name}>
            {medicine.name}
          </Text>
          <Text variant="bodyStrong" tone="brand">
            {medicine.dosage}
          </Text>
        </View>

        <Text variant="callout" tone="secondary">
          {medicine.frequency}
        </Text>

        {medicine.purpose ? (
          <Text variant="caption" tone="muted">
            For: {medicine.purpose}
          </Text>
        ) : null}

        {medicine.duration ? (
          <Text variant="caption" tone="muted">
            Duration: {medicine.duration}
          </Text>
        ) : null}

        <SourceBadge sources={medicine.sources} testID={testID ? `${testID}-source` : undefined} />

        {onConfirmTaking === undefined ? null : alreadyScheduled ? (
          <Text variant="caption" tone="secondary">
            Already on the medicine list.
          </Text>
        ) : (
          <Button
            label="Someone is taking this"
            variant="secondary"
            size="medium"
            fullWidth={false}
            onPress={onConfirmTaking}
            accessibilityHint="Opens a screen to confirm the times. Nothing is scheduled until you do."
            testID={testID ? `${testID}-confirm` : undefined}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.xxs },
  headline: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  name: { flex: 1 },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
});
