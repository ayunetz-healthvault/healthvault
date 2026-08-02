import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';

import { colors, radius, spacing } from '@/theme';

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One or two sentences saying what to do next, not just what is missing. */
  message: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  testID?: string | undefined;
}

export function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  testID,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View style={styles.wrapper} testID={testID}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={34} color={colors.primary} />
      </View>
      <Text variant="heading" align="center" style={styles.title}>
        {title}
      </Text>
      <Text variant="callout" tone="secondary" align="center" style={styles.message}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.xl },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 76,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 76,
  },
  message: { maxWidth: 320 },
  title: { marginBottom: spacing.sm },
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.huge,
  },
});
