import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '../ui';

import { SourceBadge } from './SourceBadge';

import { colors, radius, spacing } from '@/theme';
import type { MedicineMention } from '@/types/domain';

export interface MedicineRowProps {
  medicine: MedicineMention;
  testID?: string | undefined;
}

/**
 * A medicine named in the document.
 *
 * Note the framing: these are medicines *mentioned in the document*, not
 * instructions from this app. The screen that renders these says so, and
 * nothing here is phrased as a recommendation.
 */
export function MedicineRow({ medicine, testID }: MedicineRowProps): React.JSX.Element {
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
