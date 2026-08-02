import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing } from '@/theme';

export type CalloutTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

export interface CalloutProps {
  tone?: CalloutTone | undefined;
  title?: string | undefined;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap | undefined;
  testID?: string | undefined;
}

const TONES: Record<
  CalloutTone,
  { background: string; border: string; foreground: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  info: {
    background: colors.infoSoft,
    border: colors.info,
    foreground: colors.onInfoSoft,
    icon: 'information-circle',
  },
  warning: {
    background: colors.warningSoft,
    border: colors.warning,
    foreground: colors.onWarningSoft,
    icon: 'alert-circle',
  },
  danger: {
    background: colors.dangerSoft,
    border: colors.danger,
    foreground: colors.dangerPressed,
    icon: 'warning',
  },
  success: {
    background: colors.successSoft,
    border: colors.success,
    foreground: colors.onSuccessSoft,
    icon: 'checkmark-circle',
  },
  neutral: {
    background: colors.surfaceMuted,
    border: colors.borderStrong,
    foreground: colors.textSecondary,
    icon: 'ellipse',
  },
};

/**
 * Inline notice. Used heavily for the medical disclaimer, which by policy
 * appears wherever an AI-generated summary does.
 */
export function Callout({
  tone = 'info',
  title,
  message,
  icon,
  testID,
}: CalloutProps): React.JSX.Element {
  const config = TONES[tone];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={title ? `${title}. ${message}` : message}
      style={[
        styles.wrapper,
        { backgroundColor: config.background, borderLeftColor: config.border },
      ]}
    >
      <Ionicons
        name={icon ?? config.icon}
        size={22}
        color={config.foreground}
        style={styles.icon}
      />
      <View style={styles.body}>
        {title ? (
          <Text variant="label" style={[styles.title, { color: config.foreground }]}>
            {title}
          </Text>
        ) : null}
        <Text variant="caption" style={{ color: config.foreground }}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  icon: { marginTop: 1 },
  title: { marginBottom: spacing.xs },
  wrapper: {
    borderBottomRightRadius: radius.md,
    borderLeftWidth: 4,
    borderTopRightRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
});
