/**
 * Global Jest setup.
 *
 * Every Expo native module used by the app is mocked here so unit tests never
 * touch a real device API. Individual tests can override any of these with
 * `jest.mocked(...)` / `jest.spyOn(...)`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Icon fonts pull in expo-font/expo-asset, which need a native runtime. Icons
// are decoration here — every one is paired with a text label — so a stub keeps
// the component tests honest without a font loader.
jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return new Proxy({} as Record<string, unknown>, { get: () => View });
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1, 2]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(async (_algo: string, value: string) => `digest:${value}`),
  getRandomBytesAsync: jest.fn(async (n: number) => new Uint8Array(n).fill(7)),
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
}));

jest.mock('expo-calendar', () => ({
  requestCalendarPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCalendarPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCalendarsAsync: jest.fn(async () => [
    { id: 'cal-1', title: 'Personal', allowsModifications: true, source: { name: 'Local' } },
  ]),
  getDefaultCalendarAsync: jest.fn(async () => ({ id: 'cal-1', title: 'Personal' })),
  createEventAsync: jest.fn(async () => 'event-1'),
  deleteEventAsync: jest.fn(async () => undefined),
  EntityTypes: { EVENT: 'event' },
  CalendarAccessLevel: { OWNER: 'owner' },
  Availability: { BUSY: 'busy' },
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///document/' }, cache: { uri: 'file:///cache/' } },
  File: jest.fn(),
  Directory: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: jest.fn(() => true),
  }),
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  Link: 'Link',
  Stack: { Screen: 'Stack.Screen' },
  Tabs: { Screen: 'Tabs.Screen' },
  Redirect: 'Redirect',
}));

// Silence the animation frame warnings React Native emits in the jsdom-ish env.
jest.spyOn(console, 'warn').mockImplementation(() => undefined);
