import {
  describeDose,
  nextDueDose,
  occurrenceKeyFor,
  occurrencesForDay,
  recordDose,
  undoDose,
} from './occurrences';

import type { DoseEvent, TreatmentSchedule } from '@/types/treatment';

/**
 * Doses, and the rules that make a medication record safe to read.
 *
 * The most important test in this file asserts that a dose with nothing
 * recorded is `null` and never `'missed'`. Silence is not evidence a tablet was
 * skipped — the person may have taken it and not opened the app, may be asleep,
 * may have no signal — and a caregiver abroad seeing "missed" for a dose their
 * mother actually took is exactly the harm this product must not cause.
 */

const IST = 'Asia/Kolkata';

const schedule = (patch: Partial<TreatmentSchedule> = {}): TreatmentSchedule => ({
  id: 'trt_1',
  patientId: 'pat_1',
  name: 'Metformin',
  dosage: '500 mg',
  times: ['08:00', '20:00'],
  timezone: IST,
  startDate: '2026-09-01',
  endDate: null,
  provenance: 'from_document',
  source: null,
  confirmedBy: 'acc_meera',
  confirmedAt: '2026-09-01T04:00:00.000Z',
  supersededAt: null,
  createdAt: '2026-09-01T04:00:00.000Z',
  updatedAt: '2026-09-01T04:00:00.000Z',
  ...patch,
});

const event = (patch: Partial<DoseEvent> & Pick<DoseEvent, 'occurrenceKey'>): DoseEvent => ({
  id: 'dse_1',
  patientId: 'pat_1',
  scheduleId: 'trt_1',
  occurrenceAt: '2026-09-08T02:30:00.000Z',
  state: 'taken',
  recordedAt: '2026-09-08T02:35:00.000Z',
  recordedBy: 'acc_meera',
  recordedBySelf: true,
  supersedesEventId: null,
  undo: false,
  createdAt: '2026-09-08T02:35:00.000Z',
  ...patch,
});

const morningKey = occurrenceKeyFor('trt_1', '2026-09-08', '08:00');

describe('the doses due on a day', () => {
  it('produces one occurrence per scheduled time', () => {
    const occurrences = occurrencesForDay([schedule()], [], '2026-09-08');

    expect(occurrences).toHaveLength(2);
    expect(occurrences.map((occurrence) => occurrence.medicineName)).toEqual([
      'Metformin',
      'Metformin',
    ]);
  });

  /** The rule the whole feature turns on. */
  it('leaves an unrecorded dose as not recorded, never as missed', () => {
    const [morning] = occurrencesForDay([schedule()], [], '2026-09-08');

    expect(morning?.state).toBeNull();
    expect(describeDose(morning!)).toBe('Not recorded');
  });

  it('resolves the due time in the patient’s zone, not the device’s', () => {
    const [morning] = occurrencesForDay([schedule({ times: ['08:00'] })], [], '2026-09-08');

    // 08:00 IST is 02:30 UTC.
    expect(morning?.dueAt).toBe('2026-09-08T02:30:00.000Z');
  });

  it('keeps a late-evening dose on its own local day', () => {
    const [evening] = occurrencesForDay([schedule({ times: ['23:30'] })], [], '2026-09-08');

    // 23:30 IST on the 8th is 18:00 UTC on the 8th — the same local evening,
    // even though a naive UTC key would already be tempted to move it.
    expect(evening?.dueAt).toBe('2026-09-08T18:00:00.000Z');
    expect(evening?.occurrenceKey).toContain('2026-09-08');
  });

  it('handles a zone with daylight saving without drifting an hour', () => {
    // A start date that covers both sides of the clock change, since a
    // schedule only produces occurrences while it is in force.
    const berlin = schedule({
      timezone: 'Europe/Berlin',
      times: ['08:00'],
      startDate: '2026-01-01',
    });

    const [summer] = occurrencesForDay([berlin], [], '2026-07-01');
    const [winter] = occurrencesForDay([berlin], [], '2026-12-01');

    // CEST in July (+2), CET in December (+1).
    expect(summer?.dueAt).toBe('2026-07-01T06:00:00.000Z');
    expect(winter?.dueAt).toBe('2026-12-01T07:00:00.000Z');
  });

  it('produces nothing before the schedule starts or after it ends', () => {
    const bounded = schedule({ startDate: '2026-09-05', endDate: '2026-09-07' });

    expect(occurrencesForDay([bounded], [], '2026-09-04')).toEqual([]);
    expect(occurrencesForDay([bounded], [], '2026-09-06')).toHaveLength(2);
    expect(occurrencesForDay([bounded], [], '2026-09-08')).toEqual([]);
  });

  it('produces nothing for a schedule that has been superseded', () => {
    const replaced = schedule({ supersededAt: '2026-09-07T00:00:00.000Z' });

    expect(occurrencesForDay([replaced], [], '2026-09-08')).toEqual([]);
  });

  it('shows what was recorded, and by whom', () => {
    const occurrences = occurrencesForDay([schedule()], [event({ occurrenceKey: morningKey })], '2026-09-08');
    const morning = occurrences.find((occurrence) => occurrence.occurrenceKey === morningKey);

    expect(morning).toMatchObject({ state: 'taken', recordedBy: 'acc_meera', recordedBySelf: true });
  });

  it('takes the newest event when a dose was recorded more than once', () => {
    const occurrences = occurrencesForDay(
      [schedule()],
      [
        event({ occurrenceKey: morningKey, id: 'dse_1', state: 'taken', recordedAt: '2026-09-08T02:35:00.000Z' }),
        event({ occurrenceKey: morningKey, id: 'dse_2', state: 'missed', recordedAt: '2026-09-08T09:00:00.000Z' }),
      ],
      '2026-09-08',
    );

    expect(occurrences.find((o) => o.occurrenceKey === morningKey)?.state).toBe('missed');
  });

  it('orders the day by when each dose is due', () => {
    const occurrences = occurrencesForDay(
      [schedule({ times: ['20:00', '08:00', '14:00'] })],
      [],
      '2026-09-08',
    );

    expect(occurrences.map((occurrence) => occurrence.dueAt)).toEqual([
      ...occurrences.map((occurrence) => occurrence.dueAt),
    ].sort());
  });
});

