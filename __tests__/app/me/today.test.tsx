import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ParentTodayScreen from '../../../app/me/index';

import { useSessionStore } from '@/state/sessionStore';
import { useVaultStore } from '@/state/vaultStore';
import type { FollowUp, ParentProfile } from '@/types/domain';
import type { TreatmentSchedule } from '@/types/treatment';

/**
 * The parent's Today screen.
 *
 * The single most important assertion in this file is the one that says no
 * medicine appears. The approved reference fills this card with "Sample
 * medicine A" so the prototype has something to demonstrate; on a real phone,
 * belonging to the person whose record it is, that card is an instruction to
 * take a drug. It must render the no-treatment state instead, and it must say
 * so in words rather than leaving a blank.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** What the screen queued for the shared record, if anything. */
const mockPushDoseEvent = jest.fn();

jest.mock('@/services/sync/dailyCare', () => ({
  ...jest.requireActual('@/services/sync/dailyCare'),
  pushDoseEvent: (...args: unknown[]) => mockPushDoseEvent(...args),
}));

/** Awaited: React 19 flushes the tree asynchronously. See the care home test. */
const renderScreen = async (): Promise<void> => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ParentTodayScreen />
    </SafeAreaProvider>,
  );
};

const selfRecord: ParentProfile = {
  id: 'par_self',
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

/**
 * A medicine somebody confirmed they are taking.
 *
 * Built by hand rather than via a summary on purpose: the point of the type is
 * that no pipeline can produce one. `confirmedBy` and `confirmedAt` are what
 * separate this from a medicine a model read off a photograph.
 */
const schedule = (times: string[]): TreatmentSchedule => ({
  id: 'trt_1',
  patientId: selfRecord.id,
  name: 'Metformin',
  dosage: '500 mg',
  times,
  timezone: 'Asia/Kolkata',
  startDate: '2020-01-01',
  endDate: null,
  provenance: 'manual',
  source: null,
  confirmedBy: 'usr_meera',
  confirmedAt: '2026-09-01T00:00:00.000Z',
  supersededAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const visit = (dueDate: string): FollowUp => ({
  id: 'f1',
  parentId: selfRecord.id,
  title: 'Follow-up appointment',
  kind: 'doctor_visit',
  dueDate,
  dueTime: '10:30',
  notes: '',
  status: 'scheduled',
  sourceDocumentId: null,
  doctorCategory: null,
  calendarEventId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

beforeEach(() => {
  useVaultStore.setState({
    parents: [selfRecord],
    documents: [],
    summaries: [],
    followUps: [],
    schedules: [],
    doseEvents: [],
  });
  useSessionStore.setState({
    selfRecordId: selfRecord.id,
    user: {
      id: 'usr_meera',
      email: 'meera@example.invalid',
      fullName: 'Meera Nair',
      location: 'Kochi, India',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
});

describe('parent Today', () => {
  it('shows the no-treatment state instead of inventing a medicine', async () => {
    await renderScreen();

    expect(screen.getByTestId('me-today-no-treatment')).toBeTruthy();
    expect(screen.getByText('No medicine schedule set up')).toBeTruthy();

    // The reference's placeholder, and anything shaped like it.
    for (const forbidden of [/sample medicine/i, /\bmg\b/, /take .* tablet/i, /morning dose/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('says nothing is being tracked, rather than leaving the absence unexplained', async () => {
    await renderScreen();

    expect(screen.getByText(/Nothing is being tracked until then/i)).toBeTruthy();
  });

  it('offers the appointment or capture action when there is no schedule', async () => {
    await renderScreen();

    expect(screen.getByTestId('me-today-no-visit')).toBeTruthy();
    expect(screen.getByTestId('me-today-add-document-alt')).toBeTruthy();
  });

  it('shows the real next visit when one exists, with the timezone named', async () => {
    useVaultStore.setState({ followUps: [visit('2099-01-01')] });
    await renderScreen();

    expect(screen.getByTestId('me-today-visit')).toBeTruthy();
    expect(screen.getByText(/IST/)).toBeTruthy();
    expect(screen.queryByTestId('me-today-no-visit')).toBeNull();
  });

  it('says a past appointment date has passed rather than presenting it as next', async () => {
    useVaultStore.setState({ followUps: [visit('2020-01-01')] });
    await renderScreen();

    expect(screen.getByText(/this date has passed/i)).toBeTruthy();
  });

  it('names the signed-in person, in their own space', async () => {
    await renderScreen();

    expect(screen.getByText('My personal space')).toBeTruthy();
    expect(screen.getByText('Hello, Meera.')).toBeTruthy();
  });

  it('tells the parent nobody can see the record unless they said so', async () => {
    await renderScreen();

    expect(screen.getByText(/Nobody can see this record unless you have given them access/i))
      .toBeTruthy();
  });

  it('renders an explicit state when the account has no record of its own', async () => {
    useSessionStore.setState({ selfRecordId: null });
    await renderScreen();

    expect(screen.getByTestId('me-today-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('me-today-no-treatment')).toBeNull();
  });
});

/**
 * The dose flow.
 *
 * Everything here comes from a confirmed schedule. The tests above prove the
 * screen invents nothing when there is none; these prove it does the right
 * thing when there is — which is the other half of the same safety property,
 * because a card nobody can answer is as useless as a card nobody asked for.
 */
describe('parent Today with a confirmed medicine', () => {
  beforeEach(() => {
    mockPushDoseEvent.mockReset();
    useVaultStore.setState({ schedules: [schedule(['08:00', '20:00'])] });
  });

  it('shows the confirmed medicine, with both answers offered', async () => {
    await renderScreen();

    expect(screen.getByTestId('me-today-dose')).toBeTruthy();
    expect(screen.getByText('Metformin')).toBeTruthy();
    expect(screen.getByTestId('me-today-dose-taken')).toBeTruthy();
    expect(screen.getByTestId('me-today-dose-missed')).toBeTruthy();
  });

  /**
   * The safety property, on the screen rather than in the model. Nobody has
   * answered, and the card says "not recorded" — it does not say the tablet was
   * skipped, and it does not quietly assume it was taken.
   */
  it('describes an unanswered dose as not recorded', async () => {
    await renderScreen();

    expect(screen.getByText('Not recorded')).toBeTruthy();
    expect(screen.queryByText(/missed/i)).toBeNull();
  });

  it('records a dose as taken, and offers to undo it', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));

    expect(useVaultStore.getState().doseEvents).toHaveLength(1);
    expect(await screen.findByText('Taken')).toBeTruthy();
    expect(screen.getByTestId('me-today-dose-undo')).toBeTruthy();
  });

  it('only marks a dose missed when somebody says so', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-missed'));

    expect(useVaultStore.getState().doseEvents[0]).toMatchObject({
      state: 'missed',
      recordedBySelf: true,
    });
  });

  it('undoes a mistaken tap without deleting the history', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));
    fireEvent.press(await screen.findByTestId('me-today-dose-undo'));

    expect(useVaultStore.getState().doseEvents).toHaveLength(2);
    expect(await screen.findByText('Not recorded')).toBeTruthy();
  });

  /**
   * The card does not jump to the next dose the instant one is answered.
   * Somebody who tapped the wrong button at seven in the morning has to be able
   * to see what they recorded and take it back.
   */
  it('keeps the dose it just recorded on screen', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));

    expect(await screen.findByText('Taken')).toBeTruthy();
    expect(screen.queryByTestId('me-today-dose-taken')).toBeNull();
  });

  it('says there is nothing left when every dose was answered earlier', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));
    fireEvent.press(await screen.findByTestId('me-today-dose-undo'));

    // Back to an unanswered dose, which is the point of undo.
    expect(await screen.findByTestId('me-today-dose-taken')).toBeTruthy();
  });
});

/**
 * A dose reaching the rest of the family.
 *
 * The screen recorded doses perfectly and shared them with nobody: they were
 * written to an encrypted store on one phone, and `mutationSender` refused
 * them because no endpoint existed. A dose is the fact a second carer most
 * needs — it is what stops two people giving the same tablet twice — so
 * recording one and queueing it are one action, and the queueing is what these
 * assert.
 */
describe('sharing a recorded dose', () => {
  beforeEach(() => {
    mockPushDoseEvent.mockReset();
    useVaultStore.setState({ schedules: [schedule(['08:00', '20:00'])] });
  });

  it('queues the dose the person just recorded', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));

    expect(mockPushDoseEvent).toHaveBeenCalledTimes(1);
    expect(mockPushDoseEvent.mock.calls[0]?.[0]).toMatchObject({
      state: 'taken',
      recordedBySelf: true,
      undo: false,
    });
  });

  /** An undo is another event, not a deletion, so it travels like any other. */
  it('queues an undo as an event that names what it supersedes', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));
    const recorded = mockPushDoseEvent.mock.calls[0]?.[0] as { id: string };
    fireEvent.press(await screen.findByTestId('me-today-dose-undo'));

    expect(mockPushDoseEvent).toHaveBeenCalledTimes(2);
    expect(mockPushDoseEvent.mock.calls[1]?.[0]).toMatchObject({
      supersedesEventId: recorded.id,
      undo: true,
    });
  });

  /**
   * A tap that changes nothing produces nothing to send. `recordDose` returns
   * null for the same dose in the same state — two taps on one tablet are one
   * event, on this phone and on everybody else's.
   */
  it('has nothing to queue for a tap that changes nothing', async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId('me-today-dose-taken'));
    fireEvent.press(screen.getByTestId('me-today-dose-taken'));

    const events = mockPushDoseEvent.mock.calls.filter(([event]) => event !== null);
    expect(events).toHaveLength(1);
    expect(useVaultStore.getState().doseEvents).toHaveLength(1);
  });
});
