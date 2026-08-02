import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  FollowUpCard,
  ParentCard,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { useSessionStore } from '@/state/sessionStore';
import {
  selectOverdueFollowUps,
  selectParent,
  selectParentStats,
  selectUpcomingFollowUps,
  useVaultSnapshot,
} from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import { pluralise } from '@/utils/format';

const UPCOMING_LIMIT = 4;

/**
 * The dashboard.
 *
 * Ordered by urgency rather than by entity: anything overdue comes first,
 * then who you look after, then what is coming up. Someone opening this at
 * 6am before work should be able to answer "is anything on fire?" in one look.
 */
export default function DashboardScreen(): React.JSX.Element {
  const router = useRouter();
  const firstName = useSessionStore((state) => state.user?.fullName?.split(' ')[0] ?? null);

  const vault = useVaultSnapshot();

  const overdue = selectOverdueFollowUps(vault);
  const upcoming = selectUpcomingFollowUps(vault, UPCOMING_LIMIT);

  if (vault.parents.length === 0) {
    return (
      <Screen testID="dashboard-empty">
        <Greeting firstName={firstName} />
        <EmptyState
          icon="person-add-outline"
          title="Add your first parent"
          message="Create a profile for the person you look after. You can then add their reports, prescriptions and follow-up appointments."
          actionLabel="Add a parent"
          onAction={() => router.push('/parent/new')}
          testID="dashboard-empty-state"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="dashboard">
      <Greeting firstName={firstName} />

      {overdue.length > 0 ? (
        <Card tone="warning" style={styles.alertCard}>
          <View style={styles.alertHeader}>
            <Ionicons name="alert-circle" size={26} color={colors.onWarningSoft} />
            <Text variant="subheading" style={styles.alertTitle}>
              {pluralise(overdue.length, 'follow-up')} overdue
            </Text>
          </View>
          <Text variant="callout" tone="secondary" style={styles.alertBody}>
            {overdue.length === 1
              ? `“${overdue[0]?.title}” was due and has not been marked done.`
              : 'Some appointments and refills have passed their due date.'}
          </Text>
          <Button
            label="Review them"
            variant="secondary"
            size="medium"
            fullWidth={false}
            onPress={() => router.push('/(tabs)/schedule')}
            testID="dashboard-review-overdue"
          />
        </Card>
      ) : null}

      <SectionHeader
        title="Who you look after"
        actionLabel="Add"
        onAction={() => router.push('/parent/new')}
        testID="dashboard-parents-header"
      />

      {vault.parents.map((parent) => (
        <ParentCard
          key={parent.id}
          parent={parent}
          stats={selectParentStats(vault, parent.id)}
          onPress={() => router.push(`/parent/${parent.id}`)}
          testID={`parent-card-${parent.id}`}
        />
      ))}

      <SectionHeader
        title="Coming up"
        subtitle={
          upcoming.length === 0 ? undefined : `Next ${pluralise(upcoming.length, 'follow-up')}`
        }
        actionLabel="See all"
        onAction={() => router.push('/(tabs)/schedule')}
        testID="dashboard-upcoming-header"
      />

      {upcoming.length === 0 ? (
        <Card style={styles.quietCard}>
          <Text variant="callout" tone="secondary">
            Nothing is scheduled right now. Add a follow-up when the next appointment or test is
            fixed.
          </Text>
          <Button
            label="Add a follow-up"
            variant="secondary"
            size="medium"
            fullWidth={false}
            onPress={() => router.push('/follow-up/new')}
            style={styles.quietAction}
            testID="dashboard-add-followup"
          />
        </Card>
      ) : (
        upcoming.map((followUp) => (
          <FollowUpCard
            key={followUp.id}
            followUp={followUp}
            parentName={selectParent(vault, followUp.parentId)?.fullName ?? 'Unknown'}
            onPress={() => router.push(`/follow-up/${followUp.id}`)}
            testID={`followup-card-${followUp.id}`}
          />
        ))
      )}

      <View style={styles.quickActions}>
        <Button
          label="Add a document"
          icon="camera-outline"
          onPress={() => router.push('/capture')}
          testID="dashboard-add-document"
        />
        <Button
          label="Add a follow-up"
          variant="secondary"
          icon="calendar-outline"
          onPress={() => router.push('/follow-up/new')}
          testID="dashboard-add-followup-secondary"
        />
      </View>
    </Screen>
  );
}

function Greeting({ firstName }: { firstName: string | null }): React.JSX.Element {
  return (
    <View style={styles.greeting}>
      <Text variant="caption" tone="secondary">
        {firstName ? `Hello, ${firstName}` : 'Hello'}
      </Text>
      <Text variant="title" accessibilityRole="header">
        Your family’s health
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  alertBody: { marginBottom: spacing.lg },
  alertCard: { marginTop: spacing.lg },
  alertHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  alertTitle: { flex: 1 },
  greeting: { gap: spacing.xxs, paddingTop: spacing.sm },
  quickActions: { gap: spacing.md, marginTop: spacing.xxxl },
  quietAction: { marginTop: spacing.lg },
  quietCard: { marginBottom: spacing.md },
});
