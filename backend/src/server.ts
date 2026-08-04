import { buildApp } from './app.js';
import { describeConfig, loadConfig } from './config/env.js';

/**
 * Process entry point.
 *
 * Kept separate from `app.ts` so tests never bind a port and never install
 * signal handlers.
 */
const start = async (): Promise<void> => {
  const config = loadConfig();
  const app = buildApp({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Binds on all interfaces so a Codespaces port forward can reach it. This is
  // a development service for synthetic data — see backend/README.md.
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(describeConfig(config), 'ayunetz-document-processing started');
};

start().catch((error: unknown) => {
  // Startup failures print the message only. A stack here can name paths, and a
  // config error must not echo the offending value.
  const message = error instanceof Error ? error.message : 'unknown startup error';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
