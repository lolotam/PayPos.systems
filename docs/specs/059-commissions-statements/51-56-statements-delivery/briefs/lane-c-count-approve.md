# Lane C — coverage, count and approve (#1032, 53-1, 53-2, then 53-3)

Read `COMMON.md` first. Your parts are 8, 7, 9 and 10 of `plan.md` _Lane C_. Private database lane name: `stmt-c`.

## Sources

- GitHub issue #1032 (`gh issue view 1032`). Its line numbers are stale; find the code by name.
- `docs/adr/0012-statement-approval-pending-outbox-count.md`, whole, with its amendments.
- `docs/adr/0054-…md` §4 and its addenda; `plan-50-3.md`; `50-4-package-sales/plan.md`.
- `spec.md` (059): Story 7; FR-020, FR-032…FR-036; D-9, D-13, D-14, D-15, D-22, D-26, D-27; CM-33…CM-39; §7 rows
  53-1, 53-2, 53-3.
- `docs/runbook.md`: the commission bootstrap, replay and coverage sections.
- `owner-questions.ar.md`: CS-Q9, CS-Q20, CS-Q22, CS-Q41…CS-Q44, CS-Q51.
- This delivery: `research.md` R9 and _Open gaps_; `plan.md` _Three states_.

## Part 8 — issue #1032 (Medium; no migration) — **start now**

The coverage report must never print a false `COVERED` (`research.md` R9):

1. A business that does not belong to the company is refused with `COMMISSION_COVERAGE_SCOPE_INVALID`. Check it
   through a commissions-owned port bound at the CLI root to the worker tenancy reader, on `pospay_app` under
   `withTenant` — no new role, no new grant. Add its Port row to `docs/module-map.md`.
