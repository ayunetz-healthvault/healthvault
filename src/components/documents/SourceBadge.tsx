import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '../ui';

import { colors, radius, spacing } from '@/theme';
import type { SourceReference } from '@/types/domain';

export interface SourceBadgeProps {
  sources: SourceReference[] | undefined;
  testID?: string | undefined;
}

/**
 * Where a value was read from.
 *
 * This is the difference between "the app says your mother's HbA1c is 8.1" and
 * "page 2 of this report says 8.1, go and look". A generated summary that
 * cannot be checked against the original is not something a family should act
 * on, so every important value carries the page it came from.
 *
 * Renders nothing when there is no source — which is the case for every summary
 * produced before the pipeline existed, including the seeded demo data. Absence
 * is silent rather than showing "unknown page", because a screen full of
 * "unknown" teaches people to ignore the field.
 */
export function SourceBadge({ sources, testID }: SourceBadgeProps): React.JSX.Element | null {
  if (sources === undefined || sources.length === 0) {
    return null;
  }

  const pages = [...new Set(sources.map((source) => source.page))].sort((a, b) => a - b);
  const label = pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(', ')}`;

  return (
    <View
      style={styles.badge}
      testID={testID}
      accessible
      // Spelled out for a screen reader: "Page 2" alone gives no context.
      accessibilityLabel={`Read from ${label.toLowerCase()} of this document`}
    >
      <Ionicons name="document-text-outline" size={13} color={colors.textMuted} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xxs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
