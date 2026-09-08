import {
  selectAllSchedules,
  selectDosesForDay,
  selectLiveSchedules,
  useVaultStore,
  vaultSnapshot,
  type VaultSnapshot,
} from './vaultStore';

import { nextDueDose, recordDose, undoDose } from '@/services/treatment/occurrences';

/**
 * Medicines somebody has confirmed, and the record of whether they took them.
 *
 * These tests are about the two claims the vault must never make on its own:
 * that somebody is taking a medicine, and that they missed a dose.
 */

const snapshot = (): VaultSnapshot => vaultSnapshot();

const confirmation = (patch: Record<string, unknown> = {}) => ({
  patientId: 'pat_1',
  name: 'Metformin',
  dosage: '500 mg',
  times: ['20:00', '08:00'],
  timezone: 'Asia/Kolkata',
  startDate: '2026-09-01',
  endDate: null,
  source: null,
  confirmedBy: 'usr_alice',
  ...patch,
});

beforeEach(() => {
  useVaultStore.getState().clearAll();
});

describe('confirming a medicine', () => {
  it('records who confirmed it and when', () => {
    const schedule = useVaultStore.getState().confirmSchedule(confirmation());

    expect(schedule.confirmedBy).toBe('usr_alice');
    expect(schedule.confirmedAt).toEqual(expect.any(String));
  });

  it('sorts the times, so the first dose of the day really is first', () => {
    expect(useVaultStore.getState().confirmSchedule(confirmation()).times).toEqual([
      '08:00',
      '20:00',
    ]);
  });

  /**
   * Provenance is not cosmetic. "Read from a prescription and confirmed" and
   * "typed in by hand" are different degrees of evidence about what somebody is
   * taking, and whoever reads the record later is entitled to know which.
   */
  it('marks a schedule that came from a document', () => {
    const schedule = useVaultStore
      .getState()
      .confirmSchedule(confirmation({ source: { documentId: 'doc_1', page: 1 } }));

    expect(schedule.provenance).toBe('from_document');
  });

  it('marks a schedule that was typed in', () => {
    expect(useVaultStore.getState().confirmSchedule(confirmation()).provenance).toBe('manual');
  });
});

describe('when a dose changes', () => {
  /**
   * The old schedule is superseded, never edited. Doses already recorded stay
   * attached to what was actually being taken at the time, and "when did she
   * come off the 500?" remains answerable.
   */
  it('supersedes the previous schedule for the same medicine', () => {
    useVaultStore.getState().confirmSchedule(confirmation({ dosage: '500 mg' }));
    useVaultStore.getState().confirmSchedule(confirmation({ dosage: '250 mg' }));

    const all = selectAllSchedules(snapshot(), 'pat_1');
    const live = selectLiveSchedules(snapshot(), 'pat_1');

    expect(all).toHaveLength(2);
    expect(live).toHaveLength(1);
    expect(live[0]?.dosage).toBe('250 mg');
  });

  it('leaves a different medicine alone', () => {
    useVaultStore.getState().confirmSchedule(confirmation());
    useVaultStore.getState().confirmSchedule(confirmation({ name: 'Amlodipine' }));

    expect(selectLiveSchedules(snapshot(), 'pat_1')).toHaveLength(2);
  });

  it('stops a schedule without deleting it', () => {
    const schedule = useVaultStore.getState().confirmSchedule(confirmation());
    useVaultStore.getState().supersedeSchedule(schedule.id);

    expect(selectLiveSchedules(snapshot(), 'pat_1')).toEqual([]);
    expect(selectAllSchedules(snapshot(), 'pat_1')).toHaveLength(1);
  });
});

