import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing } from '@/theme';

export interface ProgressBarProps {
  /** 0–100. Clamped. */
  percent: number;
  label?: string | undefined;
  tone?: 'brand' | 'success' | 'danger' | undefined;
  showPercent?: boolean | undefined;
  testID?: string | undefined;
}

const TONE_COLORS = {
  brand: colors.primary,
  success: colors.success,
  danger: colors.danger,
} as const;

export function ProgressBar({
  percent,
  label,
  tone = 'brand',
  showPercent = true,
  testID,
}: ProgressBarProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      {...(label === undefined ? {} : { accessibilityLabel: label })}
    >
      {label || showPercent ? (
        <View style={styles.header}>
          {label ? (
            <Text variant="label" tone="secondary">
              {label}
            </Text>
          ) : null}
          {showPercent ? (
            <Text variant="label" tone="secondary">
              {clamped}%
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: TONE_COLORS[tone] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { borderRadius: radius.pill, height: '100%' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  track: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 10,
    overflow: 'hidden',
    width: '100%',
  },
});
