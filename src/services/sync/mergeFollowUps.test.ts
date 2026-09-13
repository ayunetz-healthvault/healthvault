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
    pending: [],
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
      pending: [{ entityId: 'fup_1', operation: 'update' }],
    });

    expect(merged[0]?.status).toBe('completed');
  });

  /** Including a task the server has never seen, which is the create case. */
  it('is not removed for being absent from the server', () => {
    const merged = merge({
      local: [followUp('fup_new')],
      remoteByPatient: { pat_1: [] },
      pending: [{ entityId: 'fup_new', operation: 'create' }],
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

  /**
   * And a phone with no event keeps having no event. Falling back to the remote
   * id — which is what this used to do — told the screen there was something
   * here to remove, and handed another device's id to this device's calendar.
   */
  it('is never adopted by a phone that has no event of its own', () => {
    const merged = merge({
      local: [followUp('fup_1')],
      remoteByPatient: { pat_1: [followUp('fup_1', { calendarEventId: 'other-phone-9' })] },
    });

    expect(merged[0]?.calendarEventId).toBeNull();
  });
});

/**
 * A deletion this phone has not managed to send yet.
 *
 * The hardest of these to see, because there is nothing local to look at: the
 * screen removes the task the moment somebody taps delete — which is what makes
 * deleting feel immediate — and *then* queues the request. So the pull found a
 * task on the server that this device did not have, decided it was news, and
 * put the appointment back. The person deleted it, watched it go, and found it
 * waiting after the next refresh.
 */
describe('a task deleted here but not yet on the server', () => {
  const pendingDelete = [{ entityId: 'fup_1', operation: 'delete' as const }];

  it('does not come back on the next pull', () => {
    const merged = merge({
      local: [],
      remoteByPatient: { pat_1: [followUp('fup_1')] },
      pending: pendingDelete,
    });

    expect(merged).toEqual([]);
  });

  it('stays gone across repeated pulls while the delete is still queued', () => {
    const first = merge({
      local: [],
      remoteByPatient: { pat_1: [followUp('fup_1')] },
      pending: pendingDelete,
    });
    const second = merge({
      local: first,
      remoteByPatient: { pat_1: [followUp('fup_1')] },
      pending: pendingDelete,
    });

    expect(second).toEqual([]);
  });

  /** Other people's tasks still arrive; only the one being deleted is held back. */
  it('does not hold back anybody else’s tasks', () => {
    const merged = merge({
      local: [],
      remoteByPatient: { pat_1: [followUp('fup_1'), followUp('fup_2')] },
      pending: pendingDelete,
    });

    expect(merged.map((entry) => entry.id)).toEqual(['fup_2']);
  });

  /** Once the delete has been sent and the queue is empty, the server agrees. */
  it('is simply absent once the server has caught up', () => {
    const merged = merge({
      local: [],
      remoteByPatient: { pat_1: [] },
      pending: [],
    });

    expect(merged).toEqual([]);
  });
});

/**
 * An outbox that could not be read.
 *
 * Not the same as an empty one, and the difference is somebody's deletion. With
 * no way to tell a task the server deleted from one this device is about to
 * delete itself, the merge changes nothing rather than guessing — a queue error
 * must not be read as proof that no local changes exist.
 */
describe('when the queue cannot be read', () => {
  it('leaves the local list exactly as it is', () => {
    const local = [followUp('fup_1', { status: 'completed' })];

    const merged = merge({
      local,
      remoteByPatient: { pat_1: [followUp('fup_1'), followUp('fup_2')] },
      pending: 'unknown',
    });

    expect(merged).toEqual(local);
  });

  it('adds nothing, so a pending deletion cannot be undone', () => {
    const merged = merge({
      local: [],
      remoteByPatient: { pat_1: [followUp('fup_1')] },
      pending: 'unknown',
    });

    expect(merged).toEqual([]);
  });

  /**
   * With one exception: a record this account can no longer reach. Revocation
   * and deletion are the server's to decide, and no local change can be waiting
   * to contradict them.
   */
  it('still removes the tasks of a record that has gone', () => {
    const merged = merge({
      local: [followUp('fup_1'), followUp('fup_2', { parentId: 'pat_2' })],
      remoteByPatient: {},
      removedPatientIds: ['pat_1'],
      pending: 'unknown',
    });

    expect(merged.map((entry) => entry.id)).toEqual(['fup_2']);
  });
});
