/**
 * Authentication failures, as things a user can act on.
 *
 * Separate from `ApiError` because the responses differ: an API error usually
 * means retry, while these mostly mean do something specific — confirm your
 * email, ask for a new code, use a different password.
 */
export type AuthErrorCode =
  | 'invalid_input'
  | 'invalid_credentials'
  | 'invalid_code'
  | 'not_confirmed'
  | 'already_registered'
  | 'reset_required'
  | 'challenge_required'
  | 'rate_limited'
  | 'unavailable'
  /** The build says live but has no user pool. Never falls back to demo. */
  | 'not_configured'
  /** A configuration that is unsafe to run, such as a bundled client secret. */
  | 'misconfigured'
  | 'unknown';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }

  /** True when trying the same thing again could plausibly work. */
  get retryable(): boolean {
    return this.code === 'unavailable' || this.code === 'rate_limited';
  }
}
