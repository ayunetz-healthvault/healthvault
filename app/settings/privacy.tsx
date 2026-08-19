import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Card, ListRow, Screen, SectionHeader, Text } from '@/components';
import { describeDataResidency } from '@/config/dataResidency';
import { accountService } from '@/services/account/accountService';
import { calendarService } from '@/services/calendar/calendarService';
import { useSessionStore } from '@/state/sessionStore';
import { colors, spacing } from '@/theme';
import { formatDateTime } from '@/utils/date';

/**
 * Privacy controls.
 *
 * Everything that shares data is opt-in and starts off. The calendar toggle is
 * a *permission* to ask, not a licence to write: each event still needs its own
 * confirmation on the follow-up screen.
 */
export default function PrivacySettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const residency = describeDataResidency();
  const privacy = useSessionStore((state) => state.privacy);
  const updatePrivacy = useSessionStore((state) => state.updatePrivacy);

  const [calendarPermission, setCalendarPermission] = useState<string>('unknown');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void calendarService.getPermission().then((status) => {
      if (!cancelled) setCalendarPermission(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCalendarToggle = async (value: boolean): Promise<void> => {
    if (!value) {
      updatePrivacy({ calendarSyncEnabled: false });
      return;
    }
    const status = await calendarService.requestPermission();
    setCalendarPermission(status);
    updatePrivacy({ calendarSyncEnabled: status === 'granted' });
  };

  const handleExport = async (): Promise<void> => {
    const request = await accountService.requestDataExport();
    setExportNotice(
      `Export requested (${request.requestId}). In the released app you will get an email with a secure download link once it is ready.`,
    );
  };

  return (
    <Screen
      testID="settings-privacy-screen"
      footer={<Button label="Done" onPress={() => router.back()} testID="privacy-done" />}
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Privacy
      </Text>
      <Text variant="callout" tone="secondary" style={styles.intro}>
        You decide what leaves this app. Everything below is off unless you turn it on.
      </Text>

      <SectionHeader title="Calendar" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="Allow calendar reminders"
          subtitle={
            privacy.calendarSyncEnabled
              ? 'Ayunetz may offer to add follow-ups to your calendar'
              : 'Ayunetz will not touch your calendar'
          }
          icon="calendar-outline"
          toggle={{
            value: privacy.calendarSyncEnabled,
            onValueChange: (value) => void handleCalendarToggle(value),
          }}
          testID="privacy-calendar"
        />
      </Card>
      <Callout
        tone="neutral"
        message={`Even with this on, every event is shown to you and confirmed before it is created. Calendar permission on this phone: ${calendarPermission}.`}
      />

      <SectionHeader title="Improving the app" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="Share anonymous usage data"
          subtitle="Which screens are used, never what is in your documents"
          icon="stats-chart-outline"
          toggle={{
            value: privacy.analyticsEnabled,
            onValueChange: (value) => updatePrivacy({ analyticsEnabled: value }),
          }}
          testID="privacy-analytics"
        />
        <View style={styles.divider} />
        <ListRow
          title="Help improve summaries"
          subtitle="Allow de-identified summaries to be reviewed for accuracy"
          icon="sparkles-outline"
          toggle={{
            value: privacy.shareAnonymisedDataForImprovement,
            onValueChange: (value) => updatePrivacy({ shareAnonymisedDataForImprovement: value }),
          }}
          testID="privacy-improvement"
        />
      </Card>

      <SectionHeader title="Where your data lives" />
      {residency.isPrototype ? (
        <Callout
          tone="warning"
          title="This is a test build"
          message="The hosted platform is not connected yet. Read the description below before adding a real medical record."
          testID="privacy-prototype-notice"
        />
      ) : null}
      <Card>
        <Text variant="callout" tone="secondary" style={styles.paragraph}>
          {residency.storage}
        </Text>
        <Text variant="callout" tone="secondary" style={styles.paragraph}>
          {residency.processing}
        </Text>
        <Text variant="caption" tone="muted">
          Disclaimer accepted:{' '}
          {privacy.disclaimerAcceptedAt ? formatDateTime(privacy.disclaimerAcceptedAt) : 'not yet'}
        </Text>
      </Card>

      <SectionHeader title="Your data" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="Request a copy of everything"
          subtitle="All documents, summaries and follow-ups"
          icon="download-outline"
          onPress={() => void handleExport()}
          testID="privacy-export"
        />
        <View style={styles.divider} />
        <ListRow
          title="Delete data or account"
          subtitle="Remove documents, or close the account"
          icon="trash-outline"
          destructive
          onPress={() => router.push('/settings/delete')}
          testID="privacy-delete"
        />
      </Card>

      {exportNotice ? (
        <Callout tone="success" message={exportNotice} testID="privacy-export-notice" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  divider: { backgroundColor: colors.border, height: 1, marginLeft: spacing.giant + spacing.lg },
  group: { marginBottom: spacing.md, overflow: 'hidden' },
  heading: { marginBottom: spacing.sm, marginTop: spacing.lg },
  intro: { marginBottom: spacing.md },
  paragraph: { marginBottom: spacing.md },
});
