import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '../ui';

import { describeLastSync, hasUnsyncedWork, type SyncSummary } from '@/services/sync/types';
import { colors, spacing } from '@/theme';
import { pluralise } from '@/utils/format';

export interface SyncStatusProps {
  summary: SyncSummary;
  now?: Date | undefined;
  testID?: string | undefined;
}

/**
 * What this device is holding that the shared record has not seen.
 *
 * Two rules the wording follows:
 *
 * 1. **An icon never carries the meaning alone.** A cloud with a slash means
 *    nothing to somebody who has not learned it, and this is the one indicator
 *    that decides whether a caregiver abroad believes what they are reading.
 * 2. **The time is always shown.** "Synced" with no time lets a phone that has
 *    been offline for a week look current. Whether this is this morning's dose
 *    or last Tuesday's is the whole question.
 */
export function SyncStatus({ summary, now, testID }: SyncStatusProps): React.JSX.Element {
  const outstanding = hasUnsyncedWork(summary);
  const needsAttention = summary.conflicts > 0 || summary.rejected > 0;

  const icon = needsAttention
    ? 'alert-circle-outline'
    : outstanding
      ? 'cloud-upload-outline'
      : 'checkmark-circle-outline';

  const tone = needsAttention ? colors.onWarningSoft : colors.textSecondary;

  return (
    <View style={styles.row} testID={testID}>
      <Ionicons name={icon} size={18} color={tone} />
      <View style={styles.text}>
        <Text variant="caption" tone="secondary">
          {describeLastSync(summary.lastSyncedAt, now)}
        </Text>
        {outstanding || summary.rejected > 0 ? (
          <Text variant="caption" style={{ color: tone }}>
            {describeOutstanding(summary)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * One line, most serious first.
 *
 * A conflict needs a person to choose; a rejection means the change is not
 * going anywhere; pending is just a matter of time. Listing them all at once
 * would bury the one that needs doing something about.
 */
const describeOutstanding = (summary: SyncSummary): string => {
  if (summary.conflicts > 0) {
    return `${pluralise(summary.conflicts, 'change')} need checking — somebody else edited the same thing`;
  }
  if (summary.rejected > 0) {
    return `${pluralise(summary.rejected, 'change')} could not be saved to the shared record`;
  }
  if (summary.failed > 0) {
    return `${pluralise(summary.failed, 'change')} did not send. You can try again.`;
  }
  // The important one, and the reason plain "Saved" is not good enough: it is
  // on this phone and nobody else can see it yet.
  return `${pluralise(summary.pending, 'change')} saved on this phone, not yet shared`;
};

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, gap: spacing.xxs },
});
