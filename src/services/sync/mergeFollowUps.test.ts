import { mergeFollowUps } from './mergeFollowUps';

import type { FollowUp } from '@/types/domain';

/**
 * Whose version of the shared task list is right.
 *
 * The rules are short and each one exists because the opposite is worse: an
 * unsent change is the only copy of what somebody just did; a task the server
 * no longer has was deleted by somebody, not lost; and a record this account
 * cannot reach takes its tasks with it.
 */

const followUp = (id: string, overrides: Partial<FollowUp> = {}): FollowUp => ({
  id,
  parentId: 'pat_1',
  title: 'Eye clinic',
  kind: 'doctor_visit',
  dueDate: '2026-10-01',
  dueTime: null,
  notes: '',
  status: 'scheduled',
  sourceDocumentId: null,
  doctorCategory: null,
  calendarEventId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const merge = (input: Partial<Parameters<typeof mergeFollowUps>[0]>) =>
  mergeFollowUps({
    local: [],
    remoteByPatient: {},
    removedPatientIds: [],
    pendingIds: [],
    ...input,
  });

describe('what the server has and this phone does not', () => {
  it('arrives', () => {
    const merged = merge({ remoteByPatient: { pat_1: [followUp('fup_1')] } });

    expect(merged.map((entry) => entry.id)).toEqual(['fup_1']);
  });

  it('brings a change somebody else made', () => {
    const merged = merge({
      local: [followUp('fup_1')],
      remoteByPatient: { pat_1: [followUp('fup_1', { status: 'completed' })] },
    });

    expect(merged[0]?.status).toBe('completed');
  });
});

describe('a change this phone has not sent yet', () => {
  /**
   * The queue holds the only copy of what somebody just did. Applying the
   * server's row over it would undo a completed appointment on screen while its
   * request was still waiting to go out.
   */
  it('survives a pull that disagrees with it', () => {
    const merged = merge({
      local: [followUp('fup_1', { status: 'completed' })],
      remoteByPatient: { pat_1: [followUp('fup_1', { status: 'scheduled' })] },
      pendingIds: ['fup_1'],
    });

    expect(merged[0]?.status).toBe('completed');
  });

  /** Including a task the server has never seen, which is the create case. */
  it('is not removed for being absent from the server', () => {
    const merged = merge({
      local: [followUp('fup_new')],
      remoteByPatient: { pat_1: [] },
      pendingIds: ['fup_new'],
    });

    expect(merged.map((entry) => entry.id)).toEqual(['fup_new']);
  });
});

describe('a task the server no longer has', () => {
  it('goes, because somebody deleted it', () => {
    const merged = merge({
      local: [followUp('fup_1')],
      remoteByPatient: { pat_1: [] },
    });

    expect(merged).toEqual([]);
  });

  /**
   * Unless the record was not pulled at all. A failed request says nothing
   * about what the server holds, and clearing the list on a bad connection
   * would look exactly like everybody's tasks being deleted.
   */
  it('stays when that record was not fetched', () => {
    const merged = merge({
      local: [followUp('fup_1')],
      remoteByPatient: { pat_2: [] },
    });

    expect(merged.map((entry) => entry.id)).toEqual(['fup_1']);
  });
});

describe('a record this account can no longer reach', () => {
  it('takes its tasks with it', () => {
    const merged = merge({
      local: [followUp('fup_1'), followUp('fup_2', { parentId: 'pat_2' })],
      remoteByPatient: { pat_2: [] },
      removedPatientIds: ['pat_1'],
    });

    expect(merged).toEqual([]);
  });
});

describe('the calendar link', () => {
  /**
   * `calendarEventId` names an event in one phone's calendar. Taking another
   * device's id would put a "remove from your calendar" button on a screen
   * where there is nothing to remove.
   */
  it('is never replaced by another device’s', () => {
    const merged = merge({
      local: [followUp('fup_1', { calendarEventId: 'this-phone-1' })],
      remoteByPatient: { pat_1: [followUp('fup_1', { calendarEventId: 'other-phone-9' })] },
    });

    expect(merged[0]?.calendarEventId).toBe('this-phone-1');
  });

  it('is taken from the server when this phone has none', () => {
    const merged = merge({
      local: [followUp('fup_1')],
      remoteByPatient: { pat_1: [followUp('fup_1', { calendarEventId: 'other-phone-9' })] },
    });

    expect(merged[0]?.calendarEventId).toBe('other-phone-9');
  });
});
