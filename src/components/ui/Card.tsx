import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { colors, elevation, radius, spacing } from '@/theme';

export interface CardProps extends ViewProps {
  /** Makes the whole card a single large tap target. */
  onPress?: (() => void) | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  padded?: boolean | undefined;
  tone?: 'default' | 'accent' | 'warning' | 'danger' | undefined;
  style?: ViewStyle | undefined;
}

const TONE_STYLES: Record<NonNullable<CardProps['tone']>, ViewStyle> = {
  default: { backgroundColor: colors.surface, borderColor: colors.border },
  accent: { backgroundColor: colors.surfaceAccent, borderColor: colors.primarySoft },
  warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  danger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
};

export function Card({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  padded = true,
  tone = 'default',
  style,
  children,
  ...rest
}: CardProps): React.JSX.Element {
  const composed = [styles.card, TONE_STYLES[tone], padded ? styles.padded : null, style];

  if (!onPress) {
    return (
      <View style={composed} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      // `rest` carries testID and any other View props through to the pressable
      // variant too — without it, tappable cards are unreachable from tests.
      {...rest}
      style={({ pressed }) => [...composed, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    ...elevation.card,
  },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
});
