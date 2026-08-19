/**
 * The regression these tests exist for: a build with no cloud storage told
 * users their records were "encrypted and stored in the Mumbai (ap-south-1)
 * region". The rule below is mechanical and therefore testable — only the cloud
 * tier may name a region or claim encrypted storage, and every other tier must
 * admit it is a prototype.
 *
 * Like `env.test.ts`, this re-imports the module per case because residency is
 * derived from `process.env` at import time.
 */

const withEnv = <T>(
  env: Record<string, string | undefined>,
  run: (module: typeof import('./dataResidency')) => T,
): T => {
  const original = { ...process.env };
  let result!: T;

  jest.isolateModules(() => {
    Object.assign(process.env, env);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('./dataResidency') as typeof import('./dataResidency');
    result = run(module);
  });

  process.env = original;
  return result;
};

const describeIn = (env: Record<string, string | undefined>) =>
  withEnv(env, (module) => module.describeDataResidency());

const tierIn = (env: Record<string, string | undefined>) =>
  withEnv(env, (module) => module.resolveDataResidencyTier());

/** A fresh clone with nothing configured. */
const DEMO = {};

/**
 * Not a demo, but with no usable backend either — a misconfigured build, which
 * is exactly when honest copy matters most.
 */
const ON_DEVICE = {
  EXPO_PUBLIC_DEMO: 'false',
  EXPO_PUBLIC_ENV: 'prod',
  EXPO_PUBLIC_API_BASE_URL: 'http://not-a-local-host.example.com',
};

const LOCAL_BACKEND = {
  EXPO_PUBLIC_DEMO: 'false',
  EXPO_PUBLIC_ENV: 'local',
  EXPO_PUBLIC_API_BASE_URL: 'http://localhost:4000',
};

const CLOUD = {
  EXPO_PUBLIC_DEMO: 'false',
  EXPO_PUBLIC_ENV: 'prod',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.ayunetz.in',
};

describe('resolveDataResidencyTier', () => {
  it('is demo for a fresh clone, whatever else is configured', () => {
    expect(tierIn(DEMO)).toBe('demo');
    expect(tierIn({ ...CLOUD, EXPO_PUBLIC_DEMO: 'true' })).toBe('demo');
  });

  it('is on-device when no backend is reachable', () => {
    expect(tierIn(ON_DEVICE)).toBe('on-device');
  });

  it('is local-backend for a development server on a private host', () => {
    expect(tierIn(LOCAL_BACKEND)).toBe('local-backend');
  });

  it('is cloud only for a real https platform URL', () => {
    expect(tierIn(CLOUD)).toBe('cloud');
  });
});

describe('the claims a build is allowed to make', () => {
  const nonCloud = [
    ['demo', DEMO],
    ['on-device', ON_DEVICE],
    ['local-backend', LOCAL_BACKEND],
  ] as const;

  it.each(nonCloud)('%s never names an AWS region', (_tier, env) => {
    const copy = describeIn(env);
    const everything = [
      copy.shortLabel,
      copy.storage,
      copy.processing,
      copy.disclaimerBody,
    ].join(' ');

    expect(everything).not.toMatch(/ap-south-1/i);
    expect(everything).not.toMatch(/Mumbai/i);
    expect(everything).not.toMatch(/AWS/i);
  });

  it.each(nonCloud)('%s never claims documents are stored encrypted on a server', (_tier, env) => {
    const copy = describeIn(env);
    const everything = [copy.storage, copy.processing, copy.disclaimerBody].join(' ');

    expect(everything).not.toMatch(/encrypted (and )?stored/i);
    expect(everything).not.toMatch(/KMS/i);
  });

  it.each(nonCloud)('%s admits it is a prototype', (_tier, env) => {
    expect(describeIn(env).isPrototype).toBe(true);
  });

  it('on-device says plainly that nothing is uploaded', () => {
    const copy = describeIn(ON_DEVICE);
    expect(copy.storage).toMatch(/not uploaded|no server|stay on this phone/i);
    expect(copy.disclaimerBody).toMatch(/not uploaded anywhere/i);
  });

  it('local-backend admits pages leave the phone, and says they are deleted', () => {
    const copy = describeIn(LOCAL_BACKEND);
    expect(copy.storage).toMatch(/development/i);
    expect(copy.storage).toMatch(/delete/i);
  });

  it('cloud is the only tier that may describe the region, and is not a prototype', () => {
    const copy = describeIn(CLOUD);
    expect(copy.shortLabel).toMatch(/ap-south-1/);
    expect(copy.storage).toMatch(/ap-south-1/);
    expect(copy.isPrototype).toBe(false);
  });

  it('follows the configured region rather than hard-coding one', () => {
    const copy = describeIn({ ...CLOUD, EXPO_PUBLIC_AWS_REGION: 'eu-west-1' });
    expect(copy.shortLabel).toContain('eu-west-1');
    expect(copy.storage).toContain('eu-west-1');
    expect(copy.storage).not.toContain('ap-south-1');
  });

  it('every tier holding real records promises they are never sold', () => {
    // The demo tier is excluded on purpose: its records are invented, so the
    // promise would be vacuous there. It makes a different and more useful
    // statement instead — see below.
    for (const env of [ON_DEVICE, LOCAL_BACKEND, CLOUD]) {
      expect(describeIn(env).disclaimerBody).toMatch(/never sold/i);
    }
  });

  it('demo says the records are fictional, in every place storage is described', () => {
    const copy = describeIn(DEMO);

    expect(copy.shortLabel).toMatch(/fictional|demonstration/i);
    expect(copy.storage).toMatch(/none of it belongs to a real person/i);
    expect(copy.disclaimerBody).toMatch(/fictional/i);
  });

  it('demo promises that anything the audience adds stays on the device', () => {
    // Somebody will photograph a real prescription during a demonstration.
    // `isBackendEnabled` makes that safe; this makes it visible.
    const copy = describeIn(DEMO);
    expect(copy.disclaimerBody).toMatch(/stays on this device/i);
    expect(copy.processing).toMatch(/send nothing anywhere/i);
  });
});
