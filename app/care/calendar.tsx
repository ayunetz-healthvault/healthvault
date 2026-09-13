import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Card, EmptyState, Screen, SectionHeader, Text } from '@/components';
import { selectParent, useVaultSnapshot } from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import type { FollowUp } from '@/types/domain';
import { FOLLOW_UP_KIND_LABELS } from '@/types/labels';
import { byDueDateAsc, formatDate, formatTime, isOverdue } from '@/utils/date';

/**
 * Everything scheduled, across every record the caregiver can see, grouped by
 * date.
 *
 * Times are stated in IST with the zone named, because the person reading this
 * is very often not in it. "10:30" alone, read in Berlin, is a missed call to
 * the clinic.
 */
export default function CaregiverCalendarScreen(): React.JSX.Element {
  const router = useRouter();
  const vault = useVaultSnapshot();

  const grouped = useMemo(() => groupByDate(vault.followUps), [vault.followUps]);

  return (
    <Screen testID="care-calendar">
      <SectionHeader
        title="Family calendar"
        subtitle="Appointments and tests · times in India (IST)"
        testID="care-calendar-header"
      />

      {grouped.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Nothing scheduled"
          message="When a visit, test or refill is fixed, add it here so it does not slip."
          actionLabel="Add a next step"
          onAction={() => router.push('/follow-up/new')}
          testID="care-calendar-empty"
        />
      ) : (
        grouped.map(([date, items]) => (
          <View key={date} style={styles.group}>
            <Text variant="label" tone="secondary" accessibilityRole="header">
              {formatDate(date)}
            </Text>
            {items.map((followUp) => (
              <Card
                key={followUp.id}
                tone="appointment"
                onPress={() => router.push(`/follow-up/${followUp.id}`)}
                accessibilityLabel={`${selectParent(vault, followUp.parentId)?.fullName ?? 'Unknown record'}. ${followUp.title}. ${formatDate(followUp.dueDate)}${formatTime(followUp.dueTime) ? ` at ${formatTime(followUp.dueTime)} India time` : ''}.`}
                accessibilityHint="Opens this next step"
                style={styles.card}
                testID={`care-calendar-${followUp.id}`}
              >
                <Text variant="caption" tone="secondary">
                  {selectParent(vault, followUp.parentId)?.fullName ?? 'Unknown record'} ·{' '}
                  {FOLLOW_UP_KIND_LABELS[followUp.kind]}
                </Text>
                <Text variant="subheading">{followUp.title}</Text>
                <Text variant="callout" style={styles.onAppointment}>
                  {formatTime(followUp.dueTime) === null
                    ? 'No time set'
                    : `${formatTime(followUp.dueTime)} IST`}
                  {isOverdue(followUp.dueDate) && followUp.status === 'scheduled'
                    ? ' · date has passed'
                    : ''}
                </Text>
              </Card>
            ))}
          </View>
        ))
      )}

      <Callout
        tone="neutral"
        title="Nothing here is sent anywhere"
        message="Adding a date keeps it in this record. Putting it in your phone's calendar is a separate step, and it asks you first."
        testID="care-calendar-notice"
      />

      <Button
        label="Add a next step"
        icon="add-outline"
        onPress={() => router.push('/follow-up/new')}
        style={styles.action}
        testID="care-calendar-add"
      />
    </Screen>
  );
}

/** Dated groups, soonest first, with each day's items in due order. */
const groupByDate = (followUps: FollowUp[]): [string, FollowUp[]][] => {
  const byDate = new Map<string, FollowUp[]>();

  for (const followUp of [...followUps].sort(byDueDateAsc)) {
    // A cancelled date is not a plan; showing it would fill the calendar with
    // things nobody is going to.
    if (followUp.status === 'cancelled') continue;
    byDate.set(followUp.dueDate, [...(byDate.get(followUp.dueDate) ?? []), followUp]);
  }

  return [...byDate.entries()];
};

const styles = StyleSheet.create({
  action: { marginTop: spacing.xl },
  card: { gap: spacing.xxs },
  group: { gap: spacing.sm, marginBottom: spacing.xl },
  onAppointment: { color: colors.onSurfaceAppointment },
});
