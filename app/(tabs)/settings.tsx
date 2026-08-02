import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar, Card, ConfirmDialog, ListRow, Screen, SectionHeader, Text } from '@/components';
import { config } from '@/config/env';
import { useSessionStore } from '@/state/sessionStore';
import { useVaultStore } from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import { maskEmail, pluralise } from '@/utils/format';

const LOCK_LABELS = {
  none: 'Off',
  pin: 'PIN',
  biometric: 'Fingerprint or face',
} as const;

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const [signOutVisible, setSignOutVisible] = useState(false);

  const user = useSessionStore((state) => state.user);
  const privacy = useSessionStore((state) => state.privacy);
  const signOut = useSessionStore((state) => state.signOut);

  const parentCount = useVaultStore((state) => state.parents.length);
  const documentCount = useVaultStore((state) => state.documents.length);

  const handleSignOut = async (): Promise<void> => {
    setSignOutVisible(false);
    await signOut();
    router.replace('/sign-in');
  };

  return (
    <Screen testID="settings">
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Settings
      </Text>

      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          <Avatar name={user?.fullName ?? 'You'} size={60} />
          <View style={styles.profileText}>
            <Text variant="subheading" numberOfLines={1}>
              {user?.fullName ?? 'Signed in'}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {user?.email ? maskEmail(user.email) : '—'}
            </Text>
            {user?.location ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {user.location}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.stats}>
          <Text variant="caption" tone="muted">
            {pluralise(parentCount, 'parent')}
          </Text>
          <Text variant="caption" tone="muted">
            {pluralise(documentCount, 'document')}
          </Text>
        </View>
      </Card>

      <SectionHeader title="Security" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="App lock"
          subtitle={`Currently: ${LOCK_LABELS[privacy.lockMethod]}`}
          icon="lock-closed-outline"
          onPress={() => router.push('/settings/security')}
          testID="settings-security"
        />
      </Card>

      <SectionHeader title="Privacy and data" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="Privacy settings"
          subtitle="Calendar, analytics and data sharing"
          icon="shield-checkmark-outline"
          onPress={() => router.push('/settings/privacy')}
          testID="settings-privacy"
        />
        <View style={styles.divider} />
        <ListRow
          title="Delete data or account"
          subtitle="Remove documents, or close the account entirely"
          icon="trash-outline"
          destructive
          onPress={() => router.push('/settings/delete')}
          testID="settings-delete"
        />
      </Card>

      <SectionHeader title="About" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="Medical disclaimer"
          subtitle="What this app does and does not do"
          icon="information-circle-outline"
          onPress={() => router.push('/settings/disclaimer')}
          testID="settings-disclaimer"
        />
        <View style={styles.divider} />
        <ListRow
          title="Version"
          subtitle={`0.1.0 · ${config.environment}${config.useMocks ? ' · demo data' : ''}`}
          icon="cube-outline"
          testID="settings-version"
        />
        <View style={styles.divider} />
        <ListRow
          title="Where your data is stored"
          subtitle={`AWS ${config.aws.region} (Mumbai)`}
          icon="server-outline"
          testID="settings-region"
        />
      </Card>

      <SectionHeader title="Account" />
      <Card padded={false} style={styles.group}>
        <ListRow
          title="Sign out"
          subtitle="Records stay on this device until you delete them"
          icon="log-out-outline"
          onPress={() => setSignOutVisible(true)}
          testID="settings-sign-out"
        />
      </Card>

      <ConfirmDialog
        visible={signOutVisible}
        title="Sign out?"
        message="You will need your email and password to get back in. Nothing is deleted."
        confirmLabel="Sign out"
        onConfirm={() => void handleSignOut()}
        onCancel={() => setSignOutVisible(false)}
        testID="sign-out-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  divider: { backgroundColor: colors.border, height: 1, marginLeft: spacing.giant + spacing.lg },
  group: { overflow: 'hidden' },
  heading: { marginBottom: spacing.xl, paddingTop: spacing.sm },
  profileCard: { marginBottom: spacing.sm },
  profileRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.lg },
  profileText: { flex: 1, gap: spacing.xxs },
  stats: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
});
