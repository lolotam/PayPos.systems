Astra (gpt-6-astra) unavailable: Codex usage limit until 2026-11-14 11:20; PP-112 fallback to Fable via pospay-advisor; raw error in briefs/059-50-3/astra-raw.txt

# Debate, row 50-3a (one round, Fable via `pospay-advisor`, 2026-11-12)

## Fable output (verbatim)

**Verdict: agree with changes.** Continuing past undelivered events is the right call, but as described it has three P1 gaps. No runner code exists in the worktree yet, so this reviews the design, not an implementation.

1. **P1 — Plan and caller disagree.** `plan-50-3.md:94-95` says the runner "stops on the first undelivered event with a typed error" and returns `{ throughId, afterId, counts, unresolved }`. You describe continue-past with an `undelivered` list. The plan is also inconsistent with itself, since it stops on the first failure yet counts an unresolved legacy salary and carries on. Amend the plan before the brief goes to the implementer. Continue is the better design: one permanently failing event (schema-invalid old payload, null business) would otherwise block every later event for that company, and approval stays closed forever (D-27).

2. **P1 — The checkpoint becomes misleading under continue-past.** If `afterId` advances past a failed event, resuming from `AFTER_ID` never retries it. The 50-0 facade has no read-by-id, so the only remedy is a full re-run from `afterId = null` with the same `THROUGH_ID`, which is safe because marks dedupe. The result needs `complete: false` and a non-zero exit whenever `undelivered` or `unresolved` is non-empty. The runbook must say `AFTER_ID` resume is for crashes only, and that undelivered events need a full re-run. The 35b-2 text "set AFTER_ID from the last successful page" (`docs/runbook.md:158`) must not be copied as-is.

3. **P1 — The runner cannot classify failures from the deliverer's outcome.** `createDeliverer` swallows the throw and returns only `type[:code]` (`deliver.ts:95-103`). `errorDiagnostic` emits a code only if it is in `KNOWN_CODES`, and no `COMMISSION_*` code is there (`packages/observability/src/serializers.ts:28,53-59`). So `CommissionEmployeeBusinessMissingError`, a schema failure, a deadlock and a timeout all arrive as `"Error"`. The plan's separate `unresolved` (CS-Q44) count cannot be built this way. There are two ways to fix it:
   - **Wrap the consumer (recommended):** the caller wraps `consumer.handle` to record the thrown error's `code` per event id before rethrowing. This stays inside the slice.
   - **Extend `KNOWN_CODES`:** add the commission codes in `packages/observability`. This touches a package outside the slice (CLAUDE.md §1.4), so it must be declared.

4. **P1 — No circuit breaker for transient failures.** With the database down or a lock storm, the runner walks the whole range, each event costing up to 60 s (`DELIVERY_TIMEOUT_MS`), and reports thousands as undelivered. Continue only on a closed allowlist of deterministic codes: `COMMISSION_EMPLOYEE_BUSINESS_MISSING`, `COMMISSION_LINE_EVENT_INVALID`, `COMMISSION_TIP_SALARY_INPUT_INVALID`, `COMMISSION_BUSINESS_MISSING`, `COMMISSION_PERIOD_CLOSED`. Abort with the checkpoint on anything else. Cap the list size.

5. **P2 — The upper bound is id order, not commit order.** `readReplayPage` filters `id <= throughId` on a UUID v7 generated before commit. A transaction that commits a lower id after the cursor has passed is never replayed. That is safe only because live delivery covers it, which is exactly must-handle item (a). The runbook must state that dependency and must not claim "everything ≤ THROUGH_ID was replayed". Add a test where an event commits behind the cursor and still lands through live delivery.

6. **P2 — "In order" (D-15) no longer holds.** Skipping means later events of the same aggregate apply before an earlier failed one. Lines and same-date salaries are covered by revision guards and existing convergence tests. I found no test for one employee's salaries with different dates applied in reverse order, sequentially, and then the earlier one applied late (`readNextEffectiveFrom` at `project-salary.ts:58` depends on what is already projected). Add it.

7. **P2 — Concurrency with live delivery is sound, but untested for this path.** `markEventConsumed` is `ON CONFLICT DO NOTHING` in the same transaction as the handler (`consumed-events.ts:19-24`, `deliver.ts:70-76`). A concurrent live delivery of the same event blocks, then skips. The replay may deliver an unpublished event ahead of the live per-aggregate order; the guards absorb that. Add a test of replay and live `dispatchBatch` on the same event: one effect, one mark, and `published_at` set only by the live path.

