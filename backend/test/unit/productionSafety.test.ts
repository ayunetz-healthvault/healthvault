import { describe, expect, it } from 'vitest';

import {
  assertSafeToStart,
  productionProblems,
  UnsafeConfiguration,
} from '../../src/config/productionSafety.js';

/**
 * Configurations that must not produce a running service.
 *
 * Every one of these boots, answers requests and looks healthy while being
 * wrong in a way nobody notices until somebody acts on the output. The worst is
 * the first: the provider factory falls back to a mock when no key is set, and
 * the mock returns plausible medical-looking text — so the failure mode is not
 * an error, it is a confident fabricated summary of somebody's blood test.
 */

const safe = {
  config: {
    NODE_ENV: 'production' as const,
    SARVAM_API_KEY: 'a-real-key',
    LOG_LEVEL: 'info' as const,
  },
  stack: { name: 'aws' as const },
};

describe('outside production', () => {
  it('allows the local stack and a mock provider, which is the whole point of it', () => {
    expect(
      productionProblems({
        config: { NODE_ENV: 'development', SARVAM_API_KEY: undefined, LOG_LEVEL: 'debug' },
        stack: { name: 'local' },
      }),
    ).toEqual([]);
  });

  it('allows the same in tests', () => {
    expect(
      productionProblems({
        config: { NODE_ENV: 'test', SARVAM_API_KEY: undefined, LOG_LEVEL: 'debug' },
        stack: { name: 'local' },
      }),
    ).toEqual([]);
  });
});

describe('in production', () => {
  it('accepts a properly configured deployment', () => {
    expect(productionProblems(safe)).toEqual([]);
    expect(() => assertSafeToStart(safe)).not.toThrow();
  });

  /** The one that would ship fabricated summaries as real ones. */
  it('refuses to start with no summary provider key', () => {
    const problems = productionProblems({
      ...safe,
      config: { ...safe.config, SARVAM_API_KEY: undefined },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/mock summaries as real ones/i);
  });

  it('refuses to start against the local stack', () => {
    const problems = productionProblems({ ...safe, stack: { name: 'local' } });

    expect(problems[0]).toMatch(/must use the aws stack/i);
  });

  it.each(['debug', 'trace'] as const)('refuses to start at %s logging', (level) => {
    const problems = productionProblems({
      ...safe,
      config: { ...safe.config, LOG_LEVEL: level },
    });

    expect(problems[0]).toMatch(/info or higher/i);
  });

  /** Fixing a misconfiguration one restart at a time uses up a deployment window. */
  it('reports every problem at once, not just the first', () => {
    const problems = productionProblems({
      config: { NODE_ENV: 'production', SARVAM_API_KEY: undefined, LOG_LEVEL: 'debug' },
      stack: { name: 'local' },
    });

    expect(problems).toHaveLength(3);
  });

  it('throws with all of them named', () => {
    let caught: unknown;
    try {
      assertSafeToStart({
        config: { NODE_ENV: 'production', SARVAM_API_KEY: undefined, LOG_LEVEL: 'debug' },
        stack: { name: 'local' },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnsafeConfiguration);
    expect((caught as UnsafeConfiguration).problems).toHaveLength(3);
    expect((caught as Error).message).toMatch(/aws stack/i);
  });

  /**
   * A warning gets fixed after an incident. A process that will not start gets
   * fixed in minutes.
   */
  it('is a startup failure rather than a warning', () => {
    expect(() =>
      assertSafeToStart({ ...safe, config: { ...safe.config, SARVAM_API_KEY: undefined } }),
    ).toThrow(UnsafeConfiguration);
  });
});
