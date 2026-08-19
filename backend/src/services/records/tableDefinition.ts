import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';

import type { StackConfig } from '../../config/stack.js';
import { GSI1_NAME } from './keys.js';

/**
 * The table, as code.
 *
 * This is the definition the local stack creates and the definition the CDK
 * stack must mirror in P2-01. Keeping it here rather than only in
 * infrastructure means the shape the code expects and the shape the tests run
 * against cannot drift apart while the CDK stack does not yet exist.
 *
 * On-demand billing: the access pattern is a caregiver opening an app a few
 * times a day, which is exactly the shape provisioned capacity is bad at.
 */
export const tableDefinition = (tableName: string): CreateTableCommandInput => ({
  TableName: tableName,
  BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [
    { AttributeName: 'PK', AttributeType: 'S' },
    { AttributeName: 'SK', AttributeType: 'S' },
    { AttributeName: 'GSI1PK', AttributeType: 'S' },
    { AttributeName: 'GSI1SK', AttributeType: 'S' },
  ],
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: GSI1_NAME,
      KeySchema: [
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
      ],
      // Sparse: only items belonging to a parent set these attributes, so the
      // index holds documents and follow-ups rather than a copy of everything.
      Projection: { ProjectionType: 'ALL' },
    },
  ],
});

/**
 * Time-to-live, applied to idempotency markers only.
 *
 * Nothing clinical is ever given a TTL. A record expiring quietly is the wrong
 * failure mode for a medical document, and deletion is an explicit, audited
 * operation — see P2-16.
 *
 * DynamoDB Local accepts the TTL setting but does not actually expire items on
 * schedule. That divergence is noted in ADR-003 and means expiry behaviour is
 * unproven until it runs on AWS.
 */
export const TTL_ATTRIBUTE = 'expiresAt';

/**
 * Creates the table if it is missing.
 *
 * For the local stack and for tests. On AWS the table is created by the CDK
 * stack, and a service that can create its own tables is a service with
 * permissions it should not have.
 */
export const ensureTable = async (config: StackConfig): Promise<void> => {
  if (config.name === 'aws') {
    throw new Error(
      'Refusing to create a table on AWS. Infrastructure is created by the CDK stack, not by the service.',
    );
  }

  const client = new DynamoDBClient(config.clients.records);
  const TableName = config.recordsTable;

  try {
    await client.send(new DescribeTableCommand({ TableName }));
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }

  await client.send(new CreateTableCommand(tableDefinition(TableName)));
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName,
      TimeToLiveSpecification: { AttributeName: TTL_ATTRIBUTE, Enabled: true },
    }),
  );
};
