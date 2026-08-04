import { describe, expect, it } from 'vitest';

import { describeConfig, EnvironmentError, loadConfig } from '../../src/config/env.js';

describe('loadConfig', () => {
  it('starts with a working default from an empty environment', () => {
    const config = loadConfig({});

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(4000);
    expect(config.MAX_DOCUMENT_PAGES).toBe(10);
    expect(config.MAX_PAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(config.PROCESSING_TEMP_DIR.length).toBeGreaterThan(0);
  });

  it('selects the mock summary provider when no key is configured', () => {
    expect(loadConfig({}).summaryProviderMode).toBe('mock');
    // An explicitly blank key is a blank key, not a configured provider.
    expect(loadConfig({ SARVAM_API_KEY: '' }).summaryProviderMode).toBe('mock');
  });

  it('selects Sarvam only when a key is explicitly present', () => {
    const config = loadConfig({ SARVAM_API_KEY: 'test-key-not-real' });

    expect(config.summaryProviderMode).toBe('sarvam');
  });

  it('coerces numeric variables and rejects nonsense', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(EnvironmentError);
    expect(() => loadConfig({ MAX_DOCUMENT_PAGES: '0' })).toThrow(EnvironmentError);
    expect(() => loadConfig({ MAX_PAGE_BYTES: '-1' })).toThrow(EnvironmentError);
  });

  it('rejects an unknown NODE_ENV rather than guessing', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(EnvironmentError);
  });

  it('is frozen, so nothing can raise a limit at runtime', () => {
    const config = loadConfig({});

    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('describeConfig', () => {
  it('never reports the API key or its presence in a guessable form', () => {
    const config = loadConfig({ SARVAM_API_KEY: 'sk-super-secret-value' });
    const described = describeConfig(config);
    const serialised = JSON.stringify(described);

    expect(serialised).not.toContain('sk-super-secret-value');
    expect(serialised).not.toContain('SARVAM_API_KEY');
    expect(Object.keys(described)).not.toContain('SARVAM_API_KEY');
    // The provider *mode* is operationally necessary and is not a secret.
    expect(described.summaryProvider).toBe('sarvam');
  });

  it('does not leak the temp directory path into startup logs', () => {
    const config = loadConfig({ PROCESSING_TEMP_DIR: '/home/someone/private/scans' });

    expect(JSON.stringify(describeConfig(config))).not.toContain('/home/someone');
  });
});
