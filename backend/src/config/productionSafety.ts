import type { AppConfig } from './env.js';
import type { StackConfig } from './stack.js';

/**
 * Combinations that must never start.
 *
 * Every one of these is a configuration that looks like it works. The service
 * boots, answers requests and appears healthy — while serving fake summaries as
 * real ones, or exposing a token issuer that mints a token for any subject
 * asked for. Nobody notices until somebody acts on the output.
 *
 * So they are a startup failure rather than a warning. A process that refuses
 * to start gets fixed in minutes; a warning in a log gets fixed after an
 * incident.
 *
 * Called from `buildApp`, so it runs for the API, the worker and every test
 * that builds either.
 */

export class UnsafeConfiguration extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Refusing to start with this configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
    );
    this.name = 'UnsafeConfiguration';
    this.problems = problems;
  }
}

export interface SafetyInput {
  config: Pick<AppConfig, 'NODE_ENV' | 'SARVAM_API_KEY' | 'LOG_LEVEL'>;
  stack: Pick<StackConfig, 'name'>;
}

/**
 * Returns every problem, not just the first.
 *
 * Fixing a misconfiguration one restart at a time is how a deployment window
 * gets used up. The list is the point.
 */
export const productionProblems = ({ config, stack }: SafetyInput): string[] => {
  const problems: string[] = [];

  if (config.NODE_ENV !== 'production') return problems;

  /**
   * Mock summaries in production.
   *
   * The provider factory falls back to a mock when no key is set — correct for
   * development, catastrophic in production. The mock returns plausible
   * medical-looking text, so the failure mode is not an error, it is a
   * confident fabricated summary of somebody's blood test.
   */
  if (config.SARVAM_API_KEY === undefined) {
    problems.push(
      'NODE_ENV=production with no summary provider key. The service would serve mock ' +
        'summaries as real ones.',
    );
  }

  /**
   * The local stack in production.
   *
   * `AYUNETZ_STACK=local` points at endpoint overrides meant for containers on
   * a laptop. In production it means the records are going somewhere nobody
   * intended, or nowhere at all.
   */
  if (stack.name !== 'aws') {
    problems.push(
      `NODE_ENV=production with AYUNETZ_STACK=${stack.name}. Production must use the aws stack.`,
    );
  }

  /**
   * Debug logging in production.
   *
   * Not a leak on its own — the serialisers are narrowed and bodies are never
   * logged — but `debug` is where a future contributor's temporary log line
   * ends up, and this service handles pages of medical records.
   */
  if (config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace') {
    problems.push(
      `NODE_ENV=production with LOG_LEVEL=${config.LOG_LEVEL}. Use info or higher.`,
    );
  }

  return problems;
};

/**
 * The development identity issuer must not exist outside the local stack.
 *
 * It mints a valid token for any subject asked for, which is the correct
 * behaviour for a development issuer and a complete authentication bypass
 * anywhere else. `createLocalIssuer` and `localIdentityRoutes` both refuse on
 * `aws` already; this is the third guard, and it is deliberate — the thing it
 * prevents is unauthenticated access to every family's records.
 */
export const assertSafeToStart = (input: SafetyInput): void => {
  const problems = productionProblems(input);
  if (problems.length > 0) throw new UnsafeConfiguration(problems);
};
