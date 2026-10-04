# ADR-0029 — Scoped passkey unbind and advisory installation signals

Date: 2026-10-04. Status: Accepted technical scope and owner policies.

## Context

ADR-0013/0027 separate global auth credentials from tenant binding history. PR 21
must invalidate old operation proofs without deleting credentials across auth/tenant
pools. Web apps cannot prove physical-device identity. PR 22 owns accepted clocks.

## Decision

Lock company, ordered memberships, employee, then active binding, matching enrollment.
Passkey reads/guards share one injected Clock decision instant per check; unbind samples it after all locks and reuses it for branch attachments, membership/permission expiry, feature-override expiry and the unbind timestamp.
Recheck live scope after lock waits; only then enforce self prohibition and binding
id/revision. Current attachments end at their exclusive end date in each branch's
timezone from the injected clock; future-dated detaches and future-starting attachments
both count. Self covers the linked user and the active binding's `bound_by`. Increment revision and stamp unbound fields with audit `passkey.unbind`
and `EmployeePasskeyUnbound` in the same tenant transaction. Retain the global credential
inert: cross-pool deletion can race another company's binding; auth generic plugin
routes remain closed and active-binding exclusions already omit inert credentials.
PR 22 must follow this lock order before attendance-state mutation and recheck active
binding id/revision on the same transaction; UV proof alone cannot authorize a clock.

Use separate read/unbind passkeys branch permissions and an independent employee
selector on the employee page, without granting employee-edit authority to branch
managers. Identity exports only a scoped read/lock access adapter; staff owns the port.
Add these read symbols to the existing staff → identity arrow. Default role migration
touches only the new codes/global system bundles, never historical overrides/custom roles.

PR 22 sends a random UUID v4 `installation_id` from persistent personal-app storage,
kept across personal logout. The server normalizes it and SHA-256 hashes the tuple
`pospay.attendance.installation.v1`, company UUID and installation UUID. Raw IDs never
enter DB/audit/events/logs; no fingerprint/PII/biometric collection or new secret.
Company domain separation prevents cross-tenant correlation. Storage clearing, multiple
browser profiles, copying ids and synced passkeys mean this signal is advisory only.
Do not claim physical-device identity or block clocks based on the signal.

Staff stores immutable observations only for accepted web clock effects in PR 22's
transaction, with unique clock_event_id for retries. `clock_event_id` is the id of the
scan movement's permanent audit row (`clocked_in`/`clocked_out`), which names the attendance
session; no extra FK or migration is added. PR 27 uses a bounded cursor query over pairs visible at both branches;
the query never returns a hash or raw id. Pure domain rule tests use the same inclusive
time window; query callers supply the selected window explicitly.

## Consequences

No auth deletion, startup setting, dependency, new business write arrow or actual
clock endpoint. Separate creating/index migration, forced RLS/grants migration and
reference permissions migration. Old code can run against the additive schema.
The worker recognizes `EmployeePasskeyUnbound` as a known event without a business
consumer under the Phase 1 polling exception; it acknowledges the committed event
instead of repeatedly failing an unknown type. Future realtime delivery reads the
current binding state; this phase promises no consumer or replay-derived projection.

## Owner decisions

- **UNB-Q1 — owner decision 2026-10-04 (recommended option)**: owner,
  general_manager, business_manager within their own business and branch_manager
  within their own branch may read/unbind. Device is forbidden; nobody unbinds their
  own binding. Other system human roles remain forbidden for these codes; custom roles
  keep existing delegation rules.
- **UNB-Q2 — owner decision 2026-10-04 (recommended option)**: inclusive ten-minute
  advisory window; never blocks attendance.
- **UNB-Q3 — owner decision 2026-10-04 (recommended option)**: the manager needs
  authority over every branch the employee is currently attached to, matching employee
  privacy; one-branch employees are manageable by their branch manager.
- **UNB-Q4 — owner decision 2026-10-04 (recommended option)**: device signals are
  retained with attendance history; no cleanup job now.

## Delivered clock wiring

- `installation_id` is a required field of `ClockAttendanceInput` only. It is not part
  of the challenge, the QR/location digest the challenge freezes, or the clock route's
  idempotency fingerprint. It is advisory and does not select or shape the clock command:
  blocked storage can produce a new page-lifetime id after reload, and UUID casing can
  differ. A retry with either variation must replay the accepted response, retaining
  the first accepted observation and its hash. The exclusion is explicit on this route
  alone; all other command fields and routes keep their existing fingerprints.
- The POS personal app creates it once with `crypto.randomUUID()` in `localStorage`
  (`pospay.attendance.installation`), never in IndexedDB or the sync queue. Personal
  logout, operator replacement and private-cache clearing keep it; a malformed stored
  value is replaced; blocked storage yields a page-lifetime id.
- Inside the clock transaction, after the movement's audit/outbox rows, the persistence
  adapter writes exactly one observation per accepted scan: CLOCK_IN, CLOCK_OUT and
  MISSED_OUT plus CLOCK_IN alike. The system MISSED_OUT closure is not a scan and is
  never observed. Branch is the QR branch; time is the single sampled request instant.
- Five-minute dedupe, idempotent replay and every refusal return before persistence and
  write nothing; a rollback removes the observation with the clock.
- Technical log redaction also drops any `installation_id` key.
