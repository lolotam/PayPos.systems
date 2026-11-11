# Debate — row 42-4r plan, Astra (one round)

Model `gpt-6-astra`, effort `medium`, `codex exec --sandbox read-only`, 2026-11-11, on [plan-42-4r.md](plan-42-4r.md) at the first draft. Output verbatim (the CLI printed findings 4 and 5 twice):

```text
1. **P1 — Plan D6:** `next_unit_value` and `remaining_value` do not satisfy FR-070/CP-01’s per-component **slot values** requirement. They hide differing ordinal values, including the rounding remainder already demonstrated by the detail tests (`6.666`, `6.666`, `6.668`). **Fix:** include ordinal/value data in the list contract, or obtain an explicit spec amendment before replacing it with aggregates.

2. **P2 — Plan D4–D5:** Reusing the cursor’s `as_of` for `expired` makes later pages report yesterday’s expiry state after branch-local midnight. That conflicts with D4’s current branch-local “today.” **Fix:** distinguish the frozen pagination date from the current display date; compute `expired` from the injected clock on every request. Test pagination across midnight with a branch timezone differing from its business timezone.

3. **P2 — Plan D5:** Freezing `as_of` does not stabilize the other sort keys. Redemption/refund can change `rank`; extension can change `expires_on`. An already-returned package can move after the cursor and appear again, while an unseen package can move before it and disappear. **Fix:** define an explicit pagination consistency policy—snapshot the ordering, or invalidate/restart pagination when ordering inputs change—and test mutations between pages.

4. **P2 — Scope, D5, and EXPLAIN tests:** The existing index supports customer filtering and expiry ordering, but not the leading computed `rank` or the complete `(rank, expires_on, id)` order. Ranking can require examining every matching entitlement and its slot availability before applying `LIMIT`. Merely asserting index use/no sequential scan does not establish the required 200 ms budget. **Fix:** add representative high-cardinality and maximum-slot fixtures, inspect rows/loops and sorting in `EXPLAIN ANALYZE`, and verify the 200 ms budget. Make the “no migration” commitment conditional on those results.

5. **P2 — Files rows 12–13 / Tests mapped to the spec:** The planned guard matrix omits TD-13’s per-permission DENY behavior and grants scoped to another branch. “Record only/read only/neither” cannot catch an implementation that lets a DENY on one permission veto an independently allowed alternative, or accepts an unrelated branch grant. **Fix:** test both endpoints with one permission denied and the other allowed, no surviving allowed permission, and grants covering only another branch.
```

## Verdicts (Claude, task session 42-4r)

| # | Severity | Verdict | Reason and plan change |
|---|---|---|---|
| 1 | P1 | **Accepted, with a bounded shape** | CP-01 names "slot values" in the list. Listing every slot would be unbounded: up to 365 per component and 7,300 per sale, on every row of a page. D6 now returns per component `slot_values`: one entry per distinct stored unit value, with the free, used and refunded counts at that value, ordered by value (the allocation leaves one or two distinct values per component, so the remainder slot such as `6.668` stays visible). `next_unit_value` stays, because 43-3 prices the line from it. `remaining_value` is dropped, because the spec does not name it. Every ordinal stays in the FR-071 detail. |
| 2 | P2 | **Accepted** | The frozen `as_of` is removed. `expired`, `used_up` and the rank are computed on every request from the injected clock and the branch's effective timezone (TD-4), so a page never shows yesterday's state. The test uses a branch whose timezone differs from its business's. |
| 3 | P2 | **Accepted, as an explicit policy** | A snapshot cursor would need server state for a list of a few packages per customer. D5 now states the policy instead: each page reflects the state at its own request. A package redeemed, refunded or extended between page reads may repeat or be skipped. The hooks de-duplicate by `id`, and the client restarts from the first page after any write it makes (43-3 invalidates the query on save). The cursor holds only `{ rank, expires_on, id }`. A test changes a package's rank between two page reads and shows that pagination still ends with no error and no duplicate entry in the hook's flattened list. |
| 4 | P2 | **Accepted** | The fixture gains a customer with 60 entitlements of 3 components × 30 slots each. The test asserts `EXPLAIN ANALYZE` use of `package_entitlements_customer_read_idx` for the entitlement filter and `package_session_slots_free_idx` / `package_session_slots_component_fk_idx` for the per-component reads, with no sequential scan on the three package tables. It also asserts a wall-clock budget below 200 ms (CLAUDE.md §6; PP-165.1 keeps §6 budgets). "No migration" now depends on this test: if an index is missing, the session stops and reports, and adds no migration on its own. |
| 5 | P2 | **Accepted** | The HTTP matrix gains three cases on both routes: a DENY on one permission with the other ALLOWed → 200; both denied → 403; both granted only on another branch → 403. |

Accepted 5, rejected 0. ONE round, as PP-168 sets.

### Item 4 — deviation recorded after implementation (manager decision, 2026-11-11)

The EXPLAIN test does not assert `package_entitlements_customer_read_idx` by name. With `enable_seqscan` off and a seed of 41 customers, the planner still serves the entitlement filter from `package_entitlements_customer_fk_idx (company_id, customer_id)`, not from the read index `(company_id, business_id, customer_id, expires_on)`. The test therefore accepts any index whose name starts with `package_entitlements_customer_`, `package_components_entitlement_`, `package_session_slots_component_` or `package_session_slots_free_idx`, and still asserts no sequential scan on the three package tables and the 200 ms wall-clock budget.

Why the manager accepted it: CLAUDE.md §9 asks for an index plan with no sequential scan, and the test still proves that. The cost is that the test would also pass if `customer_read_idx` were dropped, so it no longer shows that this index serves the query. No migration was added. A follow-up issue evaluates whether `customer_read_idx` is redundant now that the planner prefers `customer_fk_idx`.
