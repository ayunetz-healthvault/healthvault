import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ListRow,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { calendarService } from '@/services/calendar/calendarService';
import { useSessionStore } from '@/state/sessionStore';
import { selectDocument, selectParent, useVaultSnapshot, useVaultStore } from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import type { FollowUpStatus } from '@/types/domain';
import {
  DOCTOR_CATEGORY_LABELS,
  FOLLOW_UP_KIND_LABELS,
  FOLLOW_UP_STATUS_LABELS,
} from '@/types/labels';
import { describeDueDate, formatDate, formatDateTime, formatTime, isOverdue } from '@/utils/date';

/**
 * A single follow-up: its details, its status, and the calendar hand-off.
 *
 * The calendar action is the only place in the app that writes to something
 * outside its own storage, so it goes through an explicit preview-and-confirm
 * dialog showing exactly what will be created and where.
 */
export default function FollowUpScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const vault = useVaultSnapshot();
  const setFollowUpStatus = useVaultStore((state) => state.setFollowUpStatus);
  const attachCalendarEvent = useVaultStore((state) => state.attachCalendarEvent);
  const removeFollowUp = useVaultStore((state) => state.removeFollowUp);
  const calendarSyncEnabled = useSessionStore((state) => state.privacy.calendarSyncEnabled);

  const [calendarVisible, setCalendarVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  // `info` is for outcomes that are neither a success nor a fault — the web
  // preview having no calendar, for instance.
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger' | 'info';
    message: string;
  } | null>(null);

  const followUp = vault.followUps.find((item) => item.id === id);

  if (!followUp) {
    return (
      <Screen testID="followup-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Follow-up not found"
          message="It may have been deleted."
          actionLabel="Back to follow-ups"
          onAction={() => router.replace('/(tabs)/schedule')}
        />
      </Screen>
    );
  }

  const parent = selectParent(vault, followUp.parentId);
  const sourceDocument = followUp.sourceDocumentId
    ? selectDocument(vault, followUp.sourceDocumentId)
    : undefined;
  const overdue = followUp.status === 'scheduled' && isOverdue(followUp.dueDate);
  const preview = calendarService.buildEventPreview(followUp, parent);

  const handleAddToCalendar = async (): Promise<void> => {
    setCalendarBusy(true);
    const result = await calendarService.addFollowUpToCalendar(followUp, parent);
    setCalendarBusy(false);
    setCalendarVisible(false);

    switch (result.status) {
      case 'created':
        attachCalendarEvent(followUp.id, result.eventId);
        setNotice({ tone: 'success', message: `Added to ${result.calendarTitle}.` });
        break;
      case 'permission_denied':
        setNotice({
          tone: 'danger',
          message:
            'Calendar access was not granted, so nothing was added. You can allow it in your phone’s settings.',
        });
        break;
      case 'no_writable_calendar':
        setNotice({
          tone: 'danger',
          message: 'No calendar on this phone can be written to. Add one and try again.',
        });
        break;
      case 'unavailable':
        setNotice({
          tone: 'info',
          message:
            'Adding to a calendar only works in the phone app. Everything else about this follow-up is saved.',
        });
        break;
      case 'failed':
      default:
        setNotice({ tone: 'danger', message: result.message });
        break;
    }
  };

  const handleRemoveFromCalendar = async (): Promise<void> => {
    if (!followUp.calendarEventId) return;
    const removed = await calendarService.removeEvent(followUp.calendarEventId);
    attachCalendarEvent(followUp.id, null);
    setNotice({
      tone: removed ? 'success' : 'danger',
      message: removed
        ? 'Removed from your calendar.'
        : 'The link was cleared here, but the calendar event could not be deleted. Remove it in your calendar app.',
    });
  };

  const handleDelete = (): void => {
    setDeleteVisible(false);
    if (followUp.calendarEventId) void calendarService.removeEvent(followUp.calendarEventId);
    removeFollowUp(followUp.id);
    router.replace('/(tabs)/schedule');
  };

  const setStatus = (status: FollowUpStatus): void => setFollowUpStatus(followUp.id, status);

  return (
    <Screen
      testID="followup-detail"
      footer={
        followUp.status === 'scheduled' ? (
          <>
            <Button
              label="Mark as done"
              icon="checkmark-circle-outline"
              onPress={() => setStatus('completed')}
              testID="followup-complete"
            />
            <Button
              label={followUp.calendarEventId ? 'Remove from calendar' : 'Add to my calendar'}
              variant="secondary"
              icon="calendar-outline"
              onPress={() =>
                followUp.calendarEventId
                  ? void handleRemoveFromCalendar()
                  : setCalendarVisible(true)
              }
              testID="followup-calendar"
            />
          </>
        ) : (
          <Button
            label="Reopen"
            variant="secondary"
            icon="refresh"
            onPress={() => setStatus('scheduled')}
            testID="followup-reopen"
          />
        )
      }
    >
      <View style={styles.header}>
        <Badge label={FOLLOW_UP_KIND_LABELS[followUp.kind]} tone="brand" />
        <Text variant="title" style={styles.title}>
          {followUp.title}
        </Text>
        {parent ? (
          <Text variant="callout" tone="secondary">
            For {parent.fullName}
          </Text>
        ) : null}
      </View>

      {notice ? (
        <Callout tone={notice.tone} message={notice.message} testID="followup-notice" />
      ) : null}

      <Card tone={overdue ? 'warning' : 'default'} style={styles.whenCard}>
        <View style={styles.whenRow}>
          <Ionicons
            name={overdue ? 'alert-circle' : 'calendar'}
            size={26}
            color={overdue ? colors.onWarningSoft : colors.primary}
          />
          <View style={styles.whenBody}>
            <Text variant="subheading">{describeDueDate(followUp.dueDate)}</Text>
            <Text variant="callout" tone="secondary">
              {formatDate(followUp.dueDate)}
              {followUp.dueTime ? ` at ${formatTime(followUp.dueTime)}` : ''}
            </Text>
            {followUp.dueTime ? (
              <Text variant="caption" tone="muted" style={styles.timezone}>
                Times are in India Standard Time, where the appointment happens.
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      <View style={styles.badges}>
        <Badge
          label={FOLLOW_UP_STATUS_LABELS[followUp.status]}
          tone={
            followUp.status === 'completed'
              ? 'success'
              : followUp.status === 'missed'
                ? 'danger'
                : followUp.status === 'cancelled'
                  ? 'neutral'
                  : 'brand'
          }
        />
        {overdue ? <Badge label="Overdue" tone="danger" icon="alert-circle" /> : null}
        {followUp.calendarEventId ? (
          <Badge label="In your calendar" tone="info" icon="calendar" />
        ) : null}
      </View>

      {followUp.notes ? (
        <>
          <SectionHeader title="Notes" />
          <Card>
            <Text variant="callout">{followUp.notes}</Text>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Details" />
      <Card padded={false} style={styles.group}>
        {followUp.doctorCategory ? (
          <>
            <ListRow
              title={DOCTOR_CATEGORY_LABELS[followUp.doctorCategory]}
              subtitle="Suggested doctor category"
              icon="medkit-outline"
            />
            <View style={styles.divider} />
          </>
        ) : null}

        {sourceDocument ? (
          <>
            <ListRow
              title={sourceDocument.title}
              subtitle="Came from this document"
              icon="document-text-outline"
              onPress={() => router.push(`/document/${sourceDocument.id}`)}
              testID="followup-source-document"
            />
            <View style={styles.divider} />
          </>
        ) : null}

        <ListRow
          title="Created"
          subtitle={formatDateTime(followUp.createdAt)}
          icon="time-outline"
        />
      </Card>

      {followUp.status === 'scheduled' ? (
        <>
          <SectionHeader title="Change status" />
          <Card padded={false} style={styles.group}>
            <ListRow
              title="Mark as missed"
              subtitle="It did not happen and needs rescheduling"
              icon="close-circle-outline"
              onPress={() => setStatus('missed')}
              testID="followup-miss"
            />
            <View style={styles.divider} />
            <ListRow
              title="Cancel this follow-up"
              subtitle="No longer needed"
              icon="ban-outline"
              onPress={() => setStatus('cancelled')}
              testID="followup-cancel"
            />
          </Card>
        </>
      ) : null}

      <Button
        label="Delete this follow-up"
        variant="ghost"
        onPress={() => setDeleteVisible(true)}
        style={styles.delete}
        testID="followup-delete"
      />

      {/* Calendar writes always go through this confirmation — see calendarService. */}
      <ConfirmDialog
        visible={calendarVisible}
        title="Add to your calendar?"
        message="Ayunetz will create this event on your phone's default calendar. Nothing is added without your say-so."
        confirmLabel="Add event"
        loading={calendarBusy}
        onConfirm={() => void handleAddToCalendar()}
        onCancel={() => setCalendarVisible(false)}
        testID="followup-calendar-dialog"
      >
        <Card tone="accent">
          <Text variant="bodyStrong" style={styles.previewTitle}>
            {preview.title}
          </Text>
          <Text variant="caption" tone="secondary">
            {formatDateTime(preview.startDate.toISOString())}
          </Text>
          {preview.location ? (
            <Text variant="caption" tone="secondary">
              {preview.location}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.previewReminder}>
            Reminder {preview.reminderMinutes / 60} hours before
          </Text>
          {!calendarSyncEnabled ? (
            <Text variant="caption" tone="muted" style={styles.previewReminder}>
              Calendar sync is off in Settings, so this is a one-off event only.
            </Text>
          ) : null}
        </Card>
      </ConfirmDialog>

      <ConfirmDialog
        visible={deleteVisible}
        title="Delete this follow-up?"
        message={
          followUp.calendarEventId
            ? 'The follow-up and its calendar event will both be removed. This cannot be undone.'
            : 'This cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteVisible(false)}
        testID="followup-delete-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.lg },
  delete: { marginTop: spacing.xxxl },
  divider: { backgroundColor: colors.border, height: 1, marginLeft: spacing.giant + spacing.lg },
  group: { overflow: 'hidden' },
  header: { gap: spacing.sm, marginBottom: spacing.lg, paddingTop: spacing.lg },
  previewReminder: { marginTop: spacing.xs },
  previewTitle: { marginBottom: spacing.xs },
  timezone: { marginTop: spacing.xs },
  title: { marginTop: spacing.xs },
  whenBody: { flex: 1 },
  whenCard: { marginTop: spacing.md },
  whenRow: { flexDirection: 'row', gap: spacing.lg },
});
