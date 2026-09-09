import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { DensityProvider } from '@/components';
import { colors, spacing, typography } from '@/theme';

/**
 * The family caregiver's shell: Home / Family / Calendar / To-do.
 *
 * Four destinations, in the order the approved reference puts them. Each one
 * answers a different question — who needs me, who am I helping and on what
 * terms, when is it, what did I agree to do — so none of them collapses into
 * another.
 *
 * The parent's shell is `app/me`, a separate URL space rather than a variant of
 * this one. Two experiences that render different data under the same route
 * would be one refactor away from showing the wrong person's record.
 */
export default function CaregiverLayout(): React.JSX.Element {
  return (
    <DensityProvider value="standard">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            // Taller than the platform default so the labels stay legible at
            // larger accessibility text sizes.
            height: 76,
            paddingBottom: spacing.md,
            paddingTop: spacing.sm,
          },
          tabBarLabelStyle: { fontSize: typography.caption.fontSize, fontWeight: '600' },
          tabBarItemStyle: { paddingVertical: spacing.xs },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
            tabBarAccessibilityLabel: 'Home. Your family and what needs attention.',
          }}
        />
        <Tabs.Screen
          name="family"
          options={{
            title: 'Family',
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
            tabBarAccessibilityLabel: 'Family. Who you help, and what you may see.',
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'Calendar',
            tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
            tabBarAccessibilityLabel: 'Calendar. Appointments and tests.',
          }}
        />
        <Tabs.Screen
          name="tasks"
          options={{
            title: 'To-do',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="checkmark-circle" size={size} color={color} />
            ),
            tabBarAccessibilityLabel: 'To-do. Next steps you or the family agreed.',
          }}
        />
      </Tabs>
    </DensityProvider>
  );
}
