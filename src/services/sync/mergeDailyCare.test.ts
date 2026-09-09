import { mergeDoseEvents, mergeObservations, mergeSchedules } from './mergeDailyCare';

import type { Observation } from '@/types/observations';
import type { DoseEvent, TreatmentSchedule } from '@/types/treatment';

/**
 * Whose version of a note, a medicine and a dose is right.
 *
 * Three entities and three different rules, because they mean different
 * things. Copying one set of rules onto all three would be tidy and wrong: a
 * note is editable, a medicine is stopped rather than changed, and a dose
 * event is never altered at all.
 */

const observation = (id: string, patch: Partial<Observation> = {}): Observation => ({
  id,
  patientId: 'pat_1',
  text: 'Dizzy after the new tablet',
  occurredAt: '2026-09-09T08:00:00.000Z',
  impact: 'moderately',
  recordedBy: 'usr_alice',
  recordedBySelf: false,
  recordedAt: '2026-09-09T09:00:00.000Z',
  version: 1,
  updatedAt: '2026-09-09T09:00:00.000Z',
  ...patch,
});

const schedule = (id: string, patch: Partial<TreatmentSchedule> = {}): TreatmentSchedule => ({
  id,
  patientId: 'pat_1',
  name: 'Metformin',
  dosage: '500 mg',
  times: ['08:00'],
  timezone: 'Asia/Kolkata',
  startDate: '2026-09-01',
  endDate: null,
  provenance: 'manual',
  source: null,
  confirmedBy: 'usr_alice',
  confirmedAt: '2026-09-01T00:00:00.000Z',
  supersededAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...patch,
});

const doseEvent = (id: string, patch: Partial<DoseEvent> = {}): DoseEvent => ({
  id,
  patientId: 'pat_1',
  scheduleId: 'trt_1',
  occurrenceKey: 'trt_1#2026-09-09#08:00',
  occurrenceAt: '2026-09-09T02:30:00.000Z',
  state: 'taken',
  recordedAt: '2026-09-09T03:00:00.000Z',
  recordedBy: 'usr_alice',
  recordedBySelf: false,
  supersedesEventId: null,
  undo: false,
  createdAt: '2026-09-09T03:00:00.000Z',
  ...patch,
});

describe('notes from another phone', () => {
  it('arrive', () => {
    const merged = mergeObservations({
      local: [],
      remoteByPatient: { pat_1: [observation('obs_1')] },
      removedPatientIds: [],
      pending: [],
    });

    expect(merged.map((entry) => entry.id)).toEqual(['obs_1']);
  });

  it('bring an edit somebody else made', () => {
    const merged = mergeObservations({
      local: [observation('obs_1')],
      remoteByPatient: { pat_1: [observation('obs_1', { text: 'Dizzy again', version: 2 })] },
      removedPatientIds: [],
      pending: [],
    });

    expect(merged[0]).toMatchObject({ text: 'Dizzy again', version: 2 });
  });

  /** The outbox holds the only copy of what somebody just wrote. */
  it('do not overwrite an edit this phone has not sent', () => {
    const merged = mergeObservations({
      local: [observation('obs_1', { text: 'My words', version: 1 })],
      remoteByPatient: { pat_1: [observation('obs_1', { text: 'Theirs', version: 2 })] },
      removedPatientIds: [],
      pending: [{ entityId: 'obs_1', operation: 'update' }],
    });

    expect(merged[0]).toMatchObject({ text: 'My words' });
  });

  it('go when somebody deletes them', () => {
    const merged = mergeObservations({
      local: [observation('obs_1')],
      remoteByPatient: { pat_1: [] },
      removedPatientIds: [],
      pending: [],
    });

    expect(merged).toEqual([]);
  });

  /** A note deleted here has no local row, so the pull would re-add it. */
  it('do not come back while a local deletion is queued', () => {
    const merged = mergeObservations({
      local: [],
      remoteByPatient: { pat_1: [observation('obs_1')] },
      removedPatientIds: [],
      pending: [{ entityId: 'obs_1', operation: 'delete' }],
    });

    expect(merged).toEqual([]);
  });

  it('are left alone entirely when the queue cannot be read', () => {
    const local = [observation('obs_1', { text: 'Mine' })];

    const merged = mergeObservations({
      local,
      remoteByPatient: { pat_1: [observation('obs_1', { text: 'Theirs' }), observation('obs_2')] },
      removedPatientIds: [],
      pending: 'unknown',
    });

    expect(merged).toEqual(local);
  });
});

