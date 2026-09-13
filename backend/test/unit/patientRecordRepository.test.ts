import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LibDynamo from '@aws-sdk/lib-dynamodb';

/**
 * The production DynamoDB adapter, against a fake client that pages.
 *
 * These tests exist because of one line that read a `Query` response and threw
 * away its `LastEvaluatedKey`. DynamoDB returns at most 1 MB per query and
 * hands back a cursor for the rest; a caller that ignores it is silently
 * truncated rather than told anything. In a test with three rows that is
 * invisible, which is exactly why the bug survived — and in an erasure it means
 * deleting the first page of somebody's medical record, leaving the rest, and
 * reporting that the record is gone.
 *
 * So the client is faked, not the repository: the thing under test is the
 * adapter's own loop, and only the real one has it.
 */

interface SentCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

const sent: SentCommand[] = [];
let respond: (command: SentCommand) => Record<string, unknown>;

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof LibDynamo>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({
        send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
          const entry = { name: command.constructor.name, input: command.input };
          sent.push(entry);
          return respond(entry);
        },
      }),
    },
  };
});

const { loadStackConfig } = await import('../../src/config/stack.js');
const { createPatientRecordRepository } = await import(
  '../../src/services/records/PatientRecordRepository.js'
);
const { PATIENT_DELETION_SK } = await import('../../src/services/records/keys.js');

const PATIENT = 'pat_1';
const PK = `PATIENT#${PATIENT}`;

const repository = () => createPatientRecordRepository(loadStackConfig());

/** Two pages of items, then nothing, keyed the way DynamoDB keys them. */
const pagesOf = (...pages: string[][]) => {
  let index = 0;
  return (command: SentCommand): Record<string, unknown> => {
    if (command.name !== 'QueryCommand') return {};

    const page = pages[index] ?? [];
    index += 1;
    const isLast = index >= pages.length;

    return {
      Items: page.map((SK) => ({ PK, SK })),
      ...(isLast ? {} : { LastEvaluatedKey: { PK, SK: page.at(-1) } }),
    };
  };
};

const deletedKeys = (): string[] =>
  sent
    .filter((command) => command.name === 'DeleteCommand')
    .map((command) => ((command.input.Key as { SK: string }).SK));

beforeEach(() => {
  sent.length = 0;
  respond = () => ({});
});

describe('erasing a record that spans several query pages', () => {
  it('deletes every item, not just the first page', async () => {
    respond = pagesOf(
      ['DOC#doc_1', 'DOC#doc_2'],
      ['SUMMARY#doc_1', 'PROFILE'],
      // The third page is the second sweep finding nothing left.
      [],
    );

    const { items } = await repository().deleteEverythingFor(PATIENT);

    expect(items).toBe(4);
    expect(deletedKeys()).toEqual(['DOC#doc_1', 'DOC#doc_2', 'SUMMARY#doc_1', 'PROFILE']);
  });

  it('follows the cursor the previous page returned', async () => {
    respond = pagesOf(['DOC#doc_1'], ['DOC#doc_2'], []);

    await repository().deleteEverythingFor(PATIENT);

    const queries = sent.filter((command) => command.name === 'QueryCommand');
    expect(queries[0]?.input.ExclusiveStartKey).toBeUndefined();
    expect(queries[1]?.input.ExclusiveStartKey).toEqual({ PK, SK: 'DOC#doc_1' });
  });

  /**
   * The marker is the fence that stops anything writing into the record while
   * this runs, so the sweep leaves it standing. Taking it down is the route's
   * last act, once the objects are gone too.
   */
  it('leaves the deletion marker for the caller to remove', async () => {
    respond = pagesOf([PATIENT_DELETION_SK, 'DOC#doc_1'], []);

    const { items } = await repository().deleteEverythingFor(PATIENT);

    expect(items).toBe(1);
    expect(deletedKeys()).toEqual(['DOC#doc_1']);
  });

  /**
   * A second pass, because a request already in flight when the fence went up
   * can land behind the sweep. It costs one empty query on a record that has
   * nothing left.
   */
  it('sweeps again to catch a row written while the first pass ran', async () => {
    respond = pagesOf(['DOC#doc_1'], ['DOC#late'], []);

    const { items } = await repository().deleteEverythingFor(PATIENT);

    expect(items).toBe(2);
    expect(deletedKeys()).toEqual(['DOC#doc_1', 'DOC#late']);
  });
});

describe('listing a record that spans several query pages', () => {
  it('returns every document rather than the first page', async () => {
    respond = pagesOf(['DOC#doc_1'], ['DOC#doc_2']);

    const documents = await repository().listDocuments(PATIENT);

    expect(documents).toHaveLength(2);
  });

  /**
   * A bounded read still means what it says. "The last fifty audit entries"
   * stops at fifty rather than walking the whole partition to find them.
   */
  it('stops as soon as a limited query has what it asked for', async () => {
    respond = (command) =>
      command.name === 'QueryCommand'
        ? {
            Items: [
              { PK, SK: 'AUDIT#1' },
              { PK, SK: 'AUDIT#2' },
            ],
            LastEvaluatedKey: { PK, SK: 'AUDIT#2' },
          }
        : {};

    const entries = await repository().listAudit(PATIENT, 2);

    expect(entries).toHaveLength(2);
    expect(sent.filter((command) => command.name === 'QueryCommand')).toHaveLength(1);
  });
});