describe('the doses due on a day', () => {
  it('produces one occurrence per time', () => {
    useVaultStore.getState().confirmSchedule(confirmation());

    expect(selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')).toHaveLength(2);
  });

  /**
   * The safety property this whole area exists for. Nobody has answered, and
   * the record says so — it does not say the tablet was skipped.
   */
  it('reports an unanswered dose as not recorded, never as missed', () => {
    useVaultStore.getState().confirmSchedule(confirmation());

    const doses = selectDosesForDay(snapshot(), 'pat_1', '2026-09-08');

    expect(doses.every((dose) => dose.state === null)).toBe(true);
  });

  it('shows nothing before the schedule starts', () => {
    useVaultStore.getState().confirmSchedule(confirmation({ startDate: '2026-09-10' }));

    expect(selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')).toEqual([]);
  });

  it('shows nothing for a superseded schedule', () => {
    const schedule = useVaultStore.getState().confirmSchedule(confirmation());
    useVaultStore.getState().supersedeSchedule(schedule.id);

    expect(selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')).toEqual([]);
  });
});

describe('recording a dose', () => {
  const firstDose = () => {
    const doses = selectDosesForDay(snapshot(), 'pat_1', '2026-09-08');
    return nextDueDose(doses);
  };

  beforeEach(() => {
    useVaultStore.getState().confirmSchedule(confirmation());
  });

  it('marks it taken', () => {
    const dose = firstDose();
    useVaultStore
      .getState()
      .appendDoseEvent(
        recordDose({ occurrence: dose!, state: 'taken', recordedBy: 'usr_alice', recordedBySelf: true }),
      );

    expect(selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')[0]).toMatchObject({
      state: 'taken',
      recordedBySelf: true,
    });
  });

  /** A helper's entry is a helper's entry, and the record keeps it that way. */
  it('keeps a helper’s entry distinguishable from the patient’s own', () => {
    const dose = firstDose();
    useVaultStore
      .getState()
      .appendDoseEvent(
        recordDose({ occurrence: dose!, state: 'taken', recordedBy: 'usr_bob', recordedBySelf: false }),
      );

    expect(selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')[0]?.recordedBySelf).toBe(false);
  });

  /** Two taps on one button is one tablet, not two entries. */
  it('ignores a repeat of the same answer', () => {
    const dose = firstDose();
    const event = recordDose({
      occurrence: dose!,
      state: 'taken',
      recordedBy: 'usr_alice',
      recordedBySelf: true,
    });
    useVaultStore.getState().appendDoseEvent(event);

    const after = selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')[0];
    useVaultStore.getState().appendDoseEvent(
      recordDose({ occurrence: after!, state: 'taken', recordedBy: 'usr_alice', recordedBySelf: true }),
    );

    expect(useVaultStore.getState().doseEvents).toHaveLength(1);
  });

  /**
   * Undo returns the dose to unanswered and keeps both events. The history says
   * "taken, then that was undone" rather than "taken, then missed", which would
   * be a much stronger claim than anybody made.
   */
  it('undoes without deleting anything', () => {
    const dose = firstDose();
    useVaultStore
      .getState()
      .appendDoseEvent(
        recordDose({ occurrence: dose!, state: 'taken', recordedBy: 'usr_alice', recordedBySelf: true }),
      );

    const recorded = selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')[0];
    useVaultStore.getState().appendDoseEvent(undoDose(recorded!, 'usr_alice', true));

    expect(selectDosesForDay(snapshot(), 'pat_1', '2026-09-08')[0]?.state).toBeNull();
    expect(useVaultStore.getState().doseEvents).toHaveLength(2);
  });

  it('moves on to the next dose once the first is answered', () => {
    const dose = firstDose();
    useVaultStore
      .getState()
      .appendDoseEvent(
        recordDose({ occurrence: dose!, state: 'taken', recordedBy: 'usr_alice', recordedBySelf: true }),
      );

    expect(firstDose()?.occurrenceKey).not.toBe(dose?.occurrenceKey);
  });
});

describe('signing out', () => {
  it('takes the medicine record with it', () => {
    useVaultStore.getState().confirmSchedule(confirmation());
    useVaultStore.getState().clearAll();

    expect(useVaultStore.getState().schedules).toEqual([]);
    expect(useVaultStore.getState().doseEvents).toEqual([]);
  });
});
