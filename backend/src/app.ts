import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadConfig, type AppConfig } from './config/env.js';
import { loadIdentityConfig, type IdentityConfig } from './config/identity.js';
import { loadStackConfig, type StackConfig } from './config/stack.js';
import { authentication } from './routes/authentication.js';
import { healthRoutes } from './routes/health.js';
import { localIdentityRoutes } from './routes/localIdentity.js';
import { processDocumentRoutes } from './routes/processDocument.js';
import { createLocalIssuer, inProcessKeys } from './services/identity/localIssuer.js';
import { createTokenVerifier, type TokenVerifier } from './services/identity/TokenVerifier.js';
import { TesseractOcrProvider } from './services/ocr/TesseractOcrProvider.js';
import { DocumentProcessingOrchestrator } from './services/processing/DocumentProcessingOrchestrator.js';
import { createSummaryProvider } from './services/summarisation/providerFactory.js';
import { ProcessingError, type DocumentProcessor } from './types/processing.js';

export interface BuildAppOptions {
  config?: AppConfig;
  stack?: StackConfig;
  identity?: IdentityConfig;
  /** Injected so routes can be tested without fetching a JWKS over the wire. */
  verifier?: TokenVerifier;
  /** Injected so routes can be tested without an OCR engine or AI provider. */
  processor?: DocumentProcessor;
  /**
   * Capture log output. Exists so the "logs contain no document content" rule
   * can be asserted by a test rather than trusted; there is no other way to
   * observe what this service writes.
   */
  logStream?: NodeJS.WritableStream;
}

/**
 * Builds the Fastify instance without listening, so tests can drive it through
 * `app.inject()` and never bind a port.
 *
 * ## Logging policy
 * Request logging is deliberately narrowed. Fastify's default serialisers log
 * the full URL and headers; here a URL can carry a document id and headers can
 * carry credentials. Bodies are never logged at any level — a body here is a
 * page of somebody's medical record. See docs/architecture/README.md
 * § "non-negotiable architecture principles" 13–14.
 */
export const buildApp = (options: BuildAppOptions = {}): FastifyInstance => {
  const config = options.config ?? loadConfig();
  const stack = options.stack ?? loadStackConfig();
  const identity = options.identity ?? loadIdentityConfig(stack.name, stack.region);
  const processor =
    options.processor ??
    new DocumentProcessingOrchestrator({
      ocrProvider: new TesseractOcrProvider(),
      // Mock unless a key is explicitly configured — see providerFactory.
      summaryProvider: createSummaryProvider(config),
      maxPages: config.MAX_DOCUMENT_PAGES,
    });

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Technical metadata only. No headers, no query string, no body.
      serializers: {
        req: (request) => ({
          method: request.method,
          // Path without the query string, which can carry identifiers.
          route: request.url.split('?')[0],
        }),
        res: (reply) => ({ statusCode: reply.statusCode }),
      },
      ...(options.logStream === undefined ? {} : { stream: options.logStream }),
    },
    bodyLimit: config.MAX_PAGE_BYTES,
  });

  app.decorate('config', config);
  app.decorate('stack', stack);

  app.register(multipart, {
    limits: {
      fileSize: config.MAX_PAGE_BYTES,
      // One above the real limit, so the route reports "too many pages" itself
      // rather than surfacing the library's error.
      files: config.MAX_DOCUMENT_PAGES + 1,
      fieldSize: 4096,
      fields: 40,
    },
  });

  /**
   * The development identity provider, and only on the local stack.
   *
   * `createLocalIssuer` refuses on `aws` and so does `localIdentityRoutes`, so
   * this condition is the outermost of three guards rather than the only one.
   */
  let localKeys: ReturnType<typeof inProcessKeys> | undefined;

  if (stack.name === 'local') {
    const issuer = createLocalIssuer(identity, stack.name);
    app.register(localIdentityRoutes, { issuer, stack: stack.name });
    localKeys = inProcessKeys(issuer);
  }

  app.register(authentication, {
    verifier: options.verifier ?? createTokenVerifier(identity, localKeys),
  });

  app.register(healthRoutes);
  app.register(processDocumentRoutes, { processor });

  /**
   * Single exit point for errors.
   *
   * Only a `ProcessingError`'s own message reaches the client. Everything else
   * becomes a fixed sentence: a stray error from a file system call, an image
   * library or an HTTP client can quote a path, a filename or a fragment of the
   * document it was reading, and none of that may leave this process.
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ProcessingError) {
      request.log.warn({ code: error.code, statusCode: error.statusCode }, 'request refused');
      return reply.code(error.statusCode).send(error.toBody());
    }

    // Logged by class only. Not the message — see above.
    request.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'unhandled error',
    );

    return reply.code(500).send({
      code: 'unknown',
      message: 'The document could not be processed.',
      retryable: false,
    });
  });

  return app;
};

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    stack: StackConfig;
  }
}
