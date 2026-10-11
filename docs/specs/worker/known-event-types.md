# Worker known event types — fix specification

Date: 2026-10-08. Owner decision: Waleed.

Spec 044 (2026-10-10, ADR-0040) adds `AttendanceChangeRequested` and
`AttendanceChangeDecided`. Both are known dispatcher types and notification source
events. IN_APP recipients are delivered by the existing notifications consumer;
events without recipients are acknowledged without creating inbox rows.

The dispatcher must recognize every event emitted by the API and worker, even when
its business consumer has not shipped. An unknown event retries and eventually
parks, blocking later events for the same aggregate.

- Extract the existing known-event list from `main.ts` into the outbox folder,
  preserving module-provided event types and conditional notification behavior.
- Recognize `SalaryChanged`, `LeaveRequested`, `LeaveCancelled`, `LeaveApproved`,
  `LeaveRejected`, `LeaveRevoked`, and `EmployeePasskeyBound` without new consumers.
- Keep genuinely unknown events on the existing retry/park path.
- Recover only unpublished rows of the seven types that are parked or have
  attempts >= 10 (the dispatcher's default maximum), including a crashed final
  attempt whose lease is still held and whose parked_at is NULL. Clear parked_at
  and last_error, reset attempts to zero and next_attempt_at to now (the lease is
  stored there). Repeating the statement must leave recovered rows unchanged.
  Prove the dispatcher publishes each recovered head and then its blocked successor;
  unrelated types, published rows and retries below the limit remain unchanged.
- Add a source coverage spec for all production `eventType:` values in API and
  worker, including constants, conditional literals and finite template expansions.
  Every emitted type must be known or covered by a registered consumer. The spec
  must expose all seven omissions before the fix.
- PR 50 must backfill already-published `SalaryChanged` events through
  `commissions.project-inputs`; ADR-0012 approval stays closed until its consumer
  mark exists. Document this obligation and the current module-map consumers.

No schema, API, permissions, business rules, or consumer effects change. Validate
worker typecheck/lint/tests, API typecheck, documentation lint and module-map check.
