import { render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProcessingScreen from '../../../app/document/[id]/processing';

import { MOCK_PARENTS } from '@/mocks/parents';
import { useVaultStore } from '@/state/vaultStore';
import type { MedicalDocument, ParentProfile } from '@/types/domain';

/**
 * The upload-and-process screen.
 *
 * This exists because of a bug that unit tests could not have caught: the
 * pipeline ran, wrote its first status update to the vault, and that write
 * changed the `document` object the screen's effect depended on — so React
 * re-ran the effect's cleanup, which aborted the upload it had just started.
 * The user saw "Upload cancelled." at 0%.
 *
 * Every service involved was working correctly. The fault was in how the screen
 * wired them together, which is only visible when the screen is rendered.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'doc_under_test' }),
}));

const parent = MOCK_PARENTS[0] as ParentProfile;

const draftDocument = (): MedicalDocument => ({
  id: 'doc_under_test',
  parentId: parent.id,
  title: 'Discharge summary',
  category: 'discharge_summary',
  documentDate: '2026-07-12',
  pages: [
    {
      id: 'pag_1',
      uri: 'file:///cache/report.pdf',
      kind: 'pdf',
      source: 'file',
      fileName: 'report.pdf',
      sizeBytes: 120_000,
      width: null,
      height: null,
      capturedAt: '2026-07-12T10:00:00.000Z',
    },
  ],
  status: 'draft',
  uploadProgress: 0,
  summaryId: null,
  failureReason: null,
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:00:00.000Z',
});

/** The mock upload and pipeline sleep in real time. */
const PIPELINE_TIMEOUT_MS = 30_000;

/** The screen reads safe-area insets, which need a provider with real metrics. */
const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 375, height: 812 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ProcessingScreen />
    </SafeAreaProvider>,
  );

describe('ProcessingScreen', () => {
  beforeEach(() => {
    useVaultStore.setState({
      parents: [parent],
      documents: [draftDocument()],
      summaries: [],
      followUps: [],
    });
  });

  it(
    'runs the whole pipeline without cancelling its own upload',
    async () => {
      await renderScreen();

      await waitFor(
        () => {
          expect(screen.getByTestId('processing-view-summary')).toBeTruthy();
        },
        { timeout: PIPELINE_TIMEOUT_MS - 5_000 },
      );

      // The specific regression: a store write mid-run must not abort the run.
      expect(screen.queryByTestId('processing-error')).toBeNull();

      const document = useVaultStore.getState().documents[0];
      expect(document?.status).toBe('ready');
      expect(document?.summaryId).not.toBeNull();
      expect(useVaultStore.getState().summaries).toHaveLength(1);
    },
    PIPELINE_TIMEOUT_MS,
  );

  it(
    'stores a summary that belongs to this document and parent',
    async () => {
      await renderScreen();

      await waitFor(
        () => {
          expect(screen.getByTestId('processing-view-summary')).toBeTruthy();
        },
        { timeout: PIPELINE_TIMEOUT_MS - 5_000 },
      );

      const summary = useVaultStore.getState().summaries[0];

      expect(summary?.documentId).toBe('doc_under_test');
      expect(summary?.parentId).toBe(parent.id);
    },
    PIPELINE_TIMEOUT_MS,
  );
});
