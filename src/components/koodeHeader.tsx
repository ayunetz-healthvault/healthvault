import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Badge, Text } from './ui';

import { isDemoBuild } from '@/config/env';
import { colors, spacing, touchTarget } from '@/theme';

export interface IdentityHeaderProps {
  /** Whose session this is. Never the record being viewed. */
  name: string;
  /** One line under the name — "Family space", "My personal space". */
  context: string;
  onOpenSettings: () => void;
  testID?: string | undefined;
}

/**
 * The identity strip at the top of both experiences.
 *
 * It names the *signed-in account*, and it does so on every screen for one
 * reason: a helper adding a symptom to the wrong person's record is the single
 * most damaging mistake this app can help someone make. Who you are is fixed
 * here; whose record you are looking at is stated separately, next to the
 * content it applies to.
 */
export function IdentityHeader({
  name,
  context,
  onOpenSettings,
  testID,
}: IdentityHeaderProps): React.JSX.Element {
  return (
    <View style={styles.header} testID={testID}>
      <Avatar name={name} size={44} />
      <View style={styles.identity}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {context}
        </Text>
      </View>
      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Settings, privacy and security"
        style={styles.iconButton}
        testID="header-settings"
      >
        <Ionicons name="settings-outline" size={22} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

/**
 * Present on every launch of a demonstration build, above the fold.
 *
 * Somebody being shown this app is looking at invented medical records, and
 * they should not have to reach a settings screen to find that out.
 */
export function DemoNotice(): React.JSX.Element | null {
  if (!isDemoBuild()) return null;
  return (
    <Badge
      label="Demonstration — these records are fictional"
      tone="warning"
      icon="eye-outline"
      testID="demo-badge"
    />
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceQuiet,
    borderRadius: touchTarget.min / 2,
    height: touchTarget.min,
    justifyContent: 'center',
    width: touchTarget.min,
  },
  identity: { flex: 1 },
});
