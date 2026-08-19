import { loadStackConfig } from '../src/config/stack.js';
import { describeStack } from '../src/config/stack.js';
import { initialiseLocalStack } from '../src/services/localStack/initialise.js';

/**
 * Run by `npm run stack:up` once the containers report healthy.
 *
 * Separate from the compose file because creating a bucket and a table is an
 * application concern: the names come from the same configuration the service
 * reads, so they cannot drift from what the code expects.
 */
const config = loadStackConfig();

await initialiseLocalStack(config);

// eslint-disable-next-line no-console
console.log('Local stack ready:', JSON.stringify(describeStack(config)));
