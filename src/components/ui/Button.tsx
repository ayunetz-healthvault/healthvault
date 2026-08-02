import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing, touchTarget } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'medium' | 'large';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  icon?: keyof typeof Ionicons.glyphMap | undefined;
  iconPosition?: 'leading' | 'trailing' | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  fullWidth?: boolean | undefined;
  /** Defaults to `label`; set it when the label alone is not self-explanatory. */
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  testID?: string | undefined;
  style?: ViewStyle | undefined;
}

const BACKGROUNDS: Record<ButtonVariant, { rest: string; pressed: string }> = {
  primary: { rest: colors.primary, pressed: colors.primaryPressed },
  secondary: { rest: colors.surface, pressed: colors.surfaceMuted },
  ghost: { rest: 'transparent', pressed: colors.surfaceMuted },
  danger: { rest: colors.danger, pressed: colors.dangerPressed },
};

const FOREGROUNDS: Record<ButtonVariant, string> = {
  primary: colors.onPrimary,
  secondary: colors.primary,
  ghost: colors.textSecondary,
  danger: colors.onDanger,
};

/**
 * The app's only button.
 *
 * Every variant is at least 56pt tall (64pt at `large`) — these screens get
 * used one-handed, often by someone who is worried, and a missed tap on
 * "Confirm" is expensive.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  icon,
  iconPosition = 'leading',
  disabled = false,
  loading = false,
  fullWidth = true,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps): React.JSX.Element {
  const isInert = disabled || loading;
  const foreground = isInert ? colors.textMuted : FOREGROUNDS[variant];
  const height = size === 'large' ? touchTarget.comfortable : touchTarget.min;

  const backgroundFor = ({ pressed }: PressableStateCallbackType): ViewStyle => ({
    backgroundColor: isInert
      ? variant === 'secondary' || variant === 'ghost'
        ? colors.surfaceMuted
        : colors.borderStrong
      : pressed
        ? BACKGROUNDS[variant].pressed
        : BACKGROUNDS[variant].rest,
  });

  const iconNode = icon ? <Ionicons name={icon} size={22} color={foreground} /> : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={isInert}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      accessibilityState={{ disabled: isInert, busy: loading }}
      style={(state) => [
        styles.base,
        { height, minHeight: height },
        variant === 'secondary' ? styles.outlined : null,
        fullWidth ? styles.fullWidth : styles.hugContent,
        backgroundFor(state),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          {iconPosition === 'leading' ? iconNode : null}
          <Text
            variant={size === 'large' ? 'bodyStrong' : 'label'}
            style={{ color: foreground }}
            numberOfLines={1}
          >
            {label}
          </Text>
          {iconPosition === 'trailing' ? iconNode : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  hugContent: { alignSelf: 'flex-start' },
  outlined: { borderColor: colors.borderStrong, borderWidth: 1.5 },
});
