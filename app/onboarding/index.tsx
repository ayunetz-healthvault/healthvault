import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components';
import { colors, radius, spacing } from '@/theme';

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

/**
 * Three screens, then the disclaimer.
 *
 * The copy is written for the caregiver abroad, not for a clinician — it names
 * the actual problem (being 8,000km away when a report arrives) rather than
 * listing features.
 */
const SLIDES: Slide[] = [
  {
    icon: 'people-outline',
    title: 'Keep every report in one place',
    body: 'Scan or photograph your parents’ prescriptions, lab reports and discharge summaries. Everything stays together, sorted by who it belongs to.',
  },
  {
    icon: 'sparkles-outline',
    title: 'Understand what it says',
    body: 'Each document gets a plain-language summary: what was measured, which values need attention, and what the doctor asked for next.',
  },
  {
    icon: 'calendar-outline',
    title: 'Never miss the follow-up',
    body: 'Track appointments, tests and refills across the time difference. Add a reminder to your own calendar whenever you choose to.',
  },
];

export default function OnboardingScreen(): React.JSX.Element {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index] ?? SLIDES[0]!;
  const isLast = index === SLIDES.length - 1;

  return (
    <Screen
      scrollable={false}
      footer={
        <>
          <Button
            label={isLast ? 'Continue' : 'Next'}
            icon="arrow-forward"
            iconPosition="trailing"
            onPress={() => {
              if (isLast) router.push('/onboarding/disclaimer');
              else setIndex((current) => current + 1);
            }}
            testID="onboarding-next"
          />
          {isLast ? null : (
            <Button
              label="Skip"
              variant="ghost"
              onPress={() => router.push('/onboarding/disclaimer')}
              testID="onboarding-skip"
            />
          )}
        </>
      }
    >
      <View style={styles.brand}>
        <Text variant="label" tone="brand">
          AYUNETZ
        </Text>
        <Text variant="caption" tone="muted">
          Health Vault
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name={slide.icon} size={48} color={colors.primary} />
        </View>

        <Text variant="display" align="center" style={styles.title}>
          {slide.title}
        </Text>
        <Text variant="body" tone="secondary" align="center">
          {slide.body}
        </Text>
      </View>

      <View
        style={styles.dots}
        accessible
        accessibilityLabel={`Step ${index + 1} of ${SLIDES.length}`}
      >
        {SLIDES.map((item, dotIndex) => (
          <View
            key={item.title}
            style={[styles.dot, dotIndex === index ? styles.dotActive : null]}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: spacing.xxs, paddingTop: spacing.xxl },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  dot: {
    backgroundColor: colors.borderStrong,
    borderRadius: radius.pill,
    height: 10,
    width: 10,
  },
  dotActive: { backgroundColor: colors.primary, width: 28 },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingBottom: spacing.xxl,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 120,
    justifyContent: 'center',
    marginBottom: spacing.xxxl,
    width: 120,
  },
  title: { marginBottom: spacing.lg },
});
