import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing } from '@/theme';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone | undefined;
  icon?: keyof typeof Ionicons.glyphMap | undefined;
  testID?: string | undefined;
}

const TONES: Record<BadgeTone, { background: string; foreground: string }> = {
  neutral: { background: colors.surfaceMuted, foreground: colors.textSecondary },
  brand: { background: colors.primarySoft, foreground: colors.primaryPressed },
  success: { background: colors.successSoft, foreground: colors.onSuccessSoft },
  warning: { background: colors.warningSoft, foreground: colors.onWarningSoft },
  danger: { background: colors.dangerSoft, foreground: colors.dangerPressed },
  info: { background: colors.infoSoft, foreground: colors.onInfoSoft },
};

/**
 * Status pill. Always carries a text label — colour alone is not an accessible
 * signal, and several of these states matter clinically.
 */
export function Badge({ label, tone = 'neutral', icon, testID }: BadgeProps): React.JSX.Element {
  const { background, foreground } = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: background }]} testID={testID}>
      {icon ? <Ionicons name={icon} size={14} color={foreground} /> : null}
      <Text variant="caption" style={[styles.label, { color: foreground }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  label: { fontWeight: '600' },
});
