import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Button, Callout, Card, EmptyState, Screen, SectionHeader, Text } from '@/components';
import { useExperience } from '@/services/experience';
import { selectFollowUpsForParent, selectParent, useVaultSnapshot } from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import { FOLLOW_UP_KIND_LABELS } from '@/types/labels';
import { formatDate, formatTime, isOverdue } from '@/utils/date';

/**
 * The parent's own calendar. One person's dates, nobody else's.
 *
 * Deliberately not a month grid. The reference draws a week strip, which is
 * pleasant on a desktop mock and fiddly on a phone at 200% text; a dated list
 * says the same thing, scrolls, and reads correctly to a screen reader.
 */
export default function ParentCalendarScreen(): React.JSX.Element {
  const router = useRouter();
  const { selfRecordId } = useExperience();
  const vault = useVaultSnapshot();

  const record = selfRecordId === null ? undefined : selectParent(vault, selfRecordId);
  const dates =
    record === undefined
      ? []
      : selectFollowUpsForParent(vault, record.id).filter((item) => item.status !== 'cancelled');

  return (
    <Screen testID="me-calendar">
      <SectionHeader
        title="My calendar"
        subtitle="Times in India (IST)"
        testID="me-calendar-header"
      />

      {dates.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Nothing booked"
          message="When you have an appointment or a test, add it here so it is easy to find."
          actionLabel="Add an appointment"
          onAction={() => router.push('/follow-up/new')}
          testID="me-calendar-empty"
        />
      ) : (
        dates.map((followUp) => (
          <Card
            key={followUp.id}
            tone="appointment"
            onPress={() => router.push(`/follow-up/${followUp.id}`)}
            accessibilityLabel={`${followUp.title}. ${formatDate(followUp.dueDate)}${formatTime(followUp.dueTime) ? ` at ${formatTime(followUp.dueTime)} India time` : ''}.`}
            accessibilityHint="Opens this appointment"
            style={styles.card}
            testID={`me-calendar-${followUp.id}`}
          >
            <Text variant="caption" tone="secondary">
              {FOLLOW_UP_KIND_LABELS[followUp.kind]}
            </Text>
            <Text variant="heading">{followUp.title}</Text>
            <Text variant="callout" style={styles.onAppointment}>
              {formatDate(followUp.dueDate)}
              {formatTime(followUp.dueTime) === null
                ? ''
                : ` · ${formatTime(followUp.dueTime)} IST`}
              {isOverdue(followUp.dueDate) && followUp.status === 'scheduled'
                ? ' · this date has passed'
                : ''}
            </Text>
          </Card>
        ))
      )}

      <Callout
        tone="neutral"
        title="Nothing is sent to your doctor"
        message="These dates stay in your record. Adding one to your phone's calendar is a separate step, and it shows you exactly what it will write first."
        testID="me-calendar-notice"
      />

      <Button
        label="Add an appointment"
        icon="add-outline"
        onPress={() => router.push('/follow-up/new')}
        style={styles.action}
        testID="me-calendar-add"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.xl },
  card: { gap: spacing.xxs, marginBottom: spacing.md },
  onAppointment: { color: colors.onSurfaceAppointment },
});
