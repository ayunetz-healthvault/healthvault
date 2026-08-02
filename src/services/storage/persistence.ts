import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local record cache.
 *
 * The app is offline-first by necessity: a caregiver in Toronto often opens it
 * on a weak connection right after a phone call from India. Stores write here
 * immediately and reconcile with DynamoDB later.
 *
 * TODO(security): once real patient data flows through, move this to an
 * encrypted store (SQLCipher via `op-sqlite`, or an app-level envelope key held
 * in SecureStore). AsyncStorage is plaintext on a rooted device.
 */

export const STORAGE_KEYS = {
  parents: 'ayunetz.v1.parents',
  documents: 'ayunetz.v1.documents',
  summaries: 'ayunetz.v1.summaries',
  followUps: 'ayunetz.v1.followUps',
  session: 'ayunetz.v1.session',
  privacy: 'ayunetz.v1.privacy',
  onboarding: 'ayunetz.v1.onboarding',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const persistence = {
  async read<T>(key: StorageKey): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      // Corrupt payload — drop it rather than wedging the app on every launch.
      await AsyncStorage.removeItem(key).catch(() => undefined);
      return null;
    }
  },

  async write<T>(key: StorageKey, value: T): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },

  async remove(key: StorageKey): Promise<void> {
    await AsyncStorage.removeItem(key);
  },

  /** Wipes every app-owned key. Used by "Delete my account" and by tests. */
  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  },
};

/**
 * Adapter shaped for zustand's `persist` middleware.
 * Kept separate so stores do not import AsyncStorage directly.
 */
export const zustandStorage = {
  getItem: async (name: string): Promise<string | null> => AsyncStorage.getItem(name),
  setItem: async (name: string, value: string): Promise<void> => AsyncStorage.setItem(name, value),
  removeItem: async (name: string): Promise<void> => AsyncStorage.removeItem(name),
};