describe('recording a dose', () => {
  const [morning] = occurrencesForDay([schedule()], [], '2026-09-08');

  it('records the actor, the due time and the time it was pressed', () => {
    const recorded = recordDose({
      occurrence: morning!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
      now: new Date('2026-09-08T04:10:00.000Z'),
    });

    expect(recorded).toMatchObject({
      state: 'taken',
      // Due at 08:00 IST, pressed at 09:40 IST. Two different facts, both kept.
      occurrenceAt: '2026-09-08T02:30:00.000Z',
      recordedAt: '2026-09-08T04:10:00.000Z',
      recordedBy: 'acc_meera',
    });
  });

  /** Two taps on one tablet must not become two events. */
  it('produces nothing when the dose is already in that state', () => {
    const first = recordDose({
      occurrence: morning!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    });

    const occurrences = occurrencesForDay(
      [schedule()],
      [first!],
      '2026-09-08',
    );
    const updated = occurrences.find((o) => o.occurrenceKey === morningKey);

    expect(
      recordDose({
        occurrence: updated!,
        state: 'taken',
        recordedBy: 'acc_meera',
        recordedBySelf: true,
      }),
    ).toBeNull();
  });

  it('gives every event a distinct identity', () => {
    const taken = recordDose({
      occurrence: morning!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    });
    const [evening] = occurrencesForDay([schedule()], [], '2026-09-08').slice(1);
    const other = recordDose({
      occurrence: evening!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    });

    expect(taken?.occurrenceKey).not.toBe(other?.occurrenceKey);
  });

  /**
   * A helper marking a dose taken is reporting what they believe. The person
   * reading it next needs to know that, and the wording is the only place it
   * can be said.
   */
  it('describes a helper’s entry differently from the patient’s own', () => {
    const byHelper = recordDose({
      occurrence: morning!,
      state: 'taken',
      recordedBy: 'acc_sujay',
      recordedBySelf: false,
    });

    const [shown] = occurrencesForDay([schedule()], [byHelper!], '2026-09-08');

    expect(describeDose(shown!)).toBe('Recorded as taken by a helper');
  });

  it('describes the patient’s own entry plainly', () => {
    const bySelf = recordDose({
      occurrence: morning!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    });

    expect(describeDose(occurrencesForDay([schedule()], [bySelf!], '2026-09-08')[0]!)).toBe('Taken');
  });

  it('only ever says missed when a person said so', () => {
    const missed = recordDose({
      occurrence: morning!,
      state: 'missed',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    });

    expect(describeDose(occurrencesForDay([schedule()], [missed!], '2026-09-08')[0]!)).toMatch(
      /missed/i,
    );
    expect(describeDose(morning!)).not.toMatch(/missed/i);
  });
});

