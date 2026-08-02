import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { spacing, touchTarget } from '@/theme';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  testID?: string | undefined;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  testID,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <View style={styles.wrapper} testID={testID}>
      <View style={styles.text}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={12}
          style={styles.action}
        >
          <Text variant="label" tone="brand">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { justifyContent: 'center', minHeight: touchTarget.min - 16, paddingLeft: spacing.md },
  subtitle: { marginTop: spacing.xxs },
  text: { flex: 1 },
  wrapper: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
});