describe('medicines from another phone', () => {
  it('arrive, including the ones that were stopped', () => {
    const merged = mergeSchedules({
      local: [],
      remoteByPatient: {
        pat_1: [
          schedule('trt_1'),
          schedule('trt_2', { supersededAt: '2026-09-05T00:00:00.000Z' }),
        ],
      },
      removedPatientIds: [],
      pending: [],
    });

    expect(merged).toHaveLength(2);
    expect(merged.find((entry) => entry.id === 'trt_2')?.supersededAt).toBe(
      '2026-09-05T00:00:00.000Z',
    );
  });

  /**
   * The one that matters. Somebody stopped a medicine on this phone and the
   * request has not gone yet; the server's row still looks live. Taking it
   * would put the medicine back on the list somebody had just come off.
   */
  it('do not un-stop a medicine this phone has just stopped', () => {
    const merged = mergeSchedules({
      local: [schedule('trt_1', { supersededAt: '2026-09-09T00:00:00.000Z' })],
      remoteByPatient: { pat_1: [schedule('trt_1', { supersededAt: null })] },
      removedPatientIds: [],
      pending: [{ entityId: 'trt_1', operation: 'update' }],
    });

    expect(merged[0]?.supersededAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('carry a stop somebody else recorded', () => {
    const merged = mergeSchedules({
      local: [schedule('trt_1')],
      remoteByPatient: { pat_1: [schedule('trt_1', { supersededAt: '2026-09-09T00:00:00.000Z' })] },
      removedPatientIds: [],
      pending: [],
    });

    expect(merged[0]?.supersededAt).toBe('2026-09-09T00:00:00.000Z');
  });
});

describe('dose events', () => {
  /**
   * A union, because the record is append-only: nothing ever disagrees, and
   * what looks like a disagreement is an event that has not been sent yet.
   */
  it('are everything both sides have', () => {
    const merged = mergeDoseEvents({
      local: [doseEvent('dse_local')],
      remoteByPatient: { pat_1: [doseEvent('dse_remote')] },
      removedPatientIds: [],
    });

    expect(merged.map((entry) => entry.id).sort()).toEqual(['dse_local', 'dse_remote']);
  });

  /**
   * The property this rule exists for. A dose recorded here and not yet sent
   * must survive a pull — dropping it would delete a dose somebody recorded,
   * which is the one thing an append-only record must never do.
   */
  it('never lose one this phone has not sent', () => {
    const merged = mergeDoseEvents({
      local: [doseEvent('dse_local')],
      remoteByPatient: { pat_1: [] },
      removedPatientIds: [],
    });

    expect(merged.map((entry) => entry.id)).toEqual(['dse_local']);
  });

  it('do not duplicate one both sides hold', () => {
    const merged = mergeDoseEvents({
      local: [doseEvent('dse_1')],
      remoteByPatient: { pat_1: [doseEvent('dse_1')] },
      removedPatientIds: [],
    });

    expect(merged).toHaveLength(1);
  });

  it('bring an undo recorded on the other phone', () => {
    const merged = mergeDoseEvents({
      local: [doseEvent('dse_1')],
      remoteByPatient: {
        pat_1: [doseEvent('dse_1'), doseEvent('dse_2', { supersedesEventId: 'dse_1', undo: true })],
      },
      removedPatientIds: [],
    });

    expect(merged).toHaveLength(2);
    expect(merged.find((entry) => entry.id === 'dse_2')?.undo).toBe(true);
  });

  /** Revocation is the one thing that removes them. */
  it('go with a record this account can no longer reach', () => {
    const merged = mergeDoseEvents({
      local: [doseEvent('dse_1'), doseEvent('dse_2', { patientId: 'pat_2' })],
      remoteByPatient: {},
      removedPatientIds: ['pat_1'],
    });

    expect(merged.map((entry) => entry.id)).toEqual(['dse_2']);
  });
});