8. **P2 — CS-Q44 applies the employee's current business, not the business at the time of the salary.** `readEmployeeBusiness` reads `employees.business_id` now (`employee-business.reader.ts:18-22`). That matches the decision as written, and the soft-deleted case is already tested. If an employee can change business, a legacy salary lands in the wrong one. I could not verify whether `employees.business_id` is immutable; that is the one check. If it is mutable, it is a business question: record it as PENDING for the manager, do not guess.

9. **P2 — Placement and CLAUDE.md rules.** Follow the rating precedent: runner in `jobs/` (`modules/customers/jobs/recover-rating-claims.ts`) and a real entry file (`apps/worker/src/recover-rating-claims.ts`), not a runbook heredoc, which is untested code. A runner in `use-cases/` typed on `@pospay/db` breaks the use-case import rule (D-26). The entry must build the consumer with the same three readers as `main.ts:168`; a shared factory avoids drift. A new `ports/` method needs Arabic JSDoc (§3.1).

10. **P3 — Tenant fence in the runner.** `pospay_dispatcher` has no RLS, so the facade's company filter is the only fence. The runner should assert `event.companyId === companyId` and that the event type is one of the four, as the rating runner does (`recover-rating-claims.ts:44`). Roles are otherwise correct: the dispatcher only reads, effects run as `pospay_app` in `withTenant`, and there is no new grant.

11. **P3 — Misleading log.** Replayed events carry `attempt = max(1, attempts)` (`dispatcher.ts:249`). A failed replay of a row with 10 or more attempts logs "outbox event parked" at error level (`deliver.ts:101`), though nothing is written. Document it in the runbook or wrap the logger.

12. **P3 — Re-run after rollback (item d).** Once 53-2 exists, an unmarked event that targets an APPROVED month throws `CommissionPeriodClosedError` and stays undelivered. The pending count keeps approval closed, which is the intended result. The runbook should name this outcome and its owner.

13. **Missing tests beyond the plan's list.**
    - Continue, then a full re-run that delivers the previously failed event.
    - Deterministic failure versus transient abort.
    - The no-write assertion extended to `attempts`, `parked_at`, `next_attempt_at` and `last_error`, not only `published_at` and `consumed_events`.
    - A parked event and an unpublished event both replayed.
    - `afterId == throughId`, and an empty company.
    - The report carries ids and codes only, with no payload (§8).

14. **Scope creep: none found.** `SessionTipsChanged` is not in the facade's types, so tips stay in 50-3b. Keep coverage readers and the ADR-0054 addendum out of 50-3a. Finding 3's `KNOWN_CODES` option is the one place the slice could leak.

**Not verified:** I did not read `AGENTS.md`, `CLAUDE.architecture.md`, `docs/agent-delivery-pipeline.md`, ADR-0012, ADR-0041 §6 or ADR-0054 §4. ADR claims rest on what `spec.md` quotes.

**Owner call:** you can decide all of this as code design. Only finding 8 goes up to the manager, and only if `business_id` turns out to be mutable.

## Task-session verdicts

| # | Verdict | Reason |
| --- | --- | --- |
| 1 | Accept | Plan amended: continue-past with `undelivered`, no stop-on-first |
| 2 | Accept | Result has a `status`; `AFTER_ID` resume only for a crash or page limit; undelivered needs a full re-run with the same `THROUGH_ID`; non-zero exit unless `COMPLETE` |
| 3 | Accept (wrap the consumer) | Failure codes recorded by a wrapper in the job file; `packages/observability` untouched |
| 4 | Accept | Closed allowlist of five deterministic codes; any other failure aborts with the checkpoint; list capped at 200 |
| 5 | Accept | Runbook states the live-delivery dependency; test of an event committing behind the cursor |
| 6 | Accept | Reverse-order salary test added |
| 7 | Accept | Replay versus live `dispatchBatch` test added |
| 8 | Reject as open question | Spec 017 line 30: «business and company identity remain immutable»; `readEmployeeBusiness` is correct as decided in CS-Q44 |
| 9 | Accept | Runner in `commissions/jobs/`, real entry file `apps/worker/src/replay-commission-inputs.ts`; `main.ts` untouched; the entry builds the consumer with the same three readers |
| 10 | Accept | Tenant and event-type fence in the runner |
| 11 | Accept | Runbook note |
| 12 | Accept | Runbook note |
| 13 | Accept | All listed cases go to the test brief |
| 14 | Noted | No change |
