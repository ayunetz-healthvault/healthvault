import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors, spacing, typography } from '@/theme';

/**
 * Three tabs, no more. Every extra destination is one more thing to scan past
 * for someone who opened the app to do exactly one thing.
 */
export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
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
          tabBarAccessibilityLabel: 'Home. Parent profiles and what is coming up.',
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Follow-ups',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
          tabBarAccessibilityLabel: 'Follow-ups. Appointments, tests and refills.',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          tabBarAccessibilityLabel: 'Settings, privacy and security.',
        }}
      />
    </Tabs>
  );
}
