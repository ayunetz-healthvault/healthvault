/**
 * Typed, validated access to the `EXPO_PUBLIC_*` environment.
 *
 * Everything here ships inside the app bundle and is therefore public. Secrets
 * (LLM keys, AWS credentials, Cognito client secrets) live in AWS Secrets
 * Manager and are only ever read by Lambda. See `.env.example`.
 */

export type AppEnvironment = 'local' | 'demo' | 'dev' | 'staging' | 'prod';

export interface AppConfig {
  readonly environment: AppEnvironment;
  /**
   * A demonstration build: fictional records, no server, nothing leaves the
   * device. See `isDemoBuild` below for why this is not a user-facing toggle.
   */
  readonly demo: boolean;
  readonly aws: {
    /** ap-south-1 (Mumbai) — health records for Indian patients stay in-region. */
    readonly region: string;
    readonly documentsBucket: string;
  };
  readonly api: {
    readonly baseUrl: string;
    /** Budget for an ordinary CRUD call. */
    readonly timeoutMs: number;
    /**
     * Budget for a document-processing call, which is a different kind of wait.
     *
     * The backend gives its own pipeline 120 s, inside which the summary
     * provider may spend three attempts of 60 s. Applying the CRUD timeout here
     * would abandon work that was still legitimately running, so this is a
     * separate number: long enough to cover the backend's whole budget plus an
     * upload over a slow connection, short enough that a dead server does not
     * strand the screen forever.
     */
    readonly processingTimeoutMs: number;
  };
  readonly cognito: {
    readonly userPoolId: string;
    readonly appClientId: string;
    readonly domain: string;
    readonly redirectUri: string;
  };
  readonly upload: {
    readonly presignTtlSeconds: number;
    readonly maxUploadBytes: number;
  };
  readonly features: {
    readonly aiSummary: boolean;
    readonly calendarSync: boolean;
    readonly biometricLock: boolean;
  };
  readonly sentryDsn: string | null;
}

const readString = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
};

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1') return true;
  if (trimmed === 'false' || trimmed === '0') return false;
  return fallback;
};

const readNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readEnvironment = (value: string | undefined): AppEnvironment => {
  switch (value?.trim()) {
    case 'demo':
    case 'dev':
    case 'staging':
    case 'prod':
      return value.trim() as AppEnvironment;
    default:
      return 'local';
  }
};

const environment = readEnvironment(process.env.EXPO_PUBLIC_ENV);

export const config: AppConfig = {
  environment,
  // Demo defaults ON for a local checkout and for the `demo` build profile, so
  // a fresh clone is demoable with no setup — and OFF everywhere else, so no
  // shipped build can quietly become one.
  demo: readBoolean(
    process.env.EXPO_PUBLIC_DEMO,
    environment === 'local' || environment === 'demo',
  ),
  aws: {
    region: readString(process.env.EXPO_PUBLIC_AWS_REGION, 'ap-south-1'),
    documentsBucket: readString(
      process.env.EXPO_PUBLIC_S3_DOCUMENTS_BUCKET,
      'ayunetz-documents-local',
    ),
  },
  api: {
    baseUrl: readString(process.env.EXPO_PUBLIC_API_BASE_URL, 'https://api.local.ayunetz.invalid'),
    timeoutMs: readNumber(process.env.EXPO_PUBLIC_API_TIMEOUT_MS, 20_000),
    processingTimeoutMs: readNumber(process.env.EXPO_PUBLIC_PROCESSING_TIMEOUT_MS, 180_000),
  },
  cognito: {
    userPoolId: readString(process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID, ''),
    appClientId: readString(process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_ID, ''),
    domain: readString(process.env.EXPO_PUBLIC_COGNITO_DOMAIN, ''),
    redirectUri: readString(
      process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI,
      'ayunetz://auth/callback',
    ),
  },
  upload: {
    presignTtlSeconds: readNumber(process.env.EXPO_PUBLIC_UPLOAD_PRESIGN_TTL_SECONDS, 900),
    maxUploadBytes: readNumber(process.env.EXPO_PUBLIC_MAX_UPLOAD_MB, 25) * 1024 * 1024,
  },
  features: {
    aiSummary: readBoolean(process.env.EXPO_PUBLIC_FEATURE_AI_SUMMARY, true),
    calendarSync: readBoolean(process.env.EXPO_PUBLIC_FEATURE_CALENDAR_SYNC, true),
    biometricLock: readBoolean(process.env.EXPO_PUBLIC_FEATURE_BIOMETRIC_LOCK, true),
  },
  sentryDsn: readString(process.env.EXPO_PUBLIC_SENTRY_DSN, '') || null,
};

/**
 * Hosts an `http://` base URL is tolerated for.
 *
 * Loopback and the private ranges a phone reaches a laptop on. Anything else
 * must be `https://`.
 */
const isLocalHost = (host: string): boolean =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '10.0.2.2' || // Android emulator's alias for the host machine
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host);

/**
 * True when the app should talk to a real backend rather than its mocks.
 *
 * `https://` is always accepted. `http://` is accepted **only** for a loopback
 * or private-LAN host while `EXPO_PUBLIC_ENV=local`, which is what makes the
 * Phase 1 development backend reachable at `http://localhost:4000` from the
 * simulator or `http://192.168.x.x:4000` from a phone on the same wifi.
 *
 * That exception is narrow on purpose. Plaintext HTTP to any routable host
 * would put a scan of somebody's medical record on the wire in the clear, so
 * the environment flag and the host check both have to agree. A Codespaces
 * tunnel is `https://` and needs no exception at all.
 */
export const isBackendEnabled = (): boolean => {
  if (config.demo) return false;

  const url = config.api.baseUrl;

  if (url.startsWith('https://')) return true;

  if (environment !== 'local' || !url.startsWith('http://')) return false;

  const host = url.slice('http://'.length).split(/[:/]/)[0] ?? '';
  return isLocalHost(host);
};

/**
 * True when this build is a demonstration.
 *
 * Demo builds show fictional records to an audience — an investor, a hospital,
 * a family deciding whether to trust the app — and must be unmistakable as
 * such. Three properties make that safe:
 *
 * 1. **It is chosen at build time, not by a switch in the app.** A production
 *    build has `EXPO_PUBLIC_DEMO=false` compiled into the bundle and cannot be
 *    talked into demo mode by a setting, a deep link, or a support call.
 * 2. **No demo build can reach a server.** `isBackendEnabled` returns false
 *    unconditionally above. If someone photographs a real prescription during a
 *    demo — which will happen — the pages cannot leave the device even if the
 *    API URL is configured.
 * 3. **The app says so.** The records are labelled fictional wherever they are
 *    described, rather than in a footnote nobody reads.
 *
 * The default follows `EXPO_PUBLIC_ENV`: a local checkout is a demo unless it
 * opts out, everything else is live unless it opts in. Getting this backwards
 * is the difference between a developer seeing sample data and a caregiver
 * being shown a stranger's fictional medicines as if they were their parent's.
 */
export const isDemoBuild = (): boolean => config.demo;
