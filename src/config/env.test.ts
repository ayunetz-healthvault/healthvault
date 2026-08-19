/**
 * `isBackendEnabled` decides whether a scan of somebody's medical record leaves
 * the phone, and over what. It reads module-level config derived from
 * `process.env` at import time, so each case re-imports the module with a fresh
 * environment.
 */

const withEnv = <T>(
  env: Record<string, string | undefined>,
  run: (module: typeof import('./env')) => T,
): T => {
  const original = { ...process.env };
  let result!: T;

  jest.isolateModules(() => {
    Object.assign(process.env, env);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('./env') as typeof import('./env');
    result = run(module);
  });

  process.env = original;
  return result;
};

const backendEnabled = (env: Record<string, string | undefined>): boolean =>
  withEnv(env, (module) => module.isBackendEnabled());

describe('isBackendEnabled', () => {
  it('is off by default, so a fresh clone never talks to a server', () => {
    expect(backendEnabled({})).toBe(false);
  });

  it('stays off while mocks are on, whatever the URL says', () => {
    expect(
      backendEnabled({
        EXPO_PUBLIC_DEMO: 'true',
        EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
      }),
    ).toBe(false);
  });

  it('accepts https anywhere', () => {
    expect(
      backendEnabled({
        EXPO_PUBLIC_DEMO: 'false',
        EXPO_PUBLIC_API_BASE_URL: 'https://curly-fiesta.github.dev',
      }),
    ).toBe(true);
  });

  describe('the http exception for local development', () => {
    const local = (url: string): boolean =>
      backendEnabled({
        EXPO_PUBLIC_DEMO: 'false',
        EXPO_PUBLIC_ENV: 'local',
        EXPO_PUBLIC_API_BASE_URL: url,
      });

    it.each([
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'http://10.0.2.2:4000',
      'http://192.168.1.42:4000',
      'http://10.1.2.3:4000',
      'http://172.16.0.9:4000',
    ])('allows %s, which is how the Phase 1 backend is reached', (url) => {
      expect(local(url)).toBe(true);
    });

    it.each([
      'http://api.ayunetz.in',
      'http://8.8.8.8:4000',
      'http://172.32.0.1:4000',
      'http://example.com',
      'http://localhost.evil.com',
    ])('refuses %s, which would put a scan on the wire in the clear', (url) => {
      expect(local(url)).toBe(false);
    });

    it.each(['dev', 'staging', 'prod'])(
      'refuses plaintext http in the %s environment even for localhost',
      (environment) => {
        expect(
          backendEnabled({
            EXPO_PUBLIC_DEMO: 'false',
            EXPO_PUBLIC_ENV: environment,
            EXPO_PUBLIC_API_BASE_URL: 'http://localhost:4000',
          }),
        ).toBe(false);
      },
    );

    it('refuses a URL with no scheme at all', () => {
      expect(local('localhost:4000')).toBe(false);
    });
  });
});

/**
 * Demo builds show fictional records to people deciding whether to trust this
 * app with their family's medical history. Two properties have to hold, and
 * neither can be left to a reviewer noticing: a shipped build is never a demo
 * by accident, and a demo build can never reach a server.
 */
describe('isDemoBuild', () => {
  const demoIn = (env: Record<string, string | undefined>): boolean =>
    withEnv(env, (module) => module.isDemoBuild());

  it('is on for a fresh clone, so the app is demoable with no setup', () => {
    expect(demoIn({})).toBe(true);
  });

  it('is on for the demo build profile', () => {
    expect(demoIn({ EXPO_PUBLIC_ENV: 'demo' })).toBe(true);
  });

  it.each(['dev', 'staging', 'prod'])('is off for a %s build unless asked for', (environment) => {
    expect(demoIn({ EXPO_PUBLIC_ENV: environment })).toBe(false);
  });

  it('can be turned off in a local checkout', () => {
    expect(demoIn({ EXPO_PUBLIC_ENV: 'local', EXPO_PUBLIC_DEMO: 'false' })).toBe(false);
  });

  it('never reaches a backend, whatever the API URL says', () => {
    expect(
      backendEnabled({
        EXPO_PUBLIC_DEMO: 'true',
        EXPO_PUBLIC_ENV: 'prod',
        EXPO_PUBLIC_API_BASE_URL: 'https://api.ayunetz.in',
      }),
    ).toBe(false);
  });

  it('does not reach a local backend either, so a demo cannot upload a real document', () => {
    expect(
      backendEnabled({
        EXPO_PUBLIC_DEMO: 'true',
        EXPO_PUBLIC_ENV: 'local',
        EXPO_PUBLIC_API_BASE_URL: 'http://localhost:4000',
      }),
    ).toBe(false);
  });
});
