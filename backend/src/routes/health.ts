import type { FastifyPluginAsync } from 'fastify';

/** Bumped with the service, not with the pipeline. */
export const SERVICE_NAME = 'ayunetz-document-processing';
export const SERVICE_VERSION = '0.1.0';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
}

/**
 * Liveness only.
 *
 * The shape is fixed on purpose. It must not report which providers are
 * configured, whether a model key is present, dependency versions or
 * environment values — an unauthenticated endpoint that answers "is the AI key
 * set?" is a reconnaissance tool. See phase-1.md § "GET /health".
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
  }));
};
