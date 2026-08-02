import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors, typography } from '@/theme';

export type TextVariant = keyof typeof typography;

export type TextTone =
  'primary' | 'secondary' | 'muted' | 'inverse' | 'brand' | 'danger' | 'success';

const TONE_COLORS: Record<TextTone, string> = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  inverse: colors.textInverse,
  brand: colors.primary,
  danger: colors.danger,
  success: colors.onSuccessSoft,
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant | undefined;
  tone?: TextTone | undefined;
  align?: TextStyle['textAlign'] | undefined;
}

/**
 * Typed text primitive.
 *
 * `maxFontSizeMultiplier` is capped at 1.6 rather than left unbounded: users
 * who have bumped the system font size still need the layout to hold together,
 * and anything past ~1.6x starts truncating the summary cards.
 */
export function Text({
  variant = 'body',
  tone = 'primary',
  align,
  style,
  ...rest
}: TextProps): React.JSX.Element {
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      style={[
        typography[variant] as TextStyle,
        { color: TONE_COLORS[tone] },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}
