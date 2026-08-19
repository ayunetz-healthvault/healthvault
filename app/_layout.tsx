import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAutoLock } from '@/navigation/useAutoLock';
import { useRouteGuard } from '@/navigation/useRouteGuard';
import { authService } from '@/services/auth/authService';
import { restoreSession, useSessionStore } from '@/state/sessionStore';
import { useVaultStore } from '@/state/vaultStore';
import { colors } from '@/theme';

/**
 * Root layout: providers, one-time startup work, and the navigation stack.
 * The route guard lives here so every screen below is already gated.
 */
export default function RootLayout(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AppShell />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell(): React.JSX.Element {
  const [bootstrapped, setBootstrapped] = useState(false);
  const hydrated = useSessionStore((state) => state.hydrated);
  const seedDemoData = useVaultStore((state) => state.seedDemoData);

  useAutoLock();
  useRouteGuard();

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async (): Promise<void> => {
      // Point the API client at SecureStore before any request can fire.
      authService.initialise();
      await restoreSession();
      // Fictional records for a demonstration build. Refuses in a live build,
      // and is a no-op once the vault has records in it.
      seedDemoData();
      if (!cancelled) setBootstrapped(true);
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [seedDemoData]);

  if (!bootstrapped || !hydrated) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="lock" options={{ animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
