import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { DensityProvider } from '@/components';
import { colors, spacing, typography } from '@/theme';

/**
 * The individual parent's shell: Today / My health / Calendar / Family.
 *
 * Today is deliberately first and deliberately thin — the next useful action,
 * and little else. Everything that would crowd it (the document list, the
 * confirmed medicines, notes, tasks) lives one tap away under My health.
 *
 * Rendered at the comfortable density: larger type and a taller primary action,
 * because this is the screen the person whose record it is uses every day.
 */
export default function ParentLayout(): React.JSX.Element {
  return (
    <DensityProvider value="comfortable">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            // Taller again than the caregiver's bar: the labels are set larger.
            height: 84,
            paddingBottom: spacing.md,
            paddingTop: spacing.sm,
          },
          /*
            The tab bar keeps the caregiver shell's label size even though the
            screens are set larger. React Navigation gives a label one line and
            truncates it, and at the comfortable size "My health" came out as
            "My hea…" on a 360pt phone. The tap targets are what matter here —
            the bar is taller than the caregiver's — and a label that can be
            read beats a label that is merely bigger.
          */
          tabBarLabelStyle: { fontSize: typography.caption.fontSize, fontWeight: '600' },
          tabBarItemStyle: { paddingVertical: spacing.xs },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ color, size }) => <Ionicons name="sunny" size={size} color={color} />,
            tabBarAccessibilityLabel: 'Today. Your next step.',
          }}
        />
        <Tabs.Screen
          name="health"
          options={{
            title: 'My health',
            tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
            tabBarAccessibilityLabel: 'My health. Documents, medicines, notes and to-do.',
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'Calendar',
            tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
            tabBarAccessibilityLabel: 'Calendar. Your appointments.',
          }}
        />
        <Tabs.Screen
          name="family"
          options={{
            title: 'Family',
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
            tabBarAccessibilityLabel: 'Family. Who can see your record, and how to stop them.',
          }}
        />
      </Tabs>
    </DensityProvider>
  );
}
