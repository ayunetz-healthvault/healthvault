import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Text } from './Text';

import { colors, radius, spacing, touchTarget } from '@/theme';

export interface ListRowProps {
  title: string;
  subtitle?: string | undefined;
  icon?: keyof typeof Ionicons.glyphMap | undefined;
  iconColor?: string | undefined;
  onPress?: (() => void) | undefined;
  /** Renders a switch instead of a chevron. */
  toggle?: { value: boolean; onValueChange: (value: boolean) => void } | undefined;
  trailing?: ReactNode | undefined;
  destructive?: boolean | undefined;
  disabled?: boolean | undefined;
  testID?: string | undefined;
}

/** Settings-style row. Also used for follow-up and document lists. */
export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  onPress,
  toggle,
  trailing,
  destructive = false,
  disabled = false,
  testID,
}: ListRowProps): React.JSX.Element {
  const tint = destructive ? colors.danger : (iconColor ?? colors.primary);

  const content = (
    <>
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: destructive ? colors.dangerSoft : colors.primarySoft },
          ]}
        >
          <Ionicons name={icon} size={22} color={tint} />
        </View>
      ) : null}

      <View style={styles.body}>
        <Text variant="bodyStrong" tone={destructive ? 'danger' : 'primary'} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onValueChange}
          disabled={disabled}
          accessibilityLabel={title}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          thumbColor={colors.surface}
        />
      ) : (
        (trailing ??
        (onPress ? <Ionicons name="chevron-forward" size={22} color={colors.textMuted} /> : null))
      )}
    </>
  );

  if (toggle || !onPress) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.xxs },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  subtitle: { paddingRight: spacing.sm },
});
