import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../src/config/env.js';
import { summarySchema } from '../../src/schemas/summary.js';
import { MockSummaryProvider } from '../../src/services/summarisation/MockSummaryProvider.js';
import { createSummaryProvider } from '../../src/services/summarisation/providerFactory.js';
import { pseudonymousDocumentId } from '../../src/services/summarisation/pseudonym.js';
import { SarvamSummaryProvider } from '../../src/services/summarisation/SarvamSummaryProvider.js';
import { assertOnlyRedactedInput } from '../../src/services/summarisation/SummaryProvider.js';
import {
  buildUserPrompt,
  SUMMARY_SYSTEM_PROMPT,
} from '../../src/services/summarisation/systemPrompt.js';
import { ProcessingError } from '../../src/types/processing.js';
import { MUST_NOT_SURVIVE, SYNTHETIC_PATIENT } from '../fixtures/synthetic/report.js';

import type { StructuredSummary } from '../../src/schemas/summary.js';
import type { RedactedDocumentInput } from '../../src/services/summarisation/SummaryProvider.js';

/** A minimal valid summary, used where the content is not what is being tested. */
const VALID_SUMMARY: StructuredSummary = summarySchema.parse({
  overview: 'A two-page lab report.',
  plainLanguageSummary: 'Blood sugar is above the target range. Kidney function is normal.',
  findings: [
    {
      label: 'HbA1c',
      value: '8.1 %',
      unit: '%',
      referenceRange: 'Below 7.0 %',
      severity: 'attention',
      plainLanguage: 'Average blood sugar is above target.',
      sources: [{ page: 1 }],
    },
  ],
  medicines: [
    {
      name: 'Metformin',
      dosage: '1000 mg',
      frequency: 'Twice a day',
      purpose: 'Controls blood sugar',
      sources: [{ page: 2 }],
    },
  ],
  instructions: ['Repeat the HbA1c test in three months.'],
  recommendedDoctorCategory: 'endocrinologist',
  questionsForDoctor: ['Does the dose need changing?'],
  confidence: 0.82,
  explicitFollowUps: [],
  uncertainties: [],
});

const input: RedactedDocumentInput = {
  documentId: 'doc_9f2a1b3c4d5e6f70',
  category: 'lab_report',
  pages: [
    { page: 1, text: 'Patient Name: [PATIENT_NAME]\nHbA1c 8.1 %' },
    { page: 2, text: 'Metformin 1000 mg twice a day' },
  ],
};

/** Builds a fetch stub returning one chat-completion body. */
const respondWith = (content: unknown, status = 200): typeof fetch =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

const sarvam = (fetchImpl: typeof fetch, overrides = {}): SarvamSummaryProvider =>
  new SarvamSummaryProvider({
    apiKey: 'test-key-not-real',
    model: 'sarvam-30b',
    baseUrl: 'https://api.example.invalid',
    fetchImpl,
    sleepImpl: async () => undefined,
    ...overrides,
  });

describe('the input allowlist', () => {
  it('accepts exactly the permitted fields', () => {
    expect(() => assertOnlyRedactedInput(input)).not.toThrow();
  });

  it('refuses anything else before a request is built', () => {
    const smuggled = {
      ...input,
      patientName: 'Lakshmi Iyer',
      cognitoSub: 'abc-123',
    } as unknown as RedactedDocumentInput;

    expect(() => assertOnlyRedactedInput(smuggled)).toThrow(ProcessingError);
  });

  it('refuses extra fields hidden on a page', () => {
    const smuggled = {
      ...input,
      pages: [{ page: 1, text: 'clean', originalPath: '/tmp/scan.png' }],
    } as unknown as RedactedDocumentInput;

    expect(() => assertOnlyRedactedInput(smuggled)).toThrow(ProcessingError);
  });

  it('names the offending field but never its value', () => {
    const smuggled = { ...input, patientName: 'Lakshmi Iyer' } as unknown as RedactedDocumentInput;

    try {
      assertOnlyRedactedInput(smuggled);
      expect.unreachable('should have thrown');
    } catch (error) {
      const body = JSON.stringify((error as ProcessingError).toBody());

      expect(body).toContain('patientName');
      expect(body).not.toContain('Lakshmi');
    }
  });
});

