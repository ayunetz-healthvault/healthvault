import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RecordExportScreen from '../../../app/parent/[id]/export';

import { useVaultStore } from '@/state/vaultStore';
import type { ParentProfile } from '@/types/domain';

/**
 * Taking a copy of one person's record.
 *
 * The screen offered "a copy of Amma's record" and called the account-wide
 * export, so somebody helping with two parents got both people's medical
 * histories in one file. The other half of the same failure: the copy was
 * assembled and then went nowhere, because nothing wrote a file.
 *
 * These prove both, with the network and the file system mocked. What they do
 * not prove is a real share sheet on a real phone — that needs a device, and
 * PROGRESS.md says so.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'pat_1' }),
}));

jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  isBackendEnabled: () => true,
}));

const mockExportRecord = jest.fn();
const mockRequestDataExport = jest.fn();
const mockSaveRecordExport = jest.fn();

jest.mock('@/services/account/accountService', () => ({
  accountService: {
    exportRecord: (...args: unknown[]) => mockExportRecord(...args),
    requestDataExport: (...args: unknown[]) => mockRequestDataExport(...args),
    deleteRecord: jest.fn(async () => ({ outcome: 'deleted' })),
  },
}));

jest.mock('@/services/account/exportFile', () => ({
  saveRecordExport: (...args: unknown[]) => mockSaveRecordExport(...args),
}));

const parent = (id: string, fullName: string): ParentProfile => ({
  id,
  fullName,
  relationship: 'mother',
  dateOfBirth: '1957-04-02',
  bloodGroup: 'O+',
  city: 'Kochi',
  phone: '',
  conditions: [],
  allergies: [],
  primaryDoctor: '',
  notes: '',
  avatarColor: '#145B48',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const renderScreen = async (): Promise<void> => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <RecordExportScreen />
    </SafeAreaProvider>,
  );
};

beforeEach(() => {
  mockExportRecord.mockReset();
  mockRequestDataExport.mockReset();
  mockSaveRecordExport.mockReset();
  mockExportRecord.mockResolvedValue({
    outcome: 'ready',
    exportedAt: '2026-09-08T10:00:00.000Z',
    exportedUnderRole: 'self',
    record: { patient: { patientId: 'pat_1' } },
  });
  mockSaveRecordExport.mockResolvedValue({
    outcome: 'shared',
    fileName: 'meera-nair-record-2026-09-08.json',
  });

  useVaultStore.getState().clearAll();
  // Two accessible parents, which is the case the bug turned into a disclosure.
  useVaultStore.setState({
    parents: [parent('pat_1', 'Meera Nair'), parent('pat_2', 'Ravi Menon')],
  });
});

describe('taking a copy of this person’s record', () => {
  it('asks for this record only, never the whole account', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('record-export-button'));

    await waitFor(() => expect(mockExportRecord).toHaveBeenCalledWith('pat_1'));
    expect(mockRequestDataExport).not.toHaveBeenCalled();
  });

  /** The other parent this account can reach is not in the file. */
  it('does not include the other parent this account helps with', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('record-export-button'));

    await waitFor(() => expect(mockSaveRecordExport).toHaveBeenCalled());
    const [name, , payload] = mockSaveRecordExport.mock.calls[0] as [string, string, unknown];
    expect(name).toBe('Meera Nair');
    expect(JSON.stringify(payload)).not.toContain('pat_2');
  });

  it('writes a file the person can keep, and says where it went', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('record-export-button'));

    const notice = await screen.findByTestId('record-export-notice');
    expect(notice).toBeTruthy();
    expect(screen.getByText(/meera-nair-record-2026-09-08\.json/)).toBeTruthy();
  });

  /**
   * The links to the original pages expire. Saying so is the difference between
   * an export somebody understands and one they discover is half-empty a week
   * later.
   */
  it('says the page links inside it stop working', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('record-export-button'));

    expect(await screen.findByText(/stop working/i)).toBeTruthy();
  });

  it('reports a copy that could not be saved, without claiming one was', async () => {
    mockSaveRecordExport.mockResolvedValue({
      outcome: 'failed',
      message: 'The copy could not be saved to this phone. Nothing has changed.',
    });

    await renderScreen();
    fireEvent.press(screen.getByTestId('record-export-button'));

    expect(await screen.findByTestId('record-export-error')).toBeTruthy();
    expect(screen.queryByTestId('record-export-notice')).toBeNull();
  });

  it('says a build with no server has nothing to fetch', async () => {
    mockExportRecord.mockResolvedValue({
      outcome: 'no_backend',
      exportedAt: '2026-09-08T10:00:00.000Z',
    });

    await renderScreen();
    fireEvent.press(screen.getByTestId('record-export-button'));

    expect(await screen.findByText(/only on this phone/i)).toBeTruthy();
    expect(mockSaveRecordExport).not.toHaveBeenCalled();
  });
});
