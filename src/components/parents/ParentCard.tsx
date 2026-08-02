import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Avatar, Badge, Card, Text } from '../ui';

import type { ParentSummaryStats } from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import type { ParentProfile } from '@/types/domain';
import { RELATIONSHIP_LABELS } from '@/types/labels';
import { calculateAge, describeDueDate } from '@/utils/date';
import { pluralise } from '@/utils/format';

export interface ParentCardProps {
  parent: ParentProfile;
  stats: ParentSummaryStats;
  onPress: () => void;
  testID?: string | undefined;
}

/**
 * Dashboard card for one parent.
 *
 * Answers the three questions a caregiver abroad actually opens the app with:
 * is anything overdue, what is next, and how much is on file.
 */
export function ParentCard({ parent, stats, onPress, testID }: ParentCardProps): React.JSX.Element {
  const age = calculateAge(parent.dateOfBirth);
  const subtitle = [
    RELATIONSHIP_LABELS[parent.relationship],
    age === null ? null : `${age} years`,
    parent.city || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const accessibilityLabel = [
    parent.fullName,
    subtitle,
    stats.overdueCount > 0 ? `${pluralise(stats.overdueCount, 'overdue follow-up')}` : null,
    stats.nextFollowUp
      ? `Next: ${stats.nextFollowUp.title}, ${describeDueDate(stats.nextFollowUp.dueDate)}`
      : 'No follow-ups scheduled',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card
      onPress={onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens this profile and its document timeline"
      style={styles.card}
    >
      <View style={styles.header}>
        <Avatar name={parent.fullName} color={parent.avatarColor} size={60} />
        <View style={styles.headerText}>
          <Text variant="subheading" numberOfLines={1}>
            {parent.fullName}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
      </View>

      {stats.overdueCount > 0 ? (
        <View style={styles.badgeRow}>
          <Badge
            label={`${pluralise(stats.overdueCount, 'item')} overdue`}
            tone="danger"
            icon="alert-circle"
          />
        </View>
      ) : null}

      <View style={styles.nextRow}>
        <Ionicons
          name={stats.nextFollowUp ? 'calendar-outline' : 'checkmark-circle-outline'}
          size={20}
          color={stats.nextFollowUp ? colors.primary : colors.success}
        />
        <Text variant="callout" tone="secondary" style={styles.nextText} numberOfLines={2}>
          {stats.nextFollowUp
            ? `${describeDueDate(stats.nextFollowUp.dueDate)} — ${stats.nextFollowUp.title}`
            : 'Nothing scheduled right now'}
        </Text>
      </View>

      <View style={styles.footer}>
        <Text variant="caption" tone="muted">
          {pluralise(stats.documentCount, 'document')}
        </Text>
        <Text variant="caption" tone="muted">
          {pluralise(stats.upcomingCount, 'follow-up')} upcoming
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  badgeRow: { marginTop: spacing.md },
  card: { marginBottom: spacing.md },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg },
  headerText: { flex: 1, gap: spacing.xxs },
  nextRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  nextText: { flex: 1 },
});
