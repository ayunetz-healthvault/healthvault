/**
 * Client-side identifiers.
 *
 * Records are created optimistically on-device (the app must work on a patchy
 * connection from an Indian mobile network), so IDs are minted here and reused
 * verbatim as the DynamoDB sort key. The prefix makes items self-describing in
 * the table and in logs.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const randomChunk = (length: number): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
};

export type IdPrefix = 'par' | 'doc' | 'pag' | 'sum' | 'fup' | 'job' | 'usr' | 'fnd' | 'med';

/**
 * Monotonic-ish, sortable, collision-resistant enough for a single device.
 *
 * TODO(backend): the Lambda write path should reject any client ID that does
 * not match /^[a-z]{3}_[0-9a-z]{8}_[0-9a-z]{6}$/ before persisting it.
 */
export const createId = (prefix: IdPrefix): string =>
  `${prefix}_${Date.now().toString(36).padStart(8, '0')}_${randomChunk(6)}`;