2. An empty business list is refused in the use case too, not only in the CLI.
3. A run with no tip scope reports tips as «not checked». **Every check the report has today stays** (missing, stale,
   and retained counted events without the consumer's mark); the overall status is `COVERED` only when none of them
   fails **and** lines, salaries, sales and tips were all checked; every other outcome exits non-zero. There is no
   default to all businesses.
4. The printed result names the businesses and the date range it checked. `COVERED` proves that scope only; say so in
   the runbook text, which already has the operator supply a scope covering every business day with inputs.

Files: the worker's `use-cases/report-commission-coverage/`, `ports/commission-coverage.port.ts`, the worker
`commissions.module.ts`, `apps/worker/src/report-commission-coverage.ts`, their specs and the two `-db` specs, the
runbook's coverage sections, the ADR-0054 §4 text that describes the report. The existing test that pins `COVERED`
for a run with no tip scope is rewritten to the new rule, and the PR says so. Tests use a second tenant's business as
the foreign one. Size 150–250. Lane A moves files in the same module: do not touch the correction step, and merge
first or rebase after it.

## Part 7 — 53-1: the pending-event count (Heavy: migration, security)

**Preparation now; the function is written after your manager reports the design-advisor round** (spec 059 requires
it before 53-1).

Preparation: the fixtures and test skeletons of ADR-0012 §4 groups 1, 2, 3, 4 and 7; and the six counted type names as
one exported constant that both the worker's consumer registration and the catalogue test read, so the consumer and
the function cannot drift (ADR-0012 §1).

Then, exactly as ADR-0012 states and nothing more: role `pospay_approval_reader` (created in
`packages/db/src/roles.ts` the way `pospay_suppression_reader` is; NOLOGIN, member of nothing); the function
`public.statement_pending_commission_events(approval_started_at timestamptz) RETURNS bigint`, `SECURITY DEFINER`,
`STABLE`, with the pinned `search_path` and `row_security = on`, rejecting NULL and any value that is not its own
transaction timestamp, tenant from `app_company_id()` only; the two `SELECT` policies; the column grants; the revokes;
`EXECUTE` for `pospay_app` only. No index migration: the index was withdrawn (CS-Q56, 2026-11-23). Update `function-inventory.ts` (both proconfig items), `table-grants.ts`,
`privileges.spec.ts`. Tests: the five groups above (CM-39), including the search-path attacks and
the `EXPLAIN` of group 7. Size 350–500. No number and no push until «lane granted».

## Part 9 — 53-2: approve (Heavy: money, permission) — after 52-1, 53-1, 55-2f and #1032 are merged

Preparation meanwhile: measure what the coverage gate costs inside a transaction (the worker scans are company-wide
and paged; tips need a business and date scope) and report the numbers — your manager decides the gate's shape with
the design advisors before you write it. Also report how ADR-0012 §3's alert for a parked counted event is produced
today, if at all.

Scope as `plan.md` part 9: `use-cases/approve-statement/` with one lock call; the coverage gate, **whose
shape is open (T3, see the Addendum)**: the live comparison with the engine's `compareCoverage` is what you measure,
not what you build, and you write no coverage reader, proof table or migration before your manager sends the
answer; the pending count called with the
server's own transaction timestamp as lossless text; the statement builder called **once**, feeding both the
pre-freeze comparison and the freeze insert (D-26); the attachment snapshot (one staff reader call, one multi-row
insert, FR-033); the post-freeze statement-fingerprint recompute from the rows read back; carries by D-22, with the
D-13 selector imported from the shared package lane A creates; a departed employee is not re-carried; the approval
guard FR-036; HTTP. The freeze relies on the existing guards of migration `0183`; you add no migration.

Tests: the approval part of CM-33; CM-34, CM-34b, CM-34c, CM-34d, CM-34e (integration); CM-35; CM-37; CM-38; CM-38b;
ADR-0012 group 5; the carry cases named in spec 059 §7 row 53-2; the statement-view clause of CM-54. Size 400–550.

**Shipping this code opens approval nowhere.** Approval stays closed for a company until its coverage is proven by the
fixed report, and that run is not yours.

## Part 10 — 53-3 (Medium) — after 53-2

CM-36: a harness in which a real API approval races the worker consumer for a session, a redemption, a refund, a tip,
a salary, a plan version and an override, with barriers, never sleeps; each change lands in the frozen rows or in a
correction (ADR-0012 group 6). The admin statement screen under `apps/admin/src/commissions/`: view, review, return,
approve, blocking issues, the section «تصحيحات شهور سابقة» (CS-Q9), filtered to the reader's branch set (CS-Q20); its
route; the nav entry `commission-statements` leaving `soon`; ar/en keys through `packages/i18n`; component tests that
assert what the user sees. Use the Lovable-derived design system already in `packages/ui`. Size 400–550. Lane D adds
the pay and export buttons to your screen after it merges: leave a named slot for them and say where.

## Not yours

Generate, review, the carries table, payments, exports, reminders, alert rules, the repair route.

## Addendum — design-advisor round (research.md A1–A6). 53-1's function may now be written.

**53-1, the contract pinned (ADR-0012 §1–§2 — every item is a test, not a comment):**

- The role `pospay_approval_reader`: every attribute ADR-0012 §2 lists, a member of nothing and with no members, owner
  of this function and of nothing else; `USAGE` on schema `public` and `EXECUTE` on `public.app_company_id()`; no
  `CREATE` left anywhere.
- Column `SELECT` only on `outbox (company_id, id, event_type, created_at)` and
  `consumed_events (company_id, consumer_id, event_id)`.
- The function: `SECURITY DEFINER`, `STABLE`, `NOT LEAKPROOF`, `search_path = pg_catalog, pg_temp`,
  `row_security = on`, every name schema-qualified, the company predicate inside the query as well as in the policy.
- `ENABLE` and `FORCE` RLS stay on both tables, with the tenant policy for the new role.
- The ownership transfer, the `REVOKE ALL` from `PUBLIC` and from the four runtime roles ADR-0012 names, and the single
  `EXECUTE` grant to `pospay_app` happen in one transaction.
- Tests prove the **effective** privileges (not only the catalogue rows) and the refusal of a missing or malformed
  tenant context **even when the tables are empty**. `function-inventory` checks only the name, `prosecdef` and
  `proconfig`; it is not that proof.
- The six type names and the consumer id `commissions.project-inputs` become dependency-free constants in
  `packages/domain`, read by the worker's consumer registration. Keep an independent test of the actual registration,
  and test the installed function with one row per counted type, a non-counted type, another consumer's mark, and the
  strict `<` bound on `created_at`. Reading one constant on both sides does not catch a wrong SQL list.

**53-2:**

- **The coverage gate is not designed yet (T3).** FR-020 and FR-032 oblige the check after the lock and before the
  count for lines, tips, salaries and package sales. Measure the live comparison (`compareCoverage` with API-side
  readers) on representative data and report the numbers; your manager takes the choice between a live comparison and a
  stored proof to the owner. Do not write the gate, a proof table or a migration before the answer.
- **The parked-event alert is yours** (ADR-0012 §3, group 5): today both parking paths only log
  (`apps/worker/src/outbox/deliver.ts`, `dispatch-loop.ts`). Implement the owner alert at the worker and notifications
  boundary, for both paths, independent of the approval's rollback. A parked event still counts as pending.
- **Locks:** one ascending call from the source month through the current month; choose the carry target from the
  statuses that call returned; after the wait, re-check status, access and both fingerprints; never take an employee
  lock after the month locks. A second approver after the wait gets 409 `COMMISSION_PERIOD_CLOSED`.
- **The departed rule** needs data the API does not read today: add a staff-owned reader, bound at the root behind a
  commissions port with its module-map Port row, that gives the employee's employment dates (or the overlap with a
  month). The balance arrives once; when the month that received it is approved, it is not carried again if her
  employment does not overlap that month (D-22, CS-Q8, CS-Q28).