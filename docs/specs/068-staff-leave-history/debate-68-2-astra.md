# Debate 68-2 — Codex `gpt-6-astra`, effort medium, one round (PP-168)

Command: `codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only -C <worktree> "<prompt>" </dev/null`,
2026-11-11, on `plan-68-2.md` at base `73dbfc2fd` (uncommitted plan). Prompt: `briefs/row-68-2/debate-prompt.txt` (outside
the repo). The reviewer's final message follows verbatim, then the orchestrator's verdict per finding.

## Reviewer output (verbatim)

1. **P1 — `plan-68-2.md`, “Performance checkpoint and fallback”: floor proof lacks necessary conditions.** The `(limit+1)` leaves must survive **all** visibility, employee, branch, period, type/status and cursor predicates. Otherwise excluded leaves can set a recent floor and suppress valid older absences. Fewer than `limit+1` qualifying leaves—including absence-only filters—produce no usable floor; comparing against SQL `NULL` drops every day.  
   **Done:** define the candidate set explicitly; disable floor pruning when insufficient leaves remain. Preserve `working_date >= floor`, including every floor-date rank/ID tie, and apply the full tuple cursor afterward. Test zero/few leaves, filtered leaves, subsequent pages, and cursors at ranks 1–3 against the unoptimized query.

2. **P2 — `plan-68-2.md`, D3: access invocation and error order are underspecified and contradict reuse.** The tab calls `access.check(...purpose: 'history')`. Without `employeeId`, that adapter passes `null` to `historyEligible` and denies an enabled business-wide request (`leave-read-access.adapter.ts:65,89`). With `employeeId`, missing/out-of-scope employees already return `null` **before** feature and cursor checks—not last, as D3 states.  
   **Done:** specify the adapter context for filtered/unfiltered requests and each D1 outcome. Document actual precedence, including controller validation; test invalid employee + disabled feature, invalid employee + bad cursor, and a successful unfiltered request.

3. **P2 — `plan-68-2.md`, D6 and fallback: “index-ordered” leaves are not supported by the cited index.** `leave_requests_company_business_branch_dates_idx` orders by company, business, **branch**, `from`, `to`; it cannot directly supply global `from DESC, id DESC` across branches, and lacks the ID tie-breaker. Likewise, the shift time index does not establish index access for the joined `employees` and `staff_schedules`; the existing query supplies no `week_start` bound.  
   **Done:** remove the asserted ordering guarantee. Capture report-specific plans after removing the employee predicate, checking all five named tables, sorts and buffers. Coordinate any demonstrated migration need. Static inspection cannot establish whether PostgreSQL will choose sequential scans.

4. **P2 — `plan-68-2.md`, performance checkpoint: page 1 with plentiful leaves cannot validate the fallback’s expensive cases.** Leave-floor pruning disappears for absence-only filters, sparse/no qualifying leaves and late pages. These can still evaluate the full year’s day groups and coverage probes. The existing fixture’s default coverage also does not exercise a large returned absence population.  
   **Done:** measure full HTTP p95 and EXPLAIN for dense absences, absence-only filters, sparse/no leaves, late cursors and restricted branch scopes. Include `employee_id` with all-history `last_taken`. Require the budget across these cases, not merely the optimized first page.

5. **P2 — `plan-68-2.md`, D2 and test brief: report-specific race coverage is missing.** Static “soft-deleted → 404” does not test deletion between `access.check` and the final statement. Existing tab race tests exercise the old reader, not the new report reader or subject modes. Losing the final employee-existence marker can return `200` with empty rows—and potentially leave summaries—instead of 404.  
   **Done:** require final-statement existence checking whenever `employee_id` is supplied, independently of LH-Q12. Add report tests for concurrent soft deletion, the selected attachment policy’s races, and page/`last_taken` consistency during approval. For unfiltered reads, verify deleted employees disappear from all three sources.

6. **P3 — `plan-68-2.md`, D5: incorrect lower-bound exclusivity.** `(now − 24 h, now]` rejects exactly 24-hour-old cursors. Merged code rejects only timestamps **older** than 24 hours (`leave-history.query.ts:74`); the spec explicitly includes both edges.  
   **Done:** use `[now − 24 h, now]`; test both boundaries and one millisecond beyond each.

**Verdict: revise before implementation; D1 is correctly held for LH-Q12’s owner decision.**
## Verdicts

| # | Sev | Verdict | Reason and plan change |
|---|---|---|---|
| 1 | P1 | Accept | The floor candidates must be the fully filtered leave rows (visibility, employee, branch, period, type/status, `excludeOpen`, cursor); with fewer than `limit+1` of them, or an absence-only filter, no floor is applied (no `NULL` comparison). Ties on the floor date are kept (`>=`). The fallback must equal the unoptimized query on the listed cases. Plan "Performance checkpoint and fallback" updated. |
| 2 | P2 | Accept | Verified: `leave-read-access.adapter.ts:88-93` denies `purpose:'history'` with no employee. Without `employee_id` the report calls `access.check` with no `employeeId` and no `purpose`; with it, `employeeId` set, and `purpose` per LH-Q12. A missing or out-of-scope employee returns `null` from the adapter before the feature check, so 404 precedes `FEATURE_DISABLED` there, as on the tab. D3 rewritten with the real order and the three tests. |
| 3 | P2 | Accept | The branch-dates index cannot supply a global `from DESC, id DESC` order. The "index-ordered" claim is removed; the EXPLAIN on the report SQL decides the plan for all five tables. |
| 4 | P2 | Accept | The checkpoint now measures dense absences, an absence-only filter, no qualifying leaves, a late cursor, a restricted branch scope, and `employee_id` with `last_taken`. |
| 5 | P2 | Accept | With `employee_id`, the final statement always rechecks the employee's existence (non-deleted, business), whatever LH-Q12 decides; report race tests (soft delete between check and statement, approval during the read) added; unfiltered reads drop deleted employees from all three sources. |
| 6 | P3 | Accept | Verified: `leave-history.query.ts:74` rejects only instants older than 24 h; the spec includes both edges. D5 corrected to `[now − 24 h, now]` with edge tests. |

Accepted 6, rejected 0.
