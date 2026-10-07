# ADR-0036 — Card clock credentials and reception access

Status: Accepted for PR 23 under the review/fix request, 2026-10-05.

## Context

SPEC §7 calls the card capability `clock:attendance:device`, but ADR-0003's catalog grammar permits only platform/company/business/branch/own. PR 19 QR display authorizes explicit Device principals with `@Authenticated`; pairing uses `manage:devices:branch`. There is no stored `:device` permission precedent. ADR-0019 requires an isolated staff session on the paired device for the real operator. The draft's human clock defaults and staff-login defaults have no overlap.

A card is a bearer credential. Storing its raw code enables clocking after a database disclosure. QR secrets rotate daily and cannot identify long-lived cards.

## Decision

Use `clock:attendance:branch` at the verified device branch, with explicit Device token, origin and isolated operator session checks. Keep the permissions CHECK unchanged. Reload login and clock grants under company/membership locks; recheck the active device and employee/card before committing. Staff reads identity only through its public index and the declared read ports.

Under the user's request to make the reception default bundle work, promote Cashier's existing optional staff-login cell to a default. Cashier already holds the card clock permission. No Owner, manager or supervisor gains staff login implicitly. Existing permission overrides and custom roles are preserved. Migration 0086 adds the catalog code and system defaults; seed repeats them.

Derive a 32-byte card subkey with HKDF-SHA256 inside `packages/auth`, using salt `pospay:employee-card:hkdf-salt:v1` and info `pospay:employee-card:key:v1`. The composition root calls the narrow `deriveEmployeeCardKey` export; staff receives only its Buffer and never the auth root secret. The PIN counter derivation stays inside auth. HMAC payload labels separate card lookup (`pospay:employee-card:lookup:v1`), issue, revoke and clock idempotency (`pospay:employee-card:<operation>-idempotency:v1`), and the issue-attempt marker (`pospay:employee-card:issue-attempt:v1`), all bound to company. Persist only the digest and a four-character suffix for normalized codes of at least eight characters; shorter codes have an empty suffix. The allowed 4–64 code-length range is unchanged. Active-card uniqueness uses the company-bound lookup hash. No full code in responses, logs, audit, outbox, local storage or offline queues.

Card inputs use text fields with CSS masking and autocomplete, capitalization and spellchecking disabled. A 401 displays a distinct signed-out message, refetches the operator session and retries device status; no card screen is offered without an operator session.

The EmployeeCardAccess interface and token belong to staff ports. The controller reads access inside the tenant transaction and passes the decision values to the query, which imports no port. Controllers reach the token through the existing use-case export pattern. The layer matrix and boundary rules remain unchanged.

## Consequences

Only this slice's 0085/0086 are regenerated; main migrations remain immutable. Rotating BETTER_AUTH_SECRET invalidates card lookup digests and requires reissuing cards. A dedicated key with versioned rotation is a future improvement, not a new configuration/dependency in this slice.

The fixed device continues to record NONE for location until CB-Q1 is settled. Reception Cashier works by default; other human roles still need a separate reception membership or an explicit custom role. Card issue/revoke remains employee-management authority, separate from clocking.

## Amendment — issue-attempt limit (Waleed, 2026-10-07)

The company-wide active-code check answers 409 `EMPLOYEE_CARD_CODE_IN_USE` when another employee already holds the code. A manager who can issue cards in one business can submit guesses and learn which codes are live in a business they cannot see. Those codes are clock-in credentials in PR 23b. The uniqueness rule stays company-wide.

Card issue attempts are limited to 30 per hour per company and user (`CARD_ISSUE_ATTEMPTS_PER_HOUR`). Every attempt that reaches the use case counts: success and 409. A validation failure in the use case counts; a request rejected by the contract schema before the use case does not reach the database, cannot reveal a live code, and is not counted. A replay of an already-completed idempotency key with the same request fingerprint does not count. The same key with a different body is another guess and counts. The completion marker stored in Redis is the `issue-attempt` HMAC, not an unkeyed digest of the idempotency key and request fingerprint, so a reader of Redis and `idempotency_keys` cannot brute-force a short code. Past the limit the route returns 429 `TOO_MANY_REQUESTS` with the standard envelope and `Retry-After` set to the seconds left on `rate:card-issue:<company>:<user>`. Routes that do not set that header still receive the filter's 60-second default. The limited response does no card, audit, or idempotency write, and logs the attempt without the card code. If Redis is unavailable before a card is stored, issue fails closed with `NOT_READY` (503). The adapter logs the Redis error without secrets or the card code. Revoke is not limited and still works without Redis. If recording the completed key fails after the card is stored, the route still returns the card and logs a warning without the card code. The card remains. A retry of that same key replays the stored body; until the marker is stored, that retry counts as another attempt. Clock-by-card scan limits (D6) remain for PR 23b.
