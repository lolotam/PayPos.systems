# ADR-0036 — Card clock credentials and reception access

Status: Accepted for PR 23 under the review/fix request, 2026-10-05.

## Context

SPEC §7 calls the card capability `clock:attendance:device`, but ADR-0003's catalog grammar permits only platform/company/business/branch/own. PR 19 QR display authorizes explicit Device principals with `@Authenticated`; pairing uses `manage:devices:branch`. There is no stored `:device` permission precedent. ADR-0019 requires an isolated staff session on the paired device for the real operator. The draft's human clock defaults and staff-login defaults have no overlap.

A card is a bearer credential. Storing its raw code enables clocking after a database disclosure. QR secrets rotate daily and cannot identify long-lived cards.

## Decision

Use `clock:attendance:branch` at the verified device branch, with explicit Device token, origin and isolated operator session checks. Keep the permissions CHECK unchanged. Reload login and clock grants under company/membership locks; recheck the active device and employee/card before committing. Staff reads identity only through its public index and the declared read ports.

Under the user's request to make the reception default bundle work, promote Cashier's existing optional staff-login cell to a default. Cashier already holds the card clock permission. No Owner, manager or supervisor gains staff login implicitly. Existing permission overrides and custom roles are preserved. Migration 0086 adds the catalog code and system defaults; seed repeats them.

Derive a 32-byte card subkey with HKDF-SHA256 inside `packages/auth`, using salt `pospay:employee-card:hkdf-salt:v1` and info `pospay:employee-card:key:v1`. The composition root calls the narrow `deriveEmployeeCardKey` export; staff receives only its Buffer and never the auth root secret. The PIN counter derivation stays inside auth. HMAC payload labels separate card lookup (`pospay:employee-card:lookup:v1`), issue, revoke and clock idempotency (`pospay:employee-card:<operation>-idempotency:v1`), all bound to company. Persist only the digest and a four-character suffix for normalized codes of at least eight characters; shorter codes have an empty suffix. The allowed 4–64 code-length range is unchanged. Active-card uniqueness uses the company-bound lookup hash. No full code in responses, logs, audit, outbox, local storage or offline queues.

Card inputs use text fields with CSS masking and autocomplete, capitalization and spellchecking disabled. A 401 displays a distinct signed-out message, refetches the operator session and retries device status; no card screen is offered without an operator session.

The EmployeeCardAccess interface and token belong to staff ports. The controller reads access inside the tenant transaction and passes the decision values to the query, which imports no port. Controllers reach the token through the existing use-case export pattern. The layer matrix and boundary rules remain unchanged.

## Consequences

Only this slice's 0085/0086 are regenerated; main migrations remain immutable. Rotating BETTER_AUTH_SECRET invalidates card lookup digests and requires reissuing cards. A dedicated key with versioned rotation is a future improvement, not a new configuration/dependency in this slice.

The fixed device continues to record NONE for location until CB-Q1 is settled. Reception Cashier works by default; other human roles still need a separate reception membership or an explicit custom role. Card issue/revoke remains employee-management authority, separate from clocking.
