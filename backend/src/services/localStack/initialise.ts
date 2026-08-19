import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

import type { StackConfig } from '../../config/stack.js';
import { ensureTable } from '../records/tableDefinition.js';

/**
 * Creates the bucket and table the local stack needs.
 *
 * Only ever runs against `local`. On AWS these are created by the CDK stack,
 * and a service that can create its own buckets is a service holding
 * permissions it has no business holding — so this refuses rather than being
 * merely unused there.
 *
 * Idempotent, because it runs on every `npm run stack:up`.
 */
export const initialiseLocalStack = async (config: StackConfig): Promise<void> => {
  if (config.name === 'aws') {
    throw new Error(
      'Refusing to create infrastructure on AWS. Buckets and tables are created by the CDK stack, not by the service.',
    );
  }

  const s3 = new S3Client(config.clients.objects);

  try {
    await s3.send(new CreateBucketCommand({ Bucket: config.documentsBucket }));
  } catch (error) {
    const name = (error as Error).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
  }

  await ensureTable(config);
};
