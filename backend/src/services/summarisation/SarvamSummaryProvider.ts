import {
  summarySchema,
  SUMMARY_JSON_SCHEMA,
  type StructuredSummary,
} from '../../schemas/summary.js';
import { ProcessingError } from '../../types/processing.js';

import { buildUserPrompt, SUMMARY_SYSTEM_PROMPT } from './systemPrompt.js';
import { assertOnlyRedactedInput } from './SummaryProvider.js';

import type {
  CreateSummaryOptions,
  RedactedDocumentInput,
  SummaryProvider,
} from './SummaryProvider.js';

/**
 * Sarvam AI summary provider.
 *
 * ## What leaves this process
 *
 * Redacted page text, a pseudonymous document reference, the category, a
 * language hint, the system prompt and the JSON schema. Nothing else — the
 * input type makes anything else unreachable, and `assertOnlyRedactedInput`
 * re-checks it immediately before the request is built.
 *
 * ## What is never logged
 *
 * The request body, the response body, the prompt, the API key, and any header.
 * Failures are recorded by status code and attempt count only. This is the one
 * component that holds both a credential and the document text at the same
 * time, so it logs almost nothing.
 *
 * ## Retries
 *
 * Only transient failures are retried: 429, 502, 503, 504 and network errors.
 * An authentication or validation failure is retried zero times — repeating a
 * request that was rejected for being malformed just sends the document again,
 * and repeating one rejected for a bad key does nothing but burn rate limit.
 *
 * ## Unverified against the live API
 *
 * This is written to the OpenAI-compatible chat-completions shape Sarvam
 * documents. It has never been run against the real endpoint — no key exists in
 * this project — so the request shape is an assumption, and the tests drive it
 * through an injected `fetch`. Confirm it against a live call before Phase 1
 * exit. See docs/architecture/progress.md.
 */

/** Statuses worth trying again. Everything else is a permanent answer. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

export interface SarvamSummaryProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injected in tests so the request shape can be asserted without network. */
  fetchImpl?: typeof fetch;
  /** Injected in tests so backoff does not actually wait. */
  sleepImpl?: (ms: number) => Promise<void>;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Models sometimes wrap JSON in a code fence despite being told not to.
 *
 * Stripping it is the one piece of leniency here. Everything past this point is
 * strict: if it is not valid JSON matching the schema, it is rejected.
 */
const stripCodeFence = (content: string): string => {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
};

export class SarvamSummaryProvider implements SummaryProvider {
  readonly name = 'sarvam';

  private readonly options: Required<Omit<SarvamSummaryProviderOptions, 'fetchImpl' | 'sleepImpl'>>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: SarvamSummaryProviderOptions) {
    this.options = {
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  async createSummary(
    input: RedactedDocumentInput,
    options: CreateSummaryOptions = {},
  ): Promise<StructuredSummary> {
    assertOnlyRedactedInput(input);

    const body = JSON.stringify({
      model: this.options.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'system', content: `JSON schema:\n${JSON.stringify(SUMMARY_JSON_SCHEMA)}` },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      // Low, not zero: this is a summarisation task where a little variation is
      // harmless, but nothing here benefits from creativity.
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const content = await this.requestWithRetry(body, options.signal);

    return this.parse(content);
  }

  /** Performs the call, retrying only transient failures. */
  private async requestWithRetry(body: string, signal?: AbortSignal): Promise<string> {
    let lastTransientStatus: number | undefined;

    // Read through a call rather than a property access: the value changes
    // during the awaits below, and a narrowed property would go stale.
    const callerAborted = (): boolean => signal?.aborted === true;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      if (callerAborted()) {
        throw new ProcessingError('processing_timeout', 'Processing was cancelled.');
      }

      const timeout = AbortSignal.timeout(this.options.timeoutMs);
      const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

      let response: Response;

      try {
        response = await this.fetchImpl(`${this.options.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
          },
          body,
          signal: combined,
        });
      } catch (cause) {
        // A caller-initiated abort is not a transient network problem.
        if (callerAborted()) {
          throw new ProcessingError('processing_timeout', 'Processing was cancelled.', { cause });
        }

        if (attempt === this.options.maxAttempts) {
          throw new ProcessingError('ai_failed', 'The summary service could not be reached.', {
            retryable: true,
            details: { attempts: attempt },
            cause,
          });
        }

        await this.backOff(attempt);
        continue;
      }

      if (response.ok) {
        return await this.readContent(response);
      }

      if (!RETRYABLE_STATUSES.has(response.status)) {
        // Permanent. The response body is deliberately not read: on a 400 it
        // echoes the request, which is the document text.
        throw new ProcessingError('ai_failed', 'The summary service rejected the request.', {
          retryable: false,
          details: { status: response.status },
        });
      }

      lastTransientStatus = response.status;

      if (attempt === this.options.maxAttempts) {
        break;
      }

      await this.backOff(attempt);
    }

    throw new ProcessingError('ai_failed', 'The summary service is temporarily unavailable.', {
      retryable: true,
      details: {
        attempts: this.options.maxAttempts,
        ...(lastTransientStatus === undefined ? {} : { status: lastTransientStatus }),
      },
    });
  }

  /** Capped exponential backoff: 500ms, 1s, 2s, … to a ceiling. */
  private async backOff(attempt: number): Promise<void> {
    const delay = Math.min(this.options.baseDelayMs * 2 ** (attempt - 1), MAX_DELAY_MS);
    await this.sleepImpl(delay);
  }

  private async readContent(response: Response): Promise<string> {
    let payload: ChatCompletionResponse;

    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch (cause) {
      throw new ProcessingError('ai_failed', 'The summary service returned an unreadable reply.', {
        retryable: false,
        cause,
      });
    }

    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ProcessingError('ai_failed', 'The summary service returned an empty reply.', {
        retryable: false,
      });
    }

    return content;
  }

  /**
   * Parses and validates.
   *
   * Model output is untrusted input. A `validation_failed` here is not an
   * unexpected condition — it is the schema doing its job, and the orchestrator
   * must not present the document as `ready`.
   */
  private parse(content: string): StructuredSummary {
    let parsed: unknown;

    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch (cause) {
      throw new ProcessingError('validation_failed', 'The summary could not be read.', {
        retryable: false,
        cause,
      });
    }

    const result = summarySchema.safeParse(parsed);

    if (!result.success) {
      // Field paths only. The issues array quotes offending *values*, and those
      // values are the model's rendering of the document.
      throw new ProcessingError('validation_failed', 'The summary did not match the schema.', {
        retryable: false,
        details: {
          fields: [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
            .sort()
            .slice(0, 20),
        },
      });
    }

    return result.data;
  }
}
