import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Callout, Screen, Text, TextField } from '@/components';
import { AuthError, authService } from '@/services/auth/authService';
import { useSessionStore } from '@/state/sessionStore';
import { spacing } from '@/theme';

/**
 * Create an account.
 *
 * TODO(backend): Cognito sign-up returns an unconfirmed user and emails a
 * code. Insert a `/verify` step between this screen and the dashboard, and
 * carry the `session` through it.
 */
export default function SignUpScreen(): React.JSX.Element {
  const router = useRouter();
  const signIn = useSessionStore((state) => state.signIn);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      const session = await authService.signUp({ email, password, fullName, location });
      signIn(session);
      router.replace('/');
    } catch (caught) {
      setError(
        caught instanceof AuthError ? caught.message : 'Could not create the account. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button
            label="Create account"
            onPress={() => void handleSubmit()}
            loading={submitting}
            testID="sign-up-submit"
          />
          <Button
            label="I already have an account"
            variant="ghost"
            onPress={() => router.back()}
            testID="sign-up-back"
          />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Create your account
      </Text>
      <Text variant="callout" tone="secondary" style={styles.intro}>
        One account covers every parent you look after. You can add them once you are in.
      </Text>

      <TextField
        label="Your name"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
        placeholder="Ananya Rao"
        required
        testID="sign-up-name"
      />

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
        testID="sign-up-email"
      />

      <TextField
        label="Where you live"
        value={location}
        onChangeText={setLocation}
        placeholder="Berlin, Germany"
        hint="Used to show appointment times in both your time zone and your parent’s."
        testID="sign-up-location"
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="At least 8 characters"
        required
        testID="sign-up-password"
      />

      {error ? <Callout tone="danger" message={error} testID="sign-up-error" /> : null}

      <Callout
        tone="neutral"
        message="You can turn on a fingerprint, face or PIN lock straight after signing up, from Settings → Security."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.sm, marginTop: spacing.xl },
  intro: { marginBottom: spacing.xxl },
});
