import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Callout, Card, Screen, Text } from '@/components';
import { describeDataResidency } from '@/config/dataResidency';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radius, spacing, touchTarget } from '@/theme';

/**
 * The medical disclaimer. Acceptance is recorded with a timestamp and is a
 * hard gate — the route guard will not let anyone past it.
 *
 * This app is an organiser, not a diagnostic tool. Everything on this screen
 * exists to make that unmistakable before a single record is stored.
 *
 * TODO(legal): have counsel review this wording for both Indian (DPDP Act,
 * Clinical Establishments Act) and EU/UK jurisdictions before release, and
 * version the text so an acceptance can be tied to the exact copy shown.
 */

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'information-circle-outline',
    title: 'This app is for organising, not diagnosing',
    body: 'Ayunetz helps you store and keep track of medical documents. It does not diagnose conditions, prescribe treatment, or replace a consultation.',
  },
  {
    icon: 'sparkles-outline',
    title: 'Summaries are generated automatically',
    body: 'Document summaries are produced by software. They can be incomplete or simply wrong. Always read the original document and confirm anything important with a qualified doctor.',
  },
  {
    icon: 'alert-circle-outline',
    title: 'Never delay care because of this app',
    body: 'In an emergency, contact a doctor or emergency services immediately. Do not wait for anything in Ayunetz, and do not change a medicine or dose based on what you read here.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Your family’s records stay private',
    body: describeDataResidency().disclaimerBody,
  },
];

export default function DisclaimerScreen(): React.JSX.Element {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const acceptDisclaimer = useSessionStore((state) => state.acceptDisclaimer);
  const completeOnboarding = useSessionStore((state) => state.completeOnboarding);

  const handleContinue = (): void => {
    acceptDisclaimer();
    completeOnboarding();
    router.replace('/sign-in');
  };

  return (
    <Screen
      footer={
        <Button
          label="I understand — continue"
          onPress={handleContinue}
          disabled={!accepted}
          testID="disclaimer-continue"
          accessibilityHint={
            accepted
              ? 'Records your acceptance and continues to sign in'
              : 'Tick the confirmation box above to continue'
          }
        />
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Before you start
      </Text>
      <Text variant="body" tone="secondary" style={styles.intro}>
        Please read this carefully. It explains what Ayunetz does — and, more importantly, what it
        does not do.
      </Text>

      <Callout
        tone="warning"
        title="Informational use only"
        message="Ayunetz is not a medical device and does not provide medical advice. Nothing in this app should be used to make a treatment decision on its own."
        testID="disclaimer-banner"
      />

      <View style={styles.points}>
        {POINTS.map((point) => (
          <Card key={point.title} style={styles.point}>
            <View style={styles.pointHeader}>
              <Ionicons name={point.icon} size={24} color={colors.primary} />
              <Text variant="subheading" style={styles.pointTitle}>
                {point.title}
              </Text>
            </View>
            <Text variant="callout" tone="secondary">
              {point.body}
            </Text>
          </Card>
        ))}
      </View>

      <Pressable
        onPress={() => setAccepted((current) => !current)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I have read and understood this disclaimer"
        testID="disclaimer-checkbox"
        style={({ pressed }) => [styles.checkRow, pressed ? styles.checkRowPressed : null]}
      >
        <View style={[styles.checkbox, accepted ? styles.checkboxChecked : null]}>
          {accepted ? <Ionicons name="checkmark" size={22} color={colors.onPrimary} /> : null}
        </View>
        <Text variant="callout" style={styles.checkLabel}>
          I have read and understood this. I will not use Ayunetz as a substitute for professional
          medical advice.
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  checkLabel: { flex: 1 },
  checkRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xl,
    minHeight: touchTarget.large,
    padding: spacing.lg,
  },
  checkRowPressed: { backgroundColor: colors.surfaceMuted },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  heading: { marginBottom: spacing.sm },
  intro: { marginBottom: spacing.xl },
  point: { marginBottom: spacing.md },
  pointHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  pointTitle: { flex: 1 },
  points: { marginTop: spacing.xl },
});
