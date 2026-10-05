# ADR-0036 — Card clock credentials and reception access

Status: Accepted for PR 23 under the review/fix request, 2026-10-05.

## Context

SPEC §7 calls the card capability `clock:attendance:device`, but ADR-0003's catalog grammar permits only platform/company/business/branch/own. PR 19 QR display authorizes explicit Device principals with `@Authenticated`; pairing uses `manage:devices:branch`. There is no stored `:device` permission precedent. ADR-0019 requires an isolated staff session on the paired device for the real operator. The draft's human clock defaults and staff-login defaults have no overlap.

A card is a bearer credential. Storing its raw code enables clocking after a database disclosure. QR secrets rotate daily and cannot identify long-lived cards.

## Decision

Use `clock:attendance:branch` at the verified device branch, with explicit Device token, origin and isolated operator session checks. Keep the permissions CHECK unchanged. Reload login and clock grants under company/membership locks; recheck the active device and employee/card before committing. Staff reads identity only through its public index and the declared read ports.

Under the user's request to make the reception default bundle work, promote Cashier's existing optional staff-login cell to a default. Cashier already holds the card clock permission. No Owner, manager or supervisor gains staff login implicitly. Existing permission overrides and custom roles are preserved. Migration 0082 adds the catalog code and system defaults; seed repeats them.

Derive a card-only HMAC-SHA256 key from the existing BETTER_AUTH_SECRET using `pospay:employee-card:key:v1`. Bind lookup digests to company and `pospay:employee-card:v1`. Persist only the digest plus up to four display characters, always fewer than the complete code. Hash active-card uniqueness per company. Card-command idempotency fingerprints are keyed as well, with distinct command labels. No full code in API responses, logs, audit, outbox, local storage or offline queues.

## Consequences

Only this slice's 0081/0082 are regenerated; main migrations remain immutable. Rotating BETTER_AUTH_SECRET invalidates card lookup digests and requires reissuing cards. A dedicated key with versioned rotation is a future improvement, not a new configuration/dependency in this slice.

The fixed device continues to record NONE for location until CB-Q1 is settled. Reception Cashier works by default; other human roles still need a separate reception membership or an explicit custom role. Card issue/revoke remains employee-management authority, separate from clocking.
