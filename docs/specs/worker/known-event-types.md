# Worker known event types — fix specification

Date: 2026-10-08. Owner decision: Waleed.

The dispatcher must recognize every event emitted by the API and worker, even when
its business consumer has not shipped. An unknown event retries and eventually
parks, blocking later events for the same aggregate.

- Extract the existing known-event list from `main.ts` into the outbox folder,
  preserving module-provided event types and conditional notification behavior.
- Recognize `SalaryChanged`, `LeaveRequested`, `LeaveCancelled`, `LeaveApproved`,
  `LeaveRejected`, `LeaveRevoked`, and `EmployeePasskeyBound` without new consumers.
- Keep genuinely unknown events on the existing retry/park path.
- Add a source coverage spec for all production `eventType:` values in API and
  worker, including constants, conditional literals and finite template expansions.
  Every emitted type must be known or covered by a registered consumer. The spec
  must expose all seven omissions before the fix.
- PR 50 must backfill already-published `SalaryChanged` events through
  `commissions.project-inputs`; ADR-0012 approval stays closed until its consumer
  mark exists. Document this obligation and the current module-map consumers.

No schema, API, permissions, business rules, or consumer effects change. Validate
worker typecheck/lint/tests, API typecheck, documentation lint and module-map check.
