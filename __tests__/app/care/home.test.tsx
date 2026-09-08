import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import CaregiverHomeScreen from '../../../app/care/index';

import { useSessionStore } from '@/state/sessionStore';
import { useVaultStore } from '@/state/vaultStore';
import type { FollowUp, MedicalDocument, ParentProfile } from '@/types/domain';

/**
 * The caregiver's home screen.
 *
 * These tests are mostly about what the screen is *not* allowed to say. The
 * numbers and lists are the easy part; the failure mode that matters is a
 * dashboard that turns "nothing is filed" into "everyone is fine", or that
 * shows a count with no person attached to it.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * `render` is awaited deliberately. Under React 19 the testing library flushes
 * the tree asynchronously, so `screen` is still empty on the next synchronous
 * line and every query fails with "render function has not been called".
 */
const renderScreen = async (): Promise<void> => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CaregiverHomeScreen />
    </SafeAreaProvider>,
  );
};

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

const overdueFollowUp = (id: string, parentId: string, title: string): FollowUp => ({
  id,
  parentId,
  title,
  kind: 'doctor_visit',
  dueDate: '2020-01-01',
  dueTime: null,
  notes: '',
  status: 'scheduled',
  sourceDocumentId: null,
  doctorCategory: null,
  calendarEventId: null,
  createdAt: '2019-12-01T00:00:00.000Z',
  updatedAt: '2019-12-01T00:00:00.000Z',
});

const readyDocument = (id: string, parentId: string): MedicalDocument => ({
  id,
  parentId,
  title: 'Blood test report',
  category: 'lab_report',
  documentDate: '2026-09-01',
  pages: [],
  status: 'ready',
  uploadProgress: 100,
  summaryId: 'sum_1',
  failureReason: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

beforeEach(() => {
  useVaultStore.setState({ parents: [], documents: [], summaries: [], followUps: [] });
  useSessionStore.setState({
    user: {
      id: 'usr_1',
      email: 'sujay@example.invalid',
      fullName: 'Sujay Das',
      location: 'Berlin, Germany',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
});

describe('caregiver home', () => {
  it('asks a brand-new account to add somebody, rather than showing empty sections', async () => {
    await renderScreen();

    expect(screen.getByTestId('care-home-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('care-home-attention-header')).toBeNull();
  });

  it('names the signed-in account in the header, not the record being viewed', async () => {
    useVaultStore.setState({ parents: [parent('p1', 'Meera Nair')] });
    await renderScreen();

    expect(screen.getByTestId('care-header')).toBeTruthy();
    expect(screen.getByText('Sujay Das')).toBeTruthy();
    expect(screen.getByText('Family space')).toBeTruthy();
  });

  it('lists every person the account can see', async () => {
    useVaultStore.setState({
      parents: [parent('p1', 'Meera Nair'), parent('p2', 'Ravi Nair')],
    });
    await renderScreen();

    expect(screen.getByTestId('parent-card-p1')).toBeTruthy();
    expect(screen.getByTestId('parent-card-p2')).toBeTruthy();
  });

  it('shows a passed due date as something to act on, attached to a named person', async () => {
    useVaultStore.setState({
      parents: [parent('p1', 'Meera Nair')],
      followUps: [overdueFollowUp('f1', 'p1', 'Repeat blood sugar test')],
    });
    await renderScreen();

    // It appears twice on purpose: once under "Needs your attention" because
    // the date has passed, and once under "Coming up" because it is still a
    // scheduled step. The reference keeps the overdue copy above the other.
    expect(screen.getAllByText('Repeat blood sugar test')).toHaveLength(2);

    // The attention item carries the record it belongs to. A count with no
    // person on it is how a helper acts on the wrong parent.
    const attention = screen.getByTestId('care-home-attention-attention_followup_f1');
    expect(attention).toBeTruthy();
    expect(attention.props.accessibilityLabel).toContain('Meera Nair');
  });

  it('shows a finished summary as something to check, not as a result', async () => {
    useVaultStore.setState({
      parents: [parent('p1', 'Meera Nair')],
      documents: [readyDocument('d1', 'p1')],
    });
    await renderScreen();

    expect(
      screen.getByText(/Check it against the original before relying on it/i),
    ).toBeTruthy();
  });

  /**
   * The rule from DESIGN.md: never call a parent "healthy", "safe" or "all
   * clear" because nothing is outstanding.
   */
  it('describes an empty attention list as paperwork, never as health', async () => {
    useVaultStore.setState({ parents: [parent('p1', 'Meera Nair')] });
    await renderScreen();

    const empty = screen.getByTestId('care-home-attention-empty');
    expect(empty).toBeTruthy();

    for (const forbidden of [/all clear/i, /healthy/i, /is fine/i, /doing well/i, /\bsafe\b/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
    expect(screen.getByText(/not about how anyone is feeling/i)).toBeTruthy();
  });

  it('says nothing is scheduled rather than inventing a next appointment', async () => {
    useVaultStore.setState({ parents: [parent('p1', 'Meera Nair')] });
    await renderScreen();

    expect(screen.getByTestId('care-home-upcoming-empty')).toBeTruthy();
  });

  it('offers both shortcuts the reference puts at the foot of the screen', async () => {
    useVaultStore.setState({ parents: [parent('p1', 'Meera Nair')] });
    await renderScreen();

    expect(screen.getByTestId('care-home-add-document')).toBeTruthy();
    expect(screen.getByTestId('care-home-tasks')).toBeTruthy();
  });
});
