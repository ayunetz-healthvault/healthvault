import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import type { StackConfig } from '../../config/stack.js';

/**
 * The processing queue.
 *
 * One implementation, two stacks: ElasticMQ speaks SQS, so this is the code
 * that ships, exercised locally. Visibility timeouts and dead-letter redrive
 * behave the same in both, which is the part of P2-06 that most needs to be
 * real rather than simulated.
 *
 * ## What a message may contain
 *
 * Identifiers and nothing else. No OCR text, no page bytes, no patient details,
 * no object URL. A queue is durable, visible in a console, and often the first
 * thing exported when someone debugs a backlog — see ADR-001's logging rule,
 * which applies here for the same reason.
 */
export interface ProcessingJob {
  readonly ownerId: string;
  readonly documentId: string;
  /** How many pages were uploaded, so a worker can check before starting. */
  readonly pageCount: number;
  /**
   * Set by the sender, and the thing that makes a job safe to retry.
   *
   * A message can be delivered more than once — that is SQS's contract, not a
   * defect — so the worker keys its "have I already done this?" check on this
   * rather than assuming one delivery.
   */
  readonly attemptToken: string;
}

export interface ReceivedJob {
  readonly job: ProcessingJob;
  /** Opaque handle for acknowledging this specific delivery. */
  readonly receipt: string;
}

export interface JobQueue {
  enqueue(job: ProcessingJob): Promise<void>;
  /** Long-polls. Returns an empty array when nothing is waiting. */
  receive(max?: number): Promise<ReceivedJob[]>;
  /** Removes a message so it is not redelivered. */
  acknowledge(receipt: string): Promise<void>;
}

/** Rejects anything carrying more than identifiers, before it is durable. */
const assertNoPayload = (job: ProcessingJob): void => {
  const allowed = new Set(['ownerId', 'documentId', 'pageCount', 'attemptToken']);
  const extra = Object.keys(job).filter((key) => !allowed.has(key));

  if (extra.length > 0) {
    throw new Error(
      `A processing job may carry identifiers only. Refusing to enqueue: ${extra.join(', ')}`,
    );
  }
};

export const createJobQueue = (config: StackConfig): JobQueue => {
  const client = new SQSClient(config.clients.queue);

  let queueUrl: string | undefined;
  const resolveQueueUrl = async (): Promise<string> => {
    queueUrl ??= (await client.send(new GetQueueUrlCommand({ QueueName: config.processingQueue })))
      .QueueUrl;

    if (queueUrl === undefined) {
      throw new Error(`Queue not found: ${config.processingQueue}`);
    }
    return queueUrl;
  };

  return {
    async enqueue(job) {
      assertNoPayload(job);
      await client.send(
        new SendMessageCommand({
          QueueUrl: await resolveQueueUrl(),
          MessageBody: JSON.stringify(job),
        }),
      );
    },

    async receive(max = 1) {
      const response = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: await resolveQueueUrl(),
          MaxNumberOfMessages: max,
          WaitTimeSeconds: 5,
        }),
      );

      return (response.Messages ?? []).flatMap((message) => {
        if (message.Body === undefined || message.ReceiptHandle === undefined) return [];
        return [
          {
            job: JSON.parse(message.Body) as ProcessingJob,
            receipt: message.ReceiptHandle,
          },
        ];
      });
    },

    async acknowledge(receipt) {
      await client.send(
        new DeleteMessageCommand({ QueueUrl: await resolveQueueUrl(), ReceiptHandle: receipt }),
      );
    },
  };
};
