import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ConsentScreen from '../../../app/parent/[id]/consent';

import { useVaultStore } from '@/state/vaultStore';
import type { ParentProfile } from '@/types/domain';

/**
 * The consent screen.
 *
 * These tests are about what the screen refuses to claim. Two failures matter
 * more than anything it renders correctly: showing a switch as "off" when the
 * server could not be reached — off is an answer, and it is not one this
 * screen was given — and letting somebody withdraw consent without being told
 * what that does and does not undo.
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

const mockCurrent = jest.fn();
const mockDecide = jest.fn();

jest.mock('@/services/consent/consentService', () => ({
  ...jest.requireActual('@/services/consent/consentService'),
  consentService: {
    current: (...args: unknown[]) => mockCurrent(...args),
    decide: (...args: unknown[]) => mockDecide(...args),
  },
}));

const parent: ParentProfile = {
  id: 'pat_1',
  fullName: 'Meera Nair',
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
};

const view = (granted: boolean, patch: Record<string, unknown> = {}) => ({
  noticeVersion: '2026-09-08.1',
  consent: [
    {
      purpose: 'ai_processing',
      granted,
      needsReconsent: false,
      withdrawalEffect:
        'New documents will be stored but not summarised. Text already sent to the provider cannot be recalled.',
      decidedAt: '2026-09-08T10:00:00.000Z',
      decidedBy: 'acc_alice',
      onBehalfOfPatient: false,
      ...patch,
    },
  ],
});

const renderScreen = async (): Promise<void> => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ConsentScreen />
    </SafeAreaProvider>,
  );
};

beforeEach(() => {
  mockCurrent.mockReset();
  mockDecide.mockReset();
  useVaultStore.getState().clearAll();
  useVaultStore.setState({ parents: [parent] });
});

describe('showing what has been agreed', () => {
  it('names each purpose separately', async () => {
    mockCurrent.mockResolvedValue(view(true));

    await renderScreen();

    expect(await screen.findByText('Read reports automatically')).toBeTruthy();
  });

  it('says when a family member answered instead of the person', async () => {
    mockCurrent.mockResolvedValue(view(true, { onBehalfOfPatient: true }));

    await renderScreen();

    expect(await screen.findByText('Answered by a family member')).toBeTruthy();
  });

  it('flags a decision made against wording that has since changed', async () => {
    mockCurrent.mockResolvedValue(view(true, { needsReconsent: true }));

    await renderScreen();

    expect(await screen.findByText('Wording has changed')).toBeTruthy();
  });

  /**
   * The important refusal. An unreachable server means this screen does not
   * know, and "off" is a claim about somebody's data it has no basis for.
   */
  it('shows nothing rather than "off" when it cannot reach the server', async () => {
    mockCurrent.mockRejectedValue(new Error('offline'));

    await renderScreen();

    expect(await screen.findByTestId('consent-error')).toBeTruthy();
    expect(screen.queryByTestId('consent-ai_processing')).toBeNull();
  });
});

describe('changing an answer', () => {
  it('records agreement straight away', async () => {
    mockCurrent.mockResolvedValue(view(false));
    mockDecide.mockResolvedValue({ outcome: 'recorded', view: view(true) });

    await renderScreen();
    await screen.findByText('Read reports automatically');

    /**
     * `valueChange` rather than a press: a `Switch` is not a button, and
     * pressing one in the testing library does nothing. Firing the event the
     * component actually listens for is what a thumb does to a real switch.
     */
    fireEvent(screen.getByLabelText('Read reports automatically'), 'valueChange', true);

    expect(mockDecide).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'ai_processing', granted: true }),
    );
  });

  /**
   * Withdrawal is not the same gesture as agreement, and must not be one tap.
   * The consequences — including that nothing already sent can be recalled —
   * are stated before anything is recorded.
   */
  it('states the consequences before withdrawing, and records nothing yet', async () => {
    mockCurrent.mockResolvedValue(view(true));

    await renderScreen();
    await screen.findByText('Read reports automatically');

    fireEvent(screen.getByLabelText('Read reports automatically'), 'valueChange', false);

    expect(await screen.findByText(/cannot be recalled/)).toBeTruthy();
    expect(mockDecide).not.toHaveBeenCalled();
  });
});
