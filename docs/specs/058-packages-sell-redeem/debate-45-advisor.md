# Debate 45 — pospay-advisor stand-in (non-binding)

Astra (`gpt-6-astra`) answered "You've hit your usage limit ... try again at Nov 14th, 2026 11:20 AM" on 2026-11-12, so
the one debate round ran on the `pospay-advisor` stand-in (read-only). Its advice is non-binding (PP-136); the P1s are applied.

| # | Sev | Finding | Verdict |
| --- | --- | --- | --- |
| 1 | P1 | The update guard must not refuse an UPDATE that leaves `expires_on` unchanged (row 46 updates `refunded_amount` and `revision`); act only when it changes | Accepted: plan §3, brief, test |
| 2 | P1 | Duplicate extension rows, or a row inserted after `SET CONSTRAINTS ALL IMMEDIATE`, satisfy the check; add `UNIQUE (company_id, entitlement_id, previous_expires_on)` | Accepted: spec addendum (table row of `package_extensions`), plan §3, tests |
| 3 | P1 | Fail closed when `pospay_system_id()` is NULL or 0 in the update guard and both deferred functions | Accepted |
| 4 | P2 | Two new functions need REVOKE/GRANT and `function-inventory.ts` entries (the plan said none) | Accepted |
| 5 | P2 | Reason: status, code-point counting, `SessionError` family | Accepted in part: status is 400 `VALIDATION_FAILED`, the contract does not cap length, `normalizeWrittenReason` is the single validator (code points). Its `SessionError` is kept and mapped in this controller; a second normaliser would fork the 054 rule |
| 6 | P2 | Fingerprint must cover actor, business, branch, entitlement, body; the reason is never persisted elsewhere | Accepted (the sessions controller helper already includes company and actor) |
| 7 | P2 | Replay after permission loss; a rolled-back failure leaves the key reusable | Accepted: stated and tested |
| 8 | P2 | Do not reuse `createLineWriteTransactions` (stores 200, wires an emit) | Accepted: own wrapper, status 201, no emit |
| 9 | P2 | Access reader semantics (`denied`, `can_read`, several eligible) | Accepted: plan rule 11 |
| 10 | P2 | Missing tests: re-run 42-2 negatives, two-connection CAS race, forged column is a privilege error, EX-03 refund half needs row 46 | Accepted |
| 11 | P2 | Merge order and the 45-ui split are the manager's call | Passed to the manager in the report |
| 12 | P3 | Lock note wrong (`FOR UPDATE` conflicts with `FOR KEY SHARE`) | Accepted: corrected; harmless because redemption FKs point at components and slots |
| 13 | P3 | Pin: an extension to a still-past date is allowed; one clock instant taken after the locks | Accepted |
