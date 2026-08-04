import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

/**
 * Typed environment.
 *
 * Two rules this file exists to enforce:
 *
 * 1. No value here is ever exposed on an HTTP response. `/health` deliberately
 *    returns a fixed shape — telling a caller whether a model key is present is
 *    itself a small information leak.
 * 2. `SARVAM_API_KEY` is optional, and its *absence* selects the mock summary
 *    provider. Nothing has to be configured to run this service safely; you
 *    have to opt in to talking to an external provider.
 *
 * There is no `EXPO_PUBLIC_*` variable in this project and there must never be
 * one — anything with that prefix ships inside the mobile bundle. See
 * docs/architecture/adr/001-ai-data-boundary.md.
 */

/** Bytes in a megabyte, spelled out so the defaults below read honestly. */
const MB = 1024 * 1024;

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Absent by default. Absence is what selects the mock provider. */
  SARVAM_API_KEY: z.string().min(1).optional(),
  SARVAM_MODEL: z.string().min(1).default('sarvam-30b'),
  SARVAM_BASE_URL: z.string().url().default('https://api.sarvam.ai'),

  /** Where page images live for the seconds they exist. Cleared in `finally`. */
  PROCESSING_TEMP_DIR: z.string().min(1).default(path.join(os.tmpdir(), 'ayunetz-processing')),
  MAX_PAGE_BYTES: positiveInt(10 * MB),
  MAX_DOCUMENT_PAGES: positiveInt(10),
});

export type RawEnv = z.infer<typeof envSchema>;

/** Which summary implementation the orchestrator will be given. */
export type SummaryProviderMode = 'mock' | 'sarvam';

export interface AppConfig extends RawEnv {
  readonly summaryProviderMode: SummaryProviderMode;
  readonly isProduction: boolean;
}

export class EnvironmentError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'EnvironmentError';
  }
}

/**
 * Drops blank values so a variable written but left empty — `SARVAM_API_KEY=`
 * in a copied `.env.example` — means "unset" and falls back to the default.
 *
 * This matters beyond tidiness: a blank key must land in mock mode rather than
 * failing to boot, otherwise the safe configuration is the awkward one.
 */
const withoutBlanks = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );

/**
 * Parses and freezes configuration.
 *
 * Takes the source explicitly rather than reading `process.env` internally so
 * tests can exercise it without mutating global state.
 */
export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(withoutBlanks(source));

  if (!parsed.success) {
    throw new EnvironmentError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  const env = parsed.data;

  return Object.freeze({
    ...env,
    summaryProviderMode: env.SARVAM_API_KEY === undefined ? 'mock' : 'sarvam',
    isProduction: env.NODE_ENV === 'production',
  });
};

/**
 * Redacted view of the configuration, safe to log at startup.
 *
 * Reports only *whether* a provider is configured, never the key, and never the
 * key's length or prefix.
 */
export const describeConfig = (config: AppConfig): Record<string, string | number> => ({
  nodeEnv: config.NODE_ENV,
  port: config.PORT,
  logLevel: config.LOG_LEVEL,
  summaryProvider: config.summaryProviderMode,
  maxPageBytes: config.MAX_PAGE_BYTES,
  maxDocumentPages: config.MAX_DOCUMENT_PAGES,
});