describe('undoing', () => {
  const [morning] = occurrencesForDay([schedule()], [], '2026-09-08');

  const taken = recordDose({
    occurrence: morning!,
    state: 'taken',
    recordedBy: 'acc_meera',
    recordedBySelf: true,
    now: new Date('2026-09-08T02:35:00.000Z'),
  }) as DoseEvent;

  const recorded = occurrencesForDay([schedule()], [taken], '2026-09-08').find(
    (o) => o.occurrenceKey === morningKey,
  );

  /**
   * The case the clock cannot decide.
   *
   * Tapping "taken" and then "undo" straight away puts both events in the same
   * millisecond. Ordering by time then left the id to break the tie, and the
   * id's suffix is random — so half the time the undo lost, the dose stayed
   * marked taken, and the person watched their correction vanish. The
   * supersedes chain says which came second, and it does not depend on a clock
   * having sub-millisecond resolution.
   */
  it('takes effect even when it lands in the same millisecond', () => {
    const sameInstant = new Date('2026-09-08T02:35:00.000Z');
    const immediate = undoDose(recorded!, 'acc_meera', true, sameInstant) as DoseEvent;

    const after = occurrencesForDay([schedule()], [taken, immediate], '2026-09-08').find(
      (o) => o.occurrenceKey === morningKey,
    );

    expect(after?.state).toBeNull();
    expect(immediate.recordedAt).toBe(taken.recordedAt);
  });

  /** And the order the events arrive in does not change the answer either. */
  it('takes effect whichever order the events are read in', () => {
    const sameInstant = new Date('2026-09-08T02:35:00.000Z');
    const immediate = undoDose(recorded!, 'acc_meera', true, sameInstant) as DoseEvent;

    const reversed = occurrencesForDay([schedule()], [immediate, taken], '2026-09-08').find(
      (o) => o.occurrenceKey === morningKey,
    );

    expect(reversed?.state).toBeNull();
  });

  it('returns the dose to not recorded', () => {
    const undone = undoDose(
      recorded!,
      'acc_meera',
      true,
      new Date('2026-09-08T02:40:00.000Z'),
    ) as DoseEvent;

    const after = occurrencesForDay([schedule()], [taken, undone], '2026-09-08').find(
      (o) => o.occurrenceKey === morningKey,
    );

    expect(after?.state).toBeNull();
    expect(describeDose(after!)).toBe('Not recorded');
  });

  /**
   * "Did my mother take her tablet this morning" is a question about the
   * record. A record that can be quietly erased cannot answer it.
   */
  it('adds an event rather than deleting one', () => {
    const undone = undoDose(recorded!, 'acc_meera', true) as DoseEvent;

    expect(undone.supersedesEventId).toBe(taken.id);
    expect(undone.undo).toBe(true);
    expect(undone.id).not.toBe(taken.id);
  });

  /** An undo is a statement about one dose, never about the prescription. */
  it('says nothing about the schedule', () => {
    const before = schedule();
    undoDose(recorded!, 'acc_meera', true);

    expect(before).toEqual(schedule());
  });

  it('does nothing when there is nothing recorded to undo', () => {
    expect(undoDose(morning!, 'acc_meera', true)).toBeNull();
  });

  /**
   * A correction is not an undo. "Taken, then corrected to missed" is a much
   * stronger claim than "taken, then that was undone", and they must not
   * collapse into each other.
   */
  it('stays distinguishable from a correction to the other state', () => {
    const corrected = recordDose({
      occurrence: recorded!,
      state: 'missed',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
      now: new Date('2026-09-08T02:45:00.000Z'),
    }) as DoseEvent;

    const after = occurrencesForDay([schedule()], [taken, corrected], '2026-09-08').find(
      (o) => o.occurrenceKey === morningKey,
    );

    expect(corrected.undo).toBe(false);
    expect(after?.state).toBe('missed');
  });
});

describe('the next dose to show', () => {
  it('is the earliest one nobody has recorded', () => {
    const occurrences = occurrencesForDay([schedule()], [], '2026-09-08');

    expect(nextDueDose(occurrences)?.occurrenceKey).toBe(morningKey);
  });

  it('moves on once the earlier one is recorded', () => {
    const taken = recordDose({
      occurrence: occurrencesForDay([schedule()], [], '2026-09-08')[0]!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    }) as DoseEvent;

    const next = nextDueDose(occurrencesForDay([schedule()], [taken], '2026-09-08'));

    expect(next?.occurrenceKey).toContain('20:00');
  });

  it('is nothing at all when the day is done', () => {
    const occurrences = occurrencesForDay([schedule({ times: ['08:00'] })], [], '2026-09-08');
    const taken = recordDose({
      occurrence: occurrences[0]!,
      state: 'taken',
      recordedBy: 'acc_meera',
      recordedBySelf: true,
    }) as DoseEvent;

    expect(nextDueDose(occurrencesForDay([schedule({ times: ['08:00'] })], [taken], '2026-09-08'))).toBeNull();
  });

  /** A screen asking "did you take Monday's tablet?" on Wednesday invites a guess. */
  it('offers nothing when there is no schedule at all', () => {
    expect(nextDueDose(occurrencesForDay([], [], '2026-09-08'))).toBeNull();
  });
});