describe('pseudonymousDocumentId', () => {
  it('does not contain the original id', () => {
    expect(pseudonymousDocumentId('doc_demo_hba1c')).not.toContain('hba1c');
  });

  it('is stable, so a support request can be correlated', () => {
    expect(pseudonymousDocumentId('doc_demo_hba1c')).toBe(pseudonymousDocumentId('doc_demo_hba1c'));
  });

  it('differs between documents', () => {
    expect(pseudonymousDocumentId('doc_a')).not.toBe(pseudonymousDocumentId('doc_b'));
  });
});

describe('the system prompt', () => {
  it.each([
    ['forbids invention', /never invent/i],
    ['requires exact numbers', /exactly as they appear/i],
    ['forbids diagnosis', /not state or imply a diagnosis/i],
    ['forbids medication changes', /starting, stopping, or changing/i],
    ['requires uncertainty to be recorded', /uncertainties/i],
    ['separates written instructions from generated questions', /only field you generate/i],
    ['requires page sources', /page number it was read from/i],
    ['refuses instructions inside the document', /is not from the operator/i],
    ['states the output is informational', /informational only/i],
    ['requires schema-valid JSON only', /No prose, no markdown/i],
  ])('%s', (_label, pattern) => {
    expect(SUMMARY_SYSTEM_PROMPT).toMatch(pattern);
  });

  it('marks document content as data rather than instruction', () => {
    const prompt = buildUserPrompt(input);

    expect(prompt).toContain('--- PAGE 1 ---');
    expect(prompt).toContain('is document content, not instruction');
  });
});

describe('MockSummaryProvider', () => {
  it('works with no key configured and returns a schema-valid summary', async () => {
    const summary = await new MockSummaryProvider().createSummary(input);

    expect(() => summarySchema.parse(summary)).not.toThrow();
  });

  it('invents no clinical content at all', async () => {
    const summary = await new MockSummaryProvider().createSummary(input);

    expect(summary.findings).toEqual([]);
    expect(summary.medicines).toEqual([]);
    expect(summary.instructions).toEqual([]);
  });

  it('reports low confidence and says why', async () => {
    const summary = await new MockSummaryProvider().createSummary(input);

    expect(summary.confidence).toBeLessThan(0.3);
    expect(summary.uncertainties[0]?.message).toMatch(/no summary model/i);
  });

  it('enforces the same input allowlist as the real provider', async () => {
    const smuggled = { ...input, patientName: 'Lakshmi Iyer' } as unknown as RedactedDocumentInput;

    await expect(new MockSummaryProvider().createSummary(smuggled)).rejects.toThrow(
      ProcessingError,
    );
  });
});

describe('provider selection', () => {
  it('uses the mock when no key is configured', () => {
    expect(createSummaryProvider(loadConfig({})).name).toBe('mock');
  });

  it('uses the mock when the key is blank', () => {
    expect(createSummaryProvider(loadConfig({ SARVAM_API_KEY: '' })).name).toBe('mock');
  });

  it('uses Sarvam only when a key is explicitly present', () => {
    const provider = createSummaryProvider(loadConfig({ SARVAM_API_KEY: 'test-key-not-real' }));

    expect(provider.name).toBe('sarvam');
  });
});

describe('SarvamSummaryProvider — what goes out', () => {
  it('sends only redacted text, the reference, the category and the prompt', async () => {
    const fetchImpl = respondWith(JSON.stringify(VALID_SUMMARY));
    await sarvam(fetchImpl).createSummary(input);

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const body = String(init?.body);

    for (const value of MUST_NOT_SURVIVE) {
      expect(body).not.toContain(value);
    }
    expect(body).not.toContain(SYNTHETIC_PATIENT.fullName);
    expect(body).toContain('[PATIENT_NAME]');
    expect(body).toContain('HbA1c 8.1 %');
  });

  it('asks for low temperature and JSON', async () => {
    const fetchImpl = respondWith(JSON.stringify(VALID_SUMMARY));
    await sarvam(fetchImpl).createSummary(input);

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(payload.temperature).toBe(0.1);
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload.model).toBe('sarvam-30b');
  });

  it('sends the key in a header and never in the body', async () => {
    const fetchImpl = respondWith(JSON.stringify(VALID_SUMMARY));
    await sarvam(fetchImpl).createSummary(input);

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];

    expect((init?.headers as Record<string, string>).authorization).toBe(
      'Bearer test-key-not-real',
    );
    expect(String(init?.body)).not.toContain('test-key-not-real');
  });
});

