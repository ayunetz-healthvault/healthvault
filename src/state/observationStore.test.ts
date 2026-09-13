import {
  selectObservations,
  selectVisitQuestions,
  useVaultStore,
  vaultSnapshot,
} from './vaultStore';

/**
 * What somebody noticed, and what they want to ask about it.
 *
 * The property running through all of these: the app records what a person
 * said and never interprets it. No normalising, no clinical terms, and no
 * question presented as the family's own when a machine suggested it.
 */

const observation = (patch: Record<string, unknown> = {}) => ({
  patientId: 'pat_1',
  text: '  A funny feeling in my chest after the stairs  ',
  occurredAt: '2026-09-07T12:00:00.000Z',
  impact: 'moderately' as const,
  recordedBy: 'usr_meera',
  recordedBySelf: true,
  ...patch,
});

beforeEach(() => {
  useVaultStore.getState().clearAll();
});

describe('writing down what you noticed', () => {
  /**
   * The one thing this must never do. "A funny feeling in my chest after the
   * stairs" is more useful to a doctor than anything a parser would make of it,
   * and turning it into "dyspnoea on exertion" would be this app writing a
   * clinical note.
   */
  it('keeps the words exactly as written', () => {
    const saved = useVaultStore.getState().addObservation(observation());

    expect(saved.text).toBe('A funny feeling in my chest after the stairs');
  });

  it('records when it happened, not only when it was written', () => {
    const saved = useVaultStore.getState().addObservation(observation());

    expect(saved.occurredAt).toBe('2026-09-07T12:00:00.000Z');
    expect(saved.recordedAt).not.toBe(saved.occurredAt);
  });

  /**
   * A helper's note is what the helper observed. A doctor reading the list
   * needs to know which of the two they are looking at.
   */
  it('keeps a helper’s note distinguishable from the person’s own', () => {
    const mine = useVaultStore.getState().addObservation(observation());
    const theirs = useVaultStore
      .getState()
      .addObservation(observation({ recordedBySelf: false, recordedBy: 'usr_bob' }));

    expect(mine.recordedBySelf).toBe(true);
    expect(theirs.recordedBySelf).toBe(false);
  });

  it('lists them newest first', () => {
    useVaultStore.getState().addObservation(observation({ occurredAt: '2026-09-01T12:00:00.000Z' }));
    useVaultStore.getState().addObservation(observation({ occurredAt: '2026-09-07T12:00:00.000Z' }));

    expect(
      selectObservations(vaultSnapshot(), 'pat_1').map((entry) => entry.occurredAt),
    ).toEqual(['2026-09-07T12:00:00.000Z', '2026-09-01T12:00:00.000Z']);
  });

  it('keeps one person’s notes out of another’s', () => {
    useVaultStore.getState().addObservation(observation());
    useVaultStore.getState().addObservation(observation({ patientId: 'pat_2' }));

    expect(selectObservations(vaultSnapshot(), 'pat_1')).toHaveLength(1);
  });
});

describe('changing a note', () => {
  it('bumps the version, so a concurrent change is a conflict not a race', () => {
    const saved = useVaultStore.getState().addObservation(observation());

    useVaultStore.getState().updateObservation(saved.id, { text: 'Better today' });

    const [updated] = selectObservations(vaultSnapshot(), 'pat_1');
    expect(updated).toMatchObject({ text: 'Better today', version: 2 });
  });

  it('removes one when asked', () => {
    const saved = useVaultStore.getState().addObservation(observation());

    useVaultStore.getState().removeObservation(saved.id);

    expect(selectObservations(vaultSnapshot(), 'pat_1')).toEqual([]);
  });
});

describe('questions for the visit', () => {
  it('keeps a question somebody wrote', () => {
    useVaultStore.getState().addVisitQuestion({
      patientId: 'pat_1',
      text: 'Is the dizziness the new tablet?',
      origin: 'user',
      askedBy: 'usr_meera',
      askedBySelf: true,
    });

    expect(selectVisitQuestions(vaultSnapshot(), 'pat_1')[0]).toMatchObject({ origin: 'user' });
  });

  /**
   * An accepted suggestion stays labelled as one. Presenting a machine's
   * question as the family's own would overstate how much thought went into it.
   */
  it('remembers that a kept suggestion came from the app', () => {
    useVaultStore.getState().addVisitQuestion({
      patientId: 'pat_1',
      text: 'Should the dose change?',
      origin: 'accepted_suggestion',
      source: { documentId: 'doc_1', page: 1 },
      askedBy: 'usr_meera',
      askedBySelf: true,
    });

    expect(selectVisitQuestions(vaultSnapshot(), 'pat_1')[0]).toMatchObject({
      origin: 'accepted_suggestion',
      source: { documentId: 'doc_1', page: 1 },
    });
  });

  it('keeps the family’s own ordering', () => {
    const base = {
      patientId: 'pat_1',
      origin: 'user' as const,
      askedBy: 'usr_meera',
      askedBySelf: true,
    };
    useVaultStore.getState().addVisitQuestion({ ...base, text: 'Second', order: 2 });
    useVaultStore.getState().addVisitQuestion({ ...base, text: 'First', order: 1 });

    expect(selectVisitQuestions(vaultSnapshot(), 'pat_1').map((q) => q.text)).toEqual([
      'First',
      'Second',
    ]);
  });
});

describe('signing out', () => {
  it('takes the notes with it', () => {
    useVaultStore.getState().addObservation(observation());
    useVaultStore.getState().clearAll();

    expect(useVaultStore.getState().observations).toEqual([]);
    expect(useVaultStore.getState().visitQuestions).toEqual([]);
  });
});
