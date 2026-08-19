import { z } from 'zod';

/**
 * Which set of infrastructure this process is talking to.
 *
 * See ../../../docs/architecture/adr/003-local-cloud-parity.md. The short
 * version: every cloud dependency sits behind a port, and the stack is chosen
 * here, once, at process start — never by the mobile application, and never
 * per-request.
 *
 * ## The thing worth knowing before reading further
 *
 * ADR-003 describes "a local driver and an AWS driver" per port. Building it
 * showed that for object storage, records and the queue there is only **one**
 * driver: MinIO speaks S3, DynamoDB Local speaks DynamoDB, and ElasticMQ speaks
 * SQS, so the same AWS SDK client is used against both, differing only in
 * endpoint and credentials. Token verification is the same story — a local
 * issuer and a Cognito user pool are both JWKS endpoints.
 *
 * That is a better outcome than the ADR predicted: the local path exercises the
 * code that ships rather than a parallel implementation of it, and there is
 * almost no code that only runs locally. OCR is the exception, and the only
 * place a genuinely separate implementation is needed, because Textract has no
 * local equivalent.
 *
 * What it does not change is the list of things a local stack cannot prove —
 * IAM, key policies, residency, Textract's real output. Those are in ADR-003
 * and belong to the Phase 2 gate.
 */
export type StackName = 'local' | 'aws';

/** Credentials for the emulators. Deliberately fixed, and deliberately fake. */
const LOCAL_CREDENTIALS = {
  accessKeyId: 'ayunetz-local',
  secretAccessKey: 'ayunetz-local-secret',
} as const;

const LOCAL_DEFAULTS = {
  objects: 'http://localhost:19090',
  records: 'http://localhost:19092',
  queue: 'http://localhost:19093',
} as const;

export const stackSchema = z.object({
  /**
   * `local` runs against the containers in `backend/docker-compose.yml` and
   * needs no cloud account. `aws` uses the ambient credential chain.
   *
   * Defaults to `local`, so a checkout with nothing configured cannot
   * accidentally reach a real account.
   */
  AYUNETZ_STACK: z.enum(['local', 'aws']).default('local'),

  AWS_REGION: z.string().min(1).default('ap-south-1'),

  /** Endpoint overrides. Ignored entirely when the stack is `aws`. */
  AYUNETZ_OBJECTS_ENDPOINT: z.string().url().default(LOCAL_DEFAULTS.objects),
  AYUNETZ_RECORDS_ENDPOINT: z.string().url().default(LOCAL_DEFAULTS.records),
  AYUNETZ_QUEUE_ENDPOINT: z.string().url().default(LOCAL_DEFAULTS.queue),

  AYUNETZ_DOCUMENTS_BUCKET: z.string().min(1).default('ayunetz-documents-local'),
  AYUNETZ_RECORDS_TABLE: z.string().min(1).default('ayunetz-records-local'),
  AYUNETZ_PROCESSING_QUEUE: z.string().min(1).default('ayunetz-processing'),

  /**
   * How long a presigned upload URL stays valid.
   *
   * Short on purpose: the URL is a bearer credential for writing to a bucket
   * holding medical scans, and it is handed to a phone over the network.
   */
  AYUNETZ_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
});

export type RawStackEnv = z.infer<typeof stackSchema>;

export interface AwsClientOptions {
  readonly region: string;
  readonly endpoint?: string;
  readonly credentials?: { accessKeyId: string; secretAccessKey: string };
  /** MinIO serves buckets by path, not as a DNS subdomain. */
  readonly forcePathStyle?: boolean;
}

export interface StackConfig {
  readonly name: StackName;
  readonly region: string;
  readonly documentsBucket: string;
  readonly recordsTable: string;
  readonly processingQueue: string;
  readonly presignTtlSeconds: number;
  /**
   * SDK options per service, already shaped for the chosen stack.
   *
   * On `aws` each carries only the region, which is what makes the default
   * credential chain apply. On `local` each carries its emulator's endpoint —
   * they listen on three different ports — and the fixed fake credentials.
   */
  readonly clients: {
    readonly objects: AwsClientOptions;
    readonly records: AwsClientOptions;
    readonly queue: AwsClientOptions;
  };
}

const clientOptionsFor = (stack: StackName, region: string, endpoint: string): AwsClientOptions =>
  stack === 'aws'
    ? { region }
    : { region, endpoint, credentials: { ...LOCAL_CREDENTIALS }, forcePathStyle: true };

const withoutBlanks = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );

/**
 * Resolves stack configuration.
 *
 * Takes its source explicitly, like `loadConfig`, so tests can exercise it
 * without mutating global state.
 */
export const loadStackConfig = (source: NodeJS.ProcessEnv = process.env): StackConfig => {
  const env = stackSchema.parse(withoutBlanks(source));
  const stack = env.AYUNETZ_STACK;
  const options = (endpoint: string): AwsClientOptions =>
    clientOptionsFor(stack, env.AWS_REGION, endpoint);

  return Object.freeze({
    name: stack,
    region: env.AWS_REGION,
    documentsBucket: env.AYUNETZ_DOCUMENTS_BUCKET,
    recordsTable: env.AYUNETZ_RECORDS_TABLE,
    processingQueue: env.AYUNETZ_PROCESSING_QUEUE,
    presignTtlSeconds: env.AYUNETZ_PRESIGN_TTL_SECONDS,
    clients: Object.freeze({
      objects: options(env.AYUNETZ_OBJECTS_ENDPOINT),
      records: options(env.AYUNETZ_RECORDS_ENDPOINT),
      queue: options(env.AYUNETZ_QUEUE_ENDPOINT),
    }),
  });
};

/** Safe to log at startup: names and endpoints only, never a credential. */
export const describeStack = (config: StackConfig): Record<string, string | number> => ({
  stack: config.name,
  region: config.region,
  documentsBucket: config.documentsBucket,
  recordsTable: config.recordsTable,
  processingQueue: config.processingQueue,
  presignTtlSeconds: config.presignTtlSeconds,
});
