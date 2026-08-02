import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ChipSelect, EmptyState, FollowUpCard, Screen, Text } from '@/components';
import { selectParent, useVaultStore } from '@/state/vaultStore';
import { spacing } from '@/theme';
import type { FollowUp } from '@/types/domain';
import { byDueDateAsc, isOverdue } from '@/utils/date';
import { pluralise } from '@/utils/format';

type Filter = 'upcoming' | 'overdue' | 'done' | 'all';

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];

const applyFilter = (followUps: FollowUp[], filter: Filter): FollowUp[] => {
  const sorted = [...followUps].sort(byDueDateAsc);
  switch (filter) {
    case 'upcoming':
      return sorted.filter((item) => item.status === 'scheduled' && !isOverdue(item.dueDate));
    case 'overdue':
      return sorted.filter((item) => item.status === 'scheduled' && isOverdue(item.dueDate));
    case 'done':
      return sorted.filter((item) => item.status === 'completed');
    case 'all':
    default:
      return sorted;
  }
};

const EMPTY_COPY: Record<Filter, { title: string; message: string }> = {
  upcoming: {
    title: 'Nothing scheduled',
    message: 'When the next appointment, test or refill is fixed, add it here so it does not slip.',
  },
  overdue: {
    title: 'Nothing overdue',
    message: 'Everything scheduled is still ahead of its due date.',
  },
  done: {
    title: 'Nothing completed yet',
    message: 'Follow-ups you mark as done will be listed here.',
  },
  all: {
    title: 'No follow-ups yet',
    message: 'Add appointments, lab tests and medicine refills to keep track of them.',
  },
};

/** All follow-ups across every parent, filtered by status. */
export default function ScheduleScreen(): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('upcoming');

  const vault = useVaultStore((state) => ({
    parents: state.parents,
    documents: state.documents,
    summaries: state.summaries,
    followUps: state.followUps,
  }));

  const visible = useMemo(() => applyFilter(vault.followUps, filter), [vault.followUps, filter]);

  return (
    <Screen
      testID="schedule"
      footer={
        <Button
          label="Add a follow-up"
          icon="add"
          onPress={() => router.push('/follow-up/new')}
          testID="schedule-add"
        />
      }
    >
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">
          Follow-ups
        </Text>
        <Text variant="caption" tone="secondary">
          Appointments, tests and refills across everyone you look after.
        </Text>
      </View>

      <ChipSelect
        label="Show"
        options={FILTER_OPTIONS}
        value={filter}
        onChange={setFilter}
        testID="schedule-filter"
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title={EMPTY_COPY[filter].title}
          message={EMPTY_COPY[filter].message}
          actionLabel="Add a follow-up"
          onAction={() => router.push('/follow-up/new')}
          testID="schedule-empty"
        />
      ) : (
        <>
          <Text variant="caption" tone="muted" style={styles.count}>
            {pluralise(visible.length, 'follow-up')}
          </Text>
          {visible.map((followUp) => (
            <FollowUpCard
              key={followUp.id}
              followUp={followUp}
              parentName={selectParent(vault, followUp.parentId)?.fullName ?? 'Unknown'}
              onPress={() => router.push(`/follow-up/${followUp.id}`)}
              testID={`schedule-item-${followUp.id}`}
            />
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: { marginBottom: spacing.md },
  header: { gap: spacing.xxs, marginBottom: spacing.xl, paddingTop: spacing.sm },
});
