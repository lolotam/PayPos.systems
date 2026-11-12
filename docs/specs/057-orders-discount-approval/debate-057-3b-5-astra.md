# Debate 057-3b-5 — Astra not available; advisor stand-in review (2026-11-12)

**Astra did not run** (Codex credits exhausted, same as 3b-4). In its place the session consulted `pospay-advisor` (read-only, non-binding, PP-136) on the 3b-5 brief and the real code. This is advice, not an Astra round.

## Advisor findings (condensed, no P0)

1. **P1** The primary-key index is `dp_pk`, not `discount_proposals_pkey`; assert an alternation (`dp_pk|dp_business_id_key|dp_consumed_line_key|dp_consumed_edit_key`) plus an `Index Cond` on `id =`.
2. **P1** 101 owners in `otherScope()` give `[100, 2]` because `USER` is already a TENANT.A owner; use `otherCompany()` and set the decider to a new owner.
3. **P1** Concurrency A through the deliverer only races on `consumed_events`; add `consume` twice in parallel to race the ledger claim.
4. **P1** Concurrency B needs a real "loser is blocked" signal (poll `pg_stat_activity` for a Lock wait, gate opened in `finally`) plus a rollback variant in which the second claim wins.
5. **P1** The matches EXPLAIN needs realistic seeding (about 100 decided rows, `ANALYZE`) and an `Index Cond` assertion; use a scope in the company the helper queries.
6. **P3** The claim assertion is correct: exact `"Conflict Resolution":"NOTHING"` and the `source_event_key` arbiter; `EXPLAIN ANALYZE` really inserts.
7. **P2** The inbox path works (source events list and i18n key exist); assert on `Synthetic customer` and a phone regex, never bare `Synthetic`; Arabic names fall back to English.
8. **P2** Dedupe must cross the recipient-query arms (COMPANY owner plus BRANCH membership of the same user) to prove the SQL layer, not only the grouping function.
9. **P2** Keep every `it` under 60 lines and every file under 400; one additive `noticeEvent(prepared)` member in the data file.
10. **P3** The 880-line cap is only the PP-112 refusal bound; target 340 to 380.

## Verdicts
All accepted into the slice brief ("Corrections from the advisor review"). The one open evidence gap, the planner's real choice of index, is settled by running the explain spec; the alternation absorbs ties.