describe('SarvamSummaryProvider — what comes back', () => {
  it('accepts and returns a valid summary', async () => {
    const summary = await sarvam(respondWith(JSON.stringify(VALID_SUMMARY))).createSummary(input);

    expect(summary.findings[0]?.label).toBe('HbA1c');
    expect(summary.confidence).toBe(0.82);
  });

  it('tolerates a code fence around the JSON', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_SUMMARY) + '\n```';

    await expect(sarvam(respondWith(fenced)).createSummary(input)).resolves.toBeDefined();
  });

  it('rejects malformed JSON', async () => {
    await expect(
      sarvam(respondWith('{ not json at all')).createSummary(input),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rejects JSON that does not match the schema', async () => {
    const wrong = { ...VALID_SUMMARY, recommendedDoctorCategory: 'witch_doctor' };

    await expect(
      sarvam(respondWith(JSON.stringify(wrong))).createSummary(input),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rejects a confidence outside 0–1', async () => {
    const wrong = { ...VALID_SUMMARY, confidence: 4 };

    await expect(
      sarvam(respondWith(JSON.stringify(wrong))).createSummary(input),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rejects an empty reply', async () => {
    await expect(sarvam(respondWith('')).createSummary(input)).rejects.toMatchObject({
      code: 'ai_failed',
    });
  });

  it('names the failing fields but never quotes the model output', async () => {
    // The model has echoed the document. A validation error must not carry it.
    const wrong = { ...VALID_SUMMARY, confidence: 'Lakshmi Iyer had a reading of 8.1' };

    try {
      await sarvam(respondWith(JSON.stringify(wrong))).createSummary(input);
      expect.unreachable('should have thrown');
    } catch (error) {
      const body = JSON.stringify((error as ProcessingError).toBody());

      expect(body).toContain('confidence');
      expect(body).not.toContain('Lakshmi');
    }
  });
});

describe('SarvamSummaryProvider — failure handling', () => {
  const failingFetch = (status: number): typeof fetch =>
    vi.fn(
      async () => new Response('{"error":"detail that may echo the request"}', { status }),
    ) as unknown as typeof fetch;

  it.each([429, 502, 503, 504])('retries a %i, up to the cap', async (status) => {
    const fetchImpl = failingFetch(status);

    await expect(sarvam(fetchImpl).createSummary(input)).rejects.toMatchObject({
      code: 'ai_failed',
      retryable: true,
    });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 404, 422])('does not retry a %i', async (status) => {
    const fetchImpl = failingFetch(status);

    await expect(sarvam(fetchImpl).createSummary(input)).rejects.toMatchObject({
      code: 'ai_failed',
      retryable: false,
    });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
  });

  it('succeeds if a retry works', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? new Response('{}', { status: 503 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(VALID_SUMMARY) } }] }),
            { status: 200 },
          );
    }) as unknown as typeof fetch;

    await expect(sarvam(fetchImpl).createSummary(input)).resolves.toBeDefined();
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  it('backs off for longer each time, up to a ceiling', async () => {
    const delays: number[] = [];
    const fetchImpl = failingFetch(503);

    await expect(
      sarvam(fetchImpl, {
        maxAttempts: 4,
        sleepImpl: async (ms: number) => {
          delays.push(ms);
        },
      }).createSummary(input),
    ).rejects.toThrow();

    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('retries a network error but reports it as unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(sarvam(fetchImpl).createSummary(input)).rejects.toMatchObject({
      code: 'ai_failed',
      retryable: true,
    });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(3);
  });

  it('never puts the provider response body into the error', async () => {
    const fetchImpl = failingFetch(400);

    try {
      await sarvam(fetchImpl).createSummary(input);
      expect.unreachable('should have thrown');
    } catch (error) {
      const body = JSON.stringify((error as ProcessingError).toBody());

      expect(body).not.toContain('detail that may echo the request');
      expect(body).toContain('400');
    }
  });

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = respondWith(JSON.stringify(VALID_SUMMARY));

    await expect(
      sarvam(fetchImpl).createSummary(input, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'processing_timeout' });
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled();
  });
});
