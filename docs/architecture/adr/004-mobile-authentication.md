# ADR-004 — Mobile Authentication Against Cognito

- **Status:** Accepted for KOO-02. The live flow is unverified — see "Consequences".
- **Date:** 2026-09-08
- **Owners:** Ayunetz Health Vault
- **Decision type:** Security and client architecture
- **Supersedes:** the `TODO(backend)` markers in `src/services/auth/authService.ts`

## Context

`authService` shipped as a placeholder with the right shape: mock sessions in
every mode, and `throw new AuthError('not_configured', ...)` on the branches
that would have called Cognito. The backend already verifies real tokens
(`TokenVerifier`, ADR-003's identity port), so the missing half is entirely on
the client.

KOO-02 requires configured sign-up, email verification, sign-in and recovery;
token expiry, refresh and server-side revocation; and — stated explicitly —
that a live build never falls back to a demo user when authentication is
unavailable.

There is no user pool. Nothing here has been run against Cognito.

## Decision

### 1. The Cognito JSON API directly, not an SDK

`src/services/auth/cognitoClient.ts` calls
`AWSCognitoIdentityProviderService` over HTTPS with `fetch`, matching
`api/client.ts`, which is dependency-free for the same reason.

Eight operations are used: `SignUp`, `ConfirmSignUp`,
`ResendConfirmationCode`, `InitiateAuth` (two flows), `ForgotPassword`,
`ConfirmForgotPassword`, `GlobalSignOut`. Wrapping them is less code than
configuring an SDK, and it keeps an AWS SDK out of a mobile bundle to do what
`fetch` already does.

### 2. `USER_PASSWORD_AUTH`, with SRP recorded as the target

The password goes to Cognito over TLS.

`USER_SRP_AUTH` is better — it proves knowledge of the password without
transmitting it, so a compromised endpoint learns nothing. It is not used here
because implementing SRP means hand-writing modular exponentiation over a
3072-bit group plus Cognito's own key derivation, and **hand-written crypto in
an application holding medical records is a worse risk than a password crossing
a verified TLS connection to its own identity provider**.

The correct way to get SRP is `amazon-cognito-identity-js`, which implements it
properly and is maintained by AWS. That dependency should be added when there
is a pool to test it against. Adding it now would mean shipping an auth path
nobody has ever executed, which is the failure mode this whole handoff is
written against.

The user pool must therefore enable `ALLOW_USER_PASSWORD_AUTH` on the app
client. That is a concrete requirement on KOO-14's infrastructure work.

### 3. A public app client, enforced at runtime

The app client is created **without** a secret. A secret in a mobile bundle is
not a secret: it ships to every device and can be read out of the APK.

`assertNoClientSecret()` throws if `EXPO_PUBLIC_COGNITO_APP_CLIENT_SECRET` is
set, on every operation. Without it, a misconfigured build would fail with an
unexplained `NotAuthorizedException` on every sign-in — the symptom points
nowhere near the cause.

### 4. Expiry is recorded, not read from the token

`ExpiresIn` from the provider's response is stored beside the token as an
absolute time. The ID token's own `exp` claim is *not* read for this.

An unverified claim is not a fact. The client cannot check the signature — the
backend does that, on every request — so anything the client decides from a
claim must be something that does not matter if the claim is a lie. When to
refresh is such a decision; who you are is not.

The same rule governs `claimsOf`, which reads `sub`, `email`, `name` and
`locale` to decide **what name to greet somebody with, and nothing else**.
Authorisation is the backend's, from a verified token.

### 5. Refresh ahead of expiry, and once more on a 401

Two mechanisms, deliberately:

- The token provider refreshes when the token is within five minutes of
  expiring, so a slow multi-page upload does not fail halfway.
- `apiRequest` retries **once** on a 401 after forcing a refresh, for the cases
  a clock cannot predict: a revoked session, a shortened pool lifetime, a device
  whose clock is wrong.

A 403 is never retried — that is a grant decision, and a fresher token gets the
same answer. Concurrent refreshes collapse into one in-flight promise, or the
losers overwrite the stored tokens with a stale result.

### 6. Offline is not signed out

A refresh that fails because the network is down keeps the credentials and
throws. A refresh rejected by Cognito clears them and returns null.

Getting this backwards signs a user out of their own records every time they
open the app on a train.

### 7. Sign-out revokes on the server

`GlobalSignOut` first, then clear locally, and the local clear runs even when
the call fails. Forgetting a refresh token is not revoking it: it stays valid
for the pool's lifetime, and anyone who extracted it keeps a working session.

### 8. A live build with no pool fails, loudly

`assertLiveConfigured()` throws `not_configured`. It is one function called by
every live entry point rather than a condition repeated at each one.

This is the single most important line in the change. A caregiver silently
signed in as the demonstration fixture would be looking at invented medical
records believing they were their parent's.

## Consequences

**Unverified.** No call in `cognitoClient.ts` has reached Cognito. The tests
drive a faked `fetch`, which proves the request shapes, the error mapping, the
refresh and revocation logic and the no-fallback rule — and proves nothing about
whether Cognito accepts these requests. A synthetic-account test against a real
pool is a separate gate, and it stays open.

**Requirements this places on KOO-14:** a Mumbai user pool; an app client with
no secret and `ALLOW_USER_PASSWORD_AUTH`; email as the sign-in alias with
verification; `name` and `locale` as writable attributes; a refresh-token
lifetime chosen deliberately, since it bounds how long a stolen token works.

**Challenges are not implemented.** An MFA or force-change-password response
raises `challenge_required` rather than being treated as a session. If the pool
is configured to require either, sign-in will fail cleanly — visibly, not
silently.

**When SRP arrives**, only `cognitoClient.ts` changes. `authService` and every
screen speak in sessions and typed errors, not in auth flows.
