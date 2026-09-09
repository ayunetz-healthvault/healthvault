import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DocumentReviewScreen from '../../../app/document/[id]/review';

import { useVaultStore } from '@/state/vaultStore';
import type { DocumentSummary, MedicalDocument, ParentProfile } from '@/types/domain';

/**
 * Checking a summary against the original.
 *
 * The assertions that matter are about what the screen refuses to do: it never
 * overwrites what the app read, it never lets somebody tick "checked" with no
 * original in front of them, and it never describes a person's check as a
 * clinician's approval.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'doc_1' }),
}));

jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  isBackendEnabled: () => false,
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

const page = {
  id: 'pag_1',
  uri: 'file:///vault/1.jpg',
  kind: 'image' as const,
  source: 'camera' as const,
  fileName: 'page-1.jpg',
  sizeBytes: 10,
  width: 800,
  height: 1200,
  capturedAt: '2026-09-01T00:00:00.000Z',
};

const document = (withPages: boolean): MedicalDocument => ({
  id: 'doc_1',
  parentId: parent.id,
  title: 'Blood test report',
  category: 'lab_report',
  documentDate: '2026-09-01',
  pages: withPages ? [page] : [],
  status: 'ready',
  uploadProgress: 100,
  summaryId: 'sum_1',
  failureReason: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const summary = (patch: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: 'sum_1',
  documentId: 'doc_1',
  parentId: parent.id,
  overview: 'A routine blood test.',
  plainLanguageSummary: 'The numbers look much the same as last time.',
  findings: [
    {
      id: 'fnd_1',
      label: 'Fasting blood sugar',
      value: '142 mg/dL',
      referenceRange: '70–100',
      severity: 'attention',
      plainLanguage: 'Higher than the usual range.',
      sources: [],
    },
  ],
  medicines: [],
  instructions: [],
  recommendedDoctorCategory: 'general_physician',
  questionsForDoctor: [],
  confidence: 0.9,
  generatedBy: 'test',
  generatedAt: '2026-09-02T00:00:00.000Z',
  version: 1,
  ...patch,
});

const renderScreen = async (): Promise<void> => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <DocumentReviewScreen />
    </SafeAreaProvider>,
  );
};

beforeEach(() => {
  useVaultStore.getState().clearAll();
  useVaultStore.setState({
    parents: [parent],
    documents: [document(true)],
    summaries: [summary()],
  });
});

describe('checking a summary', () => {
  it('shows what the app read, field by field', async () => {
    await renderScreen();

    expect(screen.getByText('142 mg/dL')).toBeTruthy();
    expect(screen.getByText('Fasting blood sugar')).toBeTruthy();
  });

  /**
   * The correction is appended and the model's text stays visible. Losing the
   * original means nobody can tell whether the model was wrong or the corrector
   * was.
   */
  it('keeps what the app read after a correction', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('review-finding-0-correct'));
    fireEvent.changeText(await screen.findByTestId('review-correction-input'), '124 mg/dL');
    /**
     * Waited for deliberately. Under React 19 the tree flushes asynchronously,
     * so pressing on the next synchronous line saves the value the field was
     * pre-filled with rather than the one just typed.
     */
    await screen.findByDisplayValue('124 mg/dL');
    fireEvent.press(screen.getByText('Save this correction'));

    // Both readings on screen: the app's, and the person's.
    expect(await screen.findByText('124 mg/dL')).toBeTruthy();
    expect(screen.getByText('142 mg/dL')).toBeTruthy();
  });

  it('records the correction against the version that was on screen', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('review-finding-0-correct'));
    fireEvent.changeText(await screen.findByTestId('review-correction-input'), '124 mg/dL');
    await screen.findByDisplayValue('124 mg/dL');
    fireEvent.press(screen.getByText('Save this correction'));

    const [stored] = useVaultStore.getState().summaries;
    expect(stored?.corrections?.[0]).toMatchObject({
      field: 'findings.0.value',
      previousValue: '142 mg/dL',
      correctedValue: '124 mg/dL',
      summaryVersion: 1,
    });
  });
});

describe('marking it checked', () => {
  /**
   * The wording is the safety property. Somebody comparing a page with a
   * summary has not approved it clinically, and no screen may say they have.
   */
  it('never describes the check as a clinical approval', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('review-confirm'));

    expect(await screen.findByText(/does not say a doctor has agreed/i)).toBeTruthy();
    for (const forbidden of [/\bverified\b/i, /\bapproved by\b/i, /confirmed correct/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('records who checked it, and which version', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('review-confirm'));
    fireEvent.press(await screen.findByText('Yes, I checked it'));

    expect(useVaultStore.getState().summaries[0]).toMatchObject({ reviewedVersion: 1 });
    expect(useVaultStore.getState().documents[0]?.reviewedAt).toEqual(expect.any(String));
  });

  /**
   * A summary read again after a check is unchecked again: the tick was earned
   * on different text.
   */
  it('says a re-read document needs checking again', async () => {
    useVaultStore.setState({
      summaries: [
        summary({ version: 2, reviewedAt: '2026-09-02T10:00:00.000Z', reviewedVersion: 1 }),
      ],
    });

    await renderScreen();

    expect(screen.getByText(/needs checking again/i)).toBeTruthy();
  });
});

describe('when there is no original to check against', () => {
  /**
   * The most important refusal on this screen. A tick recorded with nothing to
   * compare against is worse than no tick, because everyone downstream reads it
   * as somebody having looked.
   */
  it('will not let anybody tick it', async () => {
    useVaultStore.setState({ documents: [document(false)] });

    await renderScreen();

    expect(screen.getByTestId('review-no-pages')).toBeTruthy();
    expect(screen.getByTestId('review-confirm')).toBeDisabled();
  });
});
