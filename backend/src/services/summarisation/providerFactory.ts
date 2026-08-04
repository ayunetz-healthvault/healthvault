import { MockSummaryProvider } from './MockSummaryProvider.js';
import { SarvamSummaryProvider } from './SarvamSummaryProvider.js';

import type { AppConfig } from '../../config/env.js';
import type { SummaryProvider } from './SummaryProvider.js';

/**
 * Chooses the summary provider.
 *
 * Selection happens here, on the backend, and nowhere else. The mobile client
 * has no say in which provider runs and no way to ask for one — a request
 * parameter that could switch on an external model would put the data boundary
 * in the hands of the least trusted party in the system.
 *
 * The default is the mock. Talking to an external provider requires deliberate
 * configuration; it is never what happens by accident.
 */
export const createSummaryProvider = (config: AppConfig): SummaryProvider => {
  if (config.summaryProviderMode === 'mock' || config.SARVAM_API_KEY === undefined) {
    return new MockSummaryProvider();
  }

  return new SarvamSummaryProvider({
    apiKey: config.SARVAM_API_KEY,
    model: config.SARVAM_MODEL,
    baseUrl: config.SARVAM_BASE_URL,
  });
};
