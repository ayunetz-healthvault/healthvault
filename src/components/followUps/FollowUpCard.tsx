import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text } from '../ui';

import { colors, spacing } from '@/theme';
import type { FollowUp, FollowUpKind, FollowUpStatus } from '@/types/domain';
import { FOLLOW_UP_KIND_LABELS, FOLLOW_UP_STATUS_LABELS } from '@/types/labels';
import { describeDueDate, formatTime, isOverdue } from '@/utils/date';

export interface FollowUpCardProps {
  followUp: FollowUp;
  /** Omitted on a parent's own screen, where it would be redundant. */
  parentName?: string | undefined;
  onPress: () => void;
  testID?: string | undefined;
}

const KIND_ICONS: Record<FollowUpKind, keyof typeof Ionicons.glyphMap> = {
  doctor_visit: 'medkit-outline',
  lab_test: 'flask-outline',
  medicine_refill: 'bandage-outline',
  vaccination: 'shield-checkmark-outline',
  physiotherapy: 'body-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

const STATUS_TONES = {
  scheduled: 'brand',
  completed: 'success',
  missed: 'danger',
  cancelled: 'neutral',
} as const satisfies Record<FollowUpStatus, 'brand' | 'success' | 'danger' | 'neutral'>;

export function FollowUpCard({
  followUp,
  parentName,
  onPress,
  testID,
}: FollowUpCardProps): React.JSX.Element {
  const overdue = followUp.status === 'scheduled' && isOverdue(followUp.dueDate);
  const time = formatTime(followUp.dueTime);
  const when = [describeDueDate(followUp.dueDate), time].filter(Boolean).join(' at ');

  const accessibilityLabel = [
    followUp.title,
    parentName ? `for ${parentName}` : null,
    when,
    overdue ? 'Overdue' : FOLLOW_UP_STATUS_LABELS[followUp.status],
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card
      onPress={onPress}
      testID={testID}
      tone={overdue ? 'warning' : 'default'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the follow-up details"
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={[styles.iconWrap, overdue ? styles.iconWrapOverdue : null]}>
          <Ionicons
            name={KIND_ICONS[followUp.kind]}
            size={24}
            color={overdue ? colors.onWarningSoft : colors.primary}
          />
        </View>

        <View style={styles.body}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {followUp.title}
          </Text>

          {parentName ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {parentName}
            </Text>
          ) : null}

          <Text
            variant="callout"
            tone={overdue ? 'danger' : 'secondary'}
            style={styles.when}
            numberOfLines={1}
          >
            {when}
          </Text>

          <View style={styles.badges}>
            <Badge label={FOLLOW_UP_KIND_LABELS[followUp.kind]} tone="neutral" />
            {overdue ? (
              <Badge label="Overdue" tone="danger" icon="alert-circle" />
            ) : followUp.status !== 'scheduled' ? (
              <Badge
                label={FOLLOW_UP_STATUS_LABELS[followUp.status]}
                tone={STATUS_TONES[followUp.status]}
              />
            ) : null}
            {followUp.calendarEventId ? (
              <Badge label="In calendar" tone="info" icon="calendar" />
            ) : null}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  body: { flex: 1, gap: spacing.xxs },
  card: { marginBottom: spacing.md },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  iconWrapOverdue: { backgroundColor: colors.surface },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.lg },
  when: { marginTop: spacing.xxs },
});
