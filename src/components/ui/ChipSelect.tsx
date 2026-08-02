import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing, touchTarget } from '@/theme';

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

export interface ChipSelectProps<T extends string> {
  label: string;
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  error?: string | undefined;
  hint?: string | undefined;
  testID?: string | undefined;
}

/**
 * Single-select as a wrap of chips.
 *
 * Chosen over a native picker deliberately: a dropdown hides the options
 * behind a tap and renders them at system font size in a scroll wheel. Chips
 * keep every choice visible and each one is a 48pt+ target.
 */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  testID,
}: ChipSelectProps<T>): React.JSX.Element {
  return (
    <View style={styles.wrapper} testID={testID}>
      <Text variant="label" tone="secondary" style={styles.label}>
        {label}
      </Text>

      <View style={styles.row} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              testID={testID ? `${testID}-${option.value}` : undefined}
              style={({ pressed }) => [
                styles.chip,
                selected ? styles.chipSelected : null,
                pressed ? styles.chipPressed : null,
              ]}
            >
              <Text
                variant="callout"
                style={selected ? styles.chipTextSelected : styles.chipText}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: touchTarget.min - 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chipPressed: { opacity: 0.85 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary },
  chipTextSelected: { color: colors.onPrimary, fontWeight: '600' },
  helper: { marginTop: spacing.xs },
  label: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  wrapper: { marginBottom: spacing.lg },
});
