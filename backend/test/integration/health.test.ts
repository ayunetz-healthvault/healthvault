import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';

import type { FastifyInstance } from 'fastify';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        SARVAM_API_KEY: 'test-key-not-real',
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with the documented shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'ayunetz-document-processing',
      version: '0.1.0',
    });
  });

  it('says nothing about secrets, dependencies or the environment', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.body.toLowerCase();

    // The app was built *with* a key configured; the response must not hint at it.
    expect(body).not.toContain('sarvam');
    expect(body).not.toContain('key');
    expect(body).not.toContain('test-key-not-real');
    expect(body).not.toContain('env');
    expect(Object.keys(response.json())).toEqual(['status', 'service', 'version']);
  });

  it('does not answer on an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/dev/does-not-exist' });

    expect(response.statusCode).toBe(404);
  });
});
