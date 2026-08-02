import * as LocalAuthentication from 'expo-local-authentication';

import { PIN_LENGTH, appLock, isValidPinFormat } from './appLock';

beforeEach(async () => {
  jest.clearAllMocks();
  await appLock.clearPin();
});

describe('isValidPinFormat', () => {
  it('accepts exactly the required number of digits', () => {
    expect(isValidPinFormat('1'.repeat(PIN_LENGTH))).toBe(true);
  });

  it.each(['12345', '1234567', 'abcdef', '12 456', ''])('rejects %p', (value) => {
    expect(isValidPinFormat(value)).toBe(false);
  });
});

describe('PIN storage', () => {
  it('has no PIN to begin with', async () => {
    await expect(appLock.hasPin()).resolves.toBe(false);
  });

  it('verifies the PIN that was set', async () => {
    await appLock.setPin('123456');

    await expect(appLock.hasPin()).resolves.toBe(true);
    await expect(appLock.verifyPin('123456')).resolves.toBe(true);
  });

  it('rejects the wrong PIN', async () => {
    await appLock.setPin('123456');
    await expect(appLock.verifyPin('654321')).resolves.toBe(false);
  });

  it('refuses to set a PIN of the wrong length', async () => {
    await expect(appLock.setPin('123')).rejects.toThrow(/exactly 6 digits/);
  });

  it('fails verification once the PIN is cleared', async () => {
    await appLock.setPin('123456');
    await appLock.clearPin();

    await expect(appLock.hasPin()).resolves.toBe(false);
    await expect(appLock.verifyPin('123456')).resolves.toBe(false);
  });
});

describe('getBiometricCapability', () => {
  it('reports face unlock when the device supports it', async () => {
    const capability = await appLock.getBiometricCapability();

    expect(capability.available).toBe(true);
    expect(capability.label).toBe('Use face unlock');
  });

  it('is unavailable when nothing is enrolled', async () => {
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValueOnce(false);

    const capability = await appLock.getBiometricCapability();

    expect(capability.available).toBe(false);
    expect(capability.hasHardware).toBe(true);
  });

  it('degrades gracefully when the platform call throws', async () => {
    jest
      .mocked(LocalAuthentication.hasHardwareAsync)
      .mockRejectedValueOnce(new Error('no biometrics module'));

    await expect(appLock.getBiometricCapability()).resolves.toMatchObject({ available: false });
  });
});

describe('resolveEffectiveMethod', () => {
  it('leaves "none" alone', async () => {
    await expect(appLock.resolveEffectiveMethod('none')).resolves.toBe('none');
  });

  it('honours biometrics when they are available', async () => {
    await expect(appLock.resolveEffectiveMethod('biometric')).resolves.toBe('biometric');
  });

  it('falls back to the PIN when biometrics are not enrolled', async () => {
    await appLock.setPin('123456');
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValueOnce(false);

    await expect(appLock.resolveEffectiveMethod('biometric')).resolves.toBe('pin');
  });

  it('falls back to no lock when biometrics fail and there is no PIN', async () => {
    jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValueOnce(false);

    await expect(appLock.resolveEffectiveMethod('biometric')).resolves.toBe('none');
  });

  it('downgrades a PIN preference to none when no PIN is set', async () => {
    await expect(appLock.resolveEffectiveMethod('pin')).resolves.toBe('none');
  });
});

describe('authenticateWithBiometrics', () => {
  it('passes through a successful prompt', async () => {
    await expect(appLock.authenticateWithBiometrics()).resolves.toBe(true);
  });

  it('returns false when the user cancels', async () => {
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValueOnce({ success: false, error: 'user_cancel' } as never);

    await expect(appLock.authenticateWithBiometrics()).resolves.toBe(false);
  });

  it('returns false rather than throwing when the module errors', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockRejectedValueOnce(new Error('boom'));

    await expect(appLock.authenticateWithBiometrics()).resolves.toBe(false);
  });
});
