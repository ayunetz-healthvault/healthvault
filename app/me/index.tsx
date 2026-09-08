import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  DemoNotice,
  EmptyState,
  IdentityHeader,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { useExperience } from '@/services/experience';
import { useSessionStore } from '@/state/sessionStore';
import {
  selectFollowUpsForParent,
  selectParent,
  useVaultSnapshot,
} from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import { describeDueDate, formatTime, isOverdue } from '@/utils/date';

/**
 * The parent's Today screen: the next useful action, and very little else.
 *
 * The order the approved reference sets, and the rule that governs it:
 *
 *   1. A dose that is due, when a *confirmed* schedule says one is.
 *   2. Otherwise the next appointment, or adding a document.
 *   3. Then visit preparation, capture, a short note, and the family helper.
 *
 * Step 1 renders nothing today, and that is the correct behaviour rather than a
 * gap. A confirmed schedule is a separate record from a medicine an AI read off
 * a prescription — it needs provenance, times and an explicit confirmation, and
 * that model arrives with KOO-10. Until it exists there is no such thing as a
 * dose that is due, so the screen shows the no-treatment state.
 *
 * What it must never do is fill the card with a plausible-looking medicine. A
 * sample dose on a real person's home screen is an instruction to take a drug.
 */
export default function ParentTodayScreen(): React.JSX.Element {
  const router = useRouter();
  const user = useSessionStore((state) => state.user);
  const { selfRecordId } = useExperience();
  const vault = useVaultSnapshot();

  const record = selfRecordId === null ? undefined : selectParent(vault, selfRecordId);
  const nextVisit =
    record === undefined
      ? undefined
      : selectFollowUpsForParent(vault, record.id).find((item) => item.status === 'scheduled');

  const firstName = (record?.fullName ?? user?.fullName ?? '').split(' ')[0] ?? '';

  const header = (
    <IdentityHeader
      name={record?.fullName ?? user?.fullName ?? 'Signed in'}
      context="My personal space"
      onOpenSettings={() => router.push('/settings')}
      testID="me-header"
    />
  );

  if (record === undefined) {
    return (
      <Screen testID="me-today-empty">
        {header}
        <EmptyState
          icon="person-outline"
          title="Your record is not set up yet"
          message="Once your own health record exists, this screen shows your next step for the day."
          testID="me-today-empty-state"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="me-today">
      {header}

      <View style={styles.greeting}>
        <Text variant="title" accessibilityRole="header">
          {firstName ? `Hello, ${firstName}.` : 'Hello.'}
        </Text>
        <DemoNotice />
      </View>

      {/*
        The no-treatment state. It says what is true — nobody has set up a
        schedule — and offers the action that would change that, rather than
        implying the absence means anything about the person's health.
      */}
      <Card tone="quiet" style={styles.stacked} testID="me-today-no-treatment">
        <Text variant="caption" tone="secondary">
          Today
        </Text>
        <Text variant="heading">No medicine schedule set up</Text>
        <Text variant="callout" tone="secondary">
          When a medicine from your prescription is confirmed, it will appear here with a large
          button to record that you took it. Nothing is being tracked until then.
        </Text>
      </Card>

      {nextVisit === undefined ? (
        <Card tone="appointment" style={styles.stacked} testID="me-today-no-visit">
          <Text variant="caption" tone="secondary">
            Next visit
          </Text>
          <Text variant="heading">Nothing booked</Text>
          <Text variant="callout" style={styles.onAppointment}>
            Add your next appointment so it is here when you need it.
          </Text>
          <Button
            label="Add a document instead"
            variant="secondary"
            icon="camera-outline"
            onPress={() => router.push('/capture')}
            style={styles.action}
            testID="me-today-add-document-alt"
          />
        </Card>
      ) : (
        <Card
          tone="appointment"
          style={styles.stacked}
          onPress={() => router.push(`/follow-up/${nextVisit.id}`)}
          accessibilityLabel={`Your next visit. ${nextVisit.title}. ${describeDueDate(nextVisit.dueDate)}.`}
          accessibilityHint="Opens this visit"
          testID="me-today-visit"
        >
          <Text variant="caption" tone="secondary">
            Your next visit
          </Text>
          <Text variant="heading">{nextVisit.title}</Text>
          <Text variant="callout" style={styles.onAppointment}>
            {describeDueDate(nextVisit.dueDate)}
            {formatTime(nextVisit.dueTime) === null
              ? ''
              : ` · ${formatTime(nextVisit.dueTime)} IST`}
            {isOverdue(nextVisit.dueDate) ? ' · this date has passed' : ''}
          </Text>
        </Card>
      )}

      <SectionHeader title="What would you like to do?" testID="me-today-actions-header" />

      <Button
        label="Add a document"
        icon="camera-outline"
        onPress={() => router.push('/capture')}
        style={styles.action}
        testID="me-today-add-document"
      />
      <Button
        label="How I am feeling"
        variant="secondary"
        icon="heart-outline"
        onPress={() => router.push('/me/health')}
        style={styles.action}
        testID="me-today-symptom"
      />

      <Callout
        tone="neutral"
        title="Your family helper"
        message="Nobody can see this record unless you have given them access. You can check who has it, and take it back, under Family."
        testID="me-today-helper-notice"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  greeting: { gap: spacing.sm, paddingTop: spacing.lg },
  onAppointment: { color: colors.onSurfaceAppointment },
  stacked: { gap: spacing.xs, marginTop: spacing.lg },
});
