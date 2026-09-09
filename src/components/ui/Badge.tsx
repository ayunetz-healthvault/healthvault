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
      {/*
        Wraps rather than truncating.

        `numberOfLines={1}` cut "Demonstration — these records are fictional"
        to "...are fictio" on a 360pt phone at the comfortable density, which
        turned the one label that has to be readable into a clipped fragment.
        A badge that is two lines tall is fine; a badge that hides half of what
        it says is not.
      */}
      <Text variant="caption" style={[styles.label, { color: foreground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    // Never wider than the space it is given, however long the label is.
    maxWidth: '100%',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
  },
  label: { flexShrink: 1, fontWeight: '600' },
});
