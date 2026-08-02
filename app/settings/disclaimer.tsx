import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Button, Callout, Card, Screen, SectionHeader, Text } from '@/components';
import { AI_SUMMARY_DISCLAIMER } from '@/services/ai/summaryService';
import { useSessionStore } from '@/state/sessionStore';
import { spacing } from '@/theme';
import { formatDateTime } from '@/utils/date';

/** Read-only copy of the disclaimer, reachable at any time from Settings. */
export default function DisclaimerSettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const acceptedAt = useSessionStore((state) => state.privacy.disclaimerAcceptedAt);

  return (
    <Screen
      testID="settings-disclaimer-screen"
      footer={<Button label="Done" onPress={() => router.back()} testID="disclaimer-done" />}
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Medical disclaimer
      </Text>

      <Callout
        tone="warning"
        title="Informational use only"
        message="Ayunetz is not a medical device and does not provide medical advice, diagnosis or treatment."
      />

      <SectionHeader title="What this app does" />
      <Card>
        <Text variant="callout" style={styles.paragraph}>
          Ayunetz stores medical documents you choose to add, keeps them organised by person, and
          helps you track follow-up appointments. It is a filing cabinet and a reminder, nothing
          more.
        </Text>
      </Card>

      <SectionHeader title="About the summaries" />
      <Card>
        <Text variant="callout" style={styles.paragraph}>
          {AI_SUMMARY_DISCLAIMER}
        </Text>
        <Text variant="callout" tone="secondary">
          Summaries can miss values, misread handwriting, and occasionally state something that is
          not in the document at all. Treat every summary as a prompt to read the original, never as
          a replacement for it.
        </Text>
      </Card>

      <SectionHeader title="In an emergency" />
      <Card tone="danger">
        <Text variant="callout">
          Contact a doctor or emergency services immediately. Do not wait for anything in this app,
          and never start, stop or change a medicine on the basis of what you read here.
        </Text>
      </Card>

      {acceptedAt ? (
        <Text variant="caption" tone="muted" style={styles.accepted}>
          You accepted this on {formatDateTime(acceptedAt)}.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  accepted: { marginTop: spacing.xxl },
  heading: { marginBottom: spacing.lg, marginTop: spacing.lg },
  paragraph: { marginBottom: spacing.md },
});
