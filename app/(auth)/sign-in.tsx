import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Screen, Text, TextField } from '@/components';
import { AuthError, authService } from '@/services/auth/authService';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radius, spacing } from '@/theme';

/**
 * Sign in.
 *
 * The form is real and validated; the backend behind it is not. Until the
 * Cognito user pool exists, `authService` mints a local mock session — see the
 * notice rendered below, which is deliberately visible rather than hidden in a
 * build flag so nobody mistakes the demo for the real thing.
 */
export default function SignInScreen(): React.JSX.Element {
  const router = useRouter();
  const signIn = useSessionStore((state) => state.signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      const session = await authService.signIn({ email, password });
      signIn(session);
      router.replace('/');
    } catch (caught) {
      setError(
        caught instanceof AuthError ? caught.message : 'Could not sign in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const session = await authService.signInAsDemo();
      signIn(session);
      router.replace('/');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button
            label="Sign in"
            onPress={() => void handleSubmit()}
            loading={submitting}
            testID="sign-in-submit"
          />
          <Button
            label="Create an account"
            variant="ghost"
            onPress={() => router.push('/sign-up')}
            testID="sign-in-to-sign-up"
          />
        </>
      }
    >
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Ionicons name="shield-checkmark" size={36} color={colors.onPrimary} />
        </View>
        <Text variant="title" align="center">
          Ayunetz Health Vault
        </Text>
        <Text variant="callout" tone="secondary" align="center" style={styles.tagline}>
          Look after your parents’ health records from wherever you are.
        </Text>
      </View>

      {authService.isMock ? (
        <Callout
          tone="info"
          title="Demo build"
          message="Authentication is not connected to a server yet. Any email with a password of 8 or more characters will sign you in locally, or tap “Explore the demo” to skip straight in."
          testID="sign-in-mock-notice"
        />
      ) : null}

      <View style={styles.form}>
        <TextField
          label="Email address"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          required
          testID="sign-in-email"
        />

        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="password"
          textContentType="password"
          placeholder="At least 8 characters"
          required
          testID="sign-in-password"
        />

        <Button
          label={showPassword ? 'Hide password' : 'Show password'}
          variant="ghost"
          size="medium"
          fullWidth={false}
          icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
          onPress={() => setShowPassword((current) => !current)}
          style={styles.toggle}
        />

        {error ? <Callout tone="danger" message={error} testID="sign-in-error" /> : null}
      </View>

      <View style={styles.demo}>
        <Text variant="caption" tone="muted" align="center" style={styles.demoLabel}>
          Just looking around?
        </Text>
        <Button
          label="Explore the demo"
          variant="secondary"
          icon="play-circle-outline"
          onPress={() => void handleDemo()}
          disabled={submitting}
          testID="sign-in-demo"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginBottom: spacing.xxl, paddingTop: spacing.xxl },
  demo: { marginTop: spacing.xxxl },
  demoLabel: { marginBottom: spacing.md },
  form: { marginTop: spacing.xxl },
  logo: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 76,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 76,
  },
  tagline: { marginTop: spacing.sm, maxWidth: 320 },
  toggle: { marginBottom: spacing.md, marginTop: -spacing.sm },
});
