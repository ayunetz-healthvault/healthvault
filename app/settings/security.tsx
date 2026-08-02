import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Card, ChipSelect, ListRow, Screen, Text, TextField } from '@/components';
import { PIN_LENGTH, appLock, isValidPinFormat } from '@/services/auth/appLock';
import { useSessionStore } from '@/state/sessionStore';
import { colors, spacing } from '@/theme';
import type { AppLockMethod } from '@/types/domain';

const AUTO_LOCK_OPTIONS = [
  { value: '0', label: 'Immediately' },
  { value: '1', label: 'After 1 minute' },
  { value: '5', label: 'After 5 minutes' },
  { value: '15', label: 'After 15 minutes' },
];

/**
 * App lock configuration.
 *
 * Biometrics cannot be chosen without a PIN already set — a fingerprint that
 * stops working (wet hands, a new phone case, a cut finger) must never be the
 * only way into someone's medical records.
 */
export default function SecuritySettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const privacy = useSessionStore((state) => state.privacy);
  const setLockMethod = useSessionStore((state) => state.setLockMethod);
  const updatePrivacy = useSessionStore((state) => state.updatePrivacy);

  const [hasPin, setHasPin] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Fingerprint or face');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPinForm, setShowPinForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [capability, pinSet] = await Promise.all([
        appLock.getBiometricCapability(),
        appLock.hasPin(),
      ]);
      if (cancelled) return;
      setBiometricAvailable(capability.available);
      setBiometricLabel(capability.label.replace('Use ', ''));
      setHasPin(pinSet);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSavePin = async (): Promise<void> => {
    if (!isValidPinFormat(pin)) {
      setPinError(`The PIN must be exactly ${PIN_LENGTH} digits.`);
      return;
    }
    if (pin !== confirmPin) {
      setPinError('The two PINs do not match.');
      return;
    }
    await appLock.setPin(pin);
    setHasPin(true);
    setPin('');
    setConfirmPin('');
    setPinError(undefined);
    setShowPinForm(false);
    setLockMethod('pin');
    setNotice('PIN saved. The vault will ask for it when you come back.');
  };

  const handleMethodChange = async (method: AppLockMethod): Promise<void> => {
    setNotice(null);

    if (method === 'none') {
      setLockMethod('none');
      setNotice('App lock is off. Anyone with this phone unlocked can open your records.');
      return;
    }

    if (!hasPin) {
      setShowPinForm(true);
      setNotice('Set a PIN first — it is the fallback if biometrics ever fail.');
      return;
    }

    if (method === 'biometric') {
      if (!biometricAvailable) {
        setNotice('This phone has no fingerprint or face unlock set up, so the PIN will be used.');
        setLockMethod('pin');
        return;
      }
      const ok = await appLock.authenticateWithBiometrics('Confirm it is you');
      if (!ok) {
        setNotice('That did not match, so the lock method was not changed.');
        return;
      }
    }

    setLockMethod(method);
    setNotice(method === 'biometric' ? `${biometricLabel} lock is on.` : 'PIN lock is on.');
  };

  const handleRemovePin = async (): Promise<void> => {
    await appLock.clearPin();
    setHasPin(false);
    setLockMethod('none');
    setNotice('PIN removed and app lock turned off.');
  };

  return (
    <Screen
      testID="settings-security-screen"
      footer={<Button label="Done" onPress={() => router.back()} testID="security-done" />}
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Security
      </Text>
      <Text variant="callout" tone="secondary" style={styles.intro}>
        Lock the vault so a lost or borrowed phone does not expose your family’s medical records.
      </Text>

      {notice ? <Callout tone="info" message={notice} testID="security-notice" /> : null}

      <ChipSelect
        label="Lock the app with"
        options={[
          { value: 'none' as const, label: 'Nothing' },
          { value: 'pin' as const, label: 'A PIN' },
          { value: 'biometric' as const, label: biometricLabel },
        ]}
        value={privacy.lockMethod}
        onChange={(value) => void handleMethodChange(value)}
        hint={
          biometricAvailable
            ? 'Biometrics always keep the PIN as a backup.'
            : 'No fingerprint or face unlock is set up on this phone.'
        }
        testID="security-method"
      />

      {privacy.lockMethod !== 'none' ? (
        <ChipSelect
          label="Lock again"
          options={AUTO_LOCK_OPTIONS}
          value={String(privacy.autoLockMinutes)}
          onChange={(value) => updatePrivacy({ autoLockMinutes: Number(value) })}
          hint="How long the app can sit in the background before it asks again."
          testID="security-autolock"
        />
      ) : null}

      <Card padded={false} style={styles.group}>
        <ListRow
          title={hasPin ? 'Change PIN' : 'Set a PIN'}
          subtitle={
            hasPin ? `A ${PIN_LENGTH}-digit PIN is set` : 'Needed before biometrics can be used'
          }
          icon="keypad-outline"
          onPress={() => setShowPinForm((current) => !current)}
          testID="security-pin-row"
        />
        {hasPin ? (
          <>
            <View style={styles.divider} />
            <ListRow
              title="Remove PIN"
              subtitle="This also turns off the app lock"
              icon="trash-outline"
              destructive
              onPress={() => void handleRemovePin()}
              testID="security-remove-pin"
            />
          </>
        ) : null}
      </Card>

      {showPinForm ? (
        <View style={styles.pinForm}>
          <TextField
            label={`New ${PIN_LENGTH}-digit PIN`}
            value={pin}
            onChangeText={(value) => {
              setPin(value.replace(/\D/g, '').slice(0, PIN_LENGTH));
              setPinError(undefined);
            }}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="••••••"
            testID="security-pin"
          />
          <TextField
            label="Confirm PIN"
            value={confirmPin}
            onChangeText={(value) => {
              setConfirmPin(value.replace(/\D/g, '').slice(0, PIN_LENGTH));
              setPinError(undefined);
            }}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="••••••"
            error={pinError}
            testID="security-pin-confirm"
          />
          <Button
            label="Save PIN"
            onPress={() => void handleSavePin()}
            testID="security-save-pin"
          />
        </View>
      ) : null}

      <Callout
        tone="neutral"
        title="How the PIN is stored"
        message="Your PIN itself is never saved. Only a salted hash of it is kept in the phone's secure keychain, which is not included in cloud backups."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  divider: { backgroundColor: colors.border, height: 1, marginLeft: spacing.giant + spacing.lg },
  group: { marginBottom: spacing.lg, overflow: 'hidden' },
  heading: { marginBottom: spacing.sm, marginTop: spacing.lg },
  intro: { marginBottom: spacing.xl },
  pinForm: { marginBottom: spacing.lg },
});
