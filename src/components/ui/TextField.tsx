import { useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing, touchTarget, typography } from '@/theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field when there is no error. */
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  multiline?: boolean | undefined;
  testID?: string | undefined;
}

/**
 * Labelled text input.
 *
 * The label is a real, always-visible label rather than a placeholder that
 * vanishes on focus — floating-label patterns leave older users staring at an
 * unlabelled box halfway through filling a form.
 */
export function TextField({
  label,
  hint,
  error,
  required = false,
  multiline = false,
  testID,
  ...rest
}: TextFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const describedBy = error ?? hint;

  return (
    <View style={styles.wrapper}>
      <Text variant="label" tone="secondary" style={styles.label}>
        {label}
        {required ? (
          <Text variant="label" tone="danger">
            {' *'}
          </Text>
        ) : null}
      </Text>

      <TextInput
        testID={testID}
        accessibilityLabel={label}
        {...(describedBy === undefined ? {} : { accessibilityHint: describedBy })}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        maxFontSizeMultiplier={1.6}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          focused ? styles.focused : null,
          error ? styles.errored : null,
        ]}
        {...rest}
      />

      {error ? (
        <Text variant="caption" tone="danger" style={styles.helper}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted" style={styles.helper}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  errored: { borderColor: colors.danger, borderWidth: 2 },
  focused: { borderColor: colors.focusRing, borderWidth: 2 },
  helper: { marginTop: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    minHeight: touchTarget.min,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  label: { marginBottom: spacing.xs },
  multiline: { minHeight: touchTarget.min * 2, textAlignVertical: 'top' },
  wrapper: { marginBottom: spacing.lg },
});
