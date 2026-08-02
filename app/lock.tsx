import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Screen, Text, TextField } from '@/components';
import { MAX_PIN_ATTEMPTS, PIN_LENGTH, appLock } from '@/services/auth/appLock';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radius, spacing } from '@/theme';

/**
 * The lock screen.
 *
 * Biometric prompt fires automatically on mount when it is the chosen method,
 * because the alternative — making someone tap "Unlock" before the fingerprint
 * reader turns on — is friction for no security gain. The PIN is always
 * available as a fallback, and after `MAX_PIN_ATTEMPTS` failures the only way
 * back in is a full sign-in.
 */
export default function LockScreen(): React.JSX.Element {
  const router = useRouter();
  const lockMethod = useSessionStore((state) => state.privacy.lockMethod);
  const unlock = useSessionStore((state) => state.unlock);
  const signOut = useSessionStore((state) => state.signOut);
  const userName = useSessionStore((state) => state.user?.fullName ?? null);

  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState('Use device unlock');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [checking, setChecking] = useState(false);

  const lockedOut = attempts >= MAX_PIN_ATTEMPTS;

  const runBiometrics = useCallback(async (): Promise<void> => {
    setChecking(true);
    const success = await appLock.authenticateWithBiometrics();
    setChecking(false);
    if (success) {
      unlock();
      router.replace('/');
    } else {
      setError('That did not match. Try again, or enter your PIN.');
    }
  }, [router, unlock]);

  useEffect(() => {
    let cancelled = false;

    const prepare = async (): Promise<void> => {
      const capability = await appLock.getBiometricCapability();
      if (cancelled) return;
      setBiometricAvailable(capability.available);
      setBiometricLabel(capability.label);
      if (capability.available && lockMethod === 'biometric') {
        await runBiometrics();
      }
    };

    void prepare();
    return () => {
      cancelled = true;
    };
    // Runs once on mount; re-prompting on every state change would trap the
    // user in a loop of system dialogs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePinSubmit = async (): Promise<void> => {
    if (lockedOut) return;
    const valid = await appLock.verifyPin(pin);
    if (valid) {
      setAttempts(0);
      unlock();
      router.replace('/');
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    setPin('');
    setError(
      next >= MAX_PIN_ATTEMPTS
        ? 'Too many incorrect attempts. Please sign in again.'
        : `Incorrect PIN. ${MAX_PIN_ATTEMPTS - next} attempt${MAX_PIN_ATTEMPTS - next === 1 ? '' : 's'} left.`,
    );
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    router.replace('/sign-in');
  };

  return (
    <Screen
      scrollable={false}
      footer={
        lockedOut ? (
          <Button
            label="Sign in again"
            onPress={() => void handleSignOut()}
            testID="lock-signout"
          />
        ) : (
          <>
            <Button
              label="Unlock"
              onPress={() => void handlePinSubmit()}
              disabled={pin.length !== PIN_LENGTH}
              testID="lock-submit"
            />
            {biometricAvailable ? (
              <Button
                label={biometricLabel}
                variant="secondary"
                icon="finger-print"
                loading={checking}
                onPress={() => void runBiometrics()}
                testID="lock-biometric"
              />
            ) : null}
            <Button
              label="Sign out"
              variant="ghost"
              onPress={() => void handleSignOut()}
              testID="lock-signout"
            />
          </>
        )
      }
    >
      <View style={styles.header}>
        <View style={styles.lockIcon}>
          <Ionicons name="lock-closed" size={40} color={colors.primary} />
        </View>
        <Text variant="title" align="center">
          Vault locked
        </Text>
        <Text variant="callout" tone="secondary" align="center" style={styles.subtitle}>
          {userName ? `Welcome back, ${userName.split(' ')[0]}.` : 'Welcome back.'} Unlock to see
          your family’s records.
        </Text>
      </View>

      {lockedOut ? (
        <Callout
          tone="danger"
          title="Locked out"
          message="For safety, the vault has been locked after too many incorrect attempts. Sign in with your email and password to continue."
          testID="lock-locked-out"
        />
      ) : (
        <View style={styles.form}>
          <TextField
            label={`${PIN_LENGTH}-digit PIN`}
            value={pin}
            onChangeText={(value) => {
              setPin(value.replace(/\D/g, '').slice(0, PIN_LENGTH));
              setError(null);
            }}
            keyboardType="number-pad"
            secureTextEntry
            textContentType="password"
            placeholder="••••••"
            testID="lock-pin"
            {...(error === null ? {} : { error })}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: spacing.xl },
  header: { alignItems: 'center', paddingTop: spacing.giant },
  lockIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 96,
    justifyContent: 'center',
    marginBottom: spacing.xl,
    width: 96,
  },
  subtitle: { marginTop: spacing.sm, maxWidth: 320 },
});
