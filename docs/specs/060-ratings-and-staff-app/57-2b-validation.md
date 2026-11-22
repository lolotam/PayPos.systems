# 57-2b — own service-lines reader: local proof (phase 2)

Governing text: `61-remaining/plan.md` §5 (§5.3 items 1–3, §5.4 stop rule, §5.6, §5.7) and `61-remaining/spec.md`
AC-57-2b-1…8. Base `be0505eba`. Private synthetic lane only (Postgres `127.0.0.1:55404`, default autovacuum,
`statement_timeout` 30 s from the lane). No migration, index, server/table setting, statistics target, planner
flag or raised timeout was added or used. The route, OpenAPI operation and clients are **not** added (§5.3 item 7).

## Status and manager decision

- Items 1 and 2 (200 ms, stale and normal statistics): met at the approved fixture and at the scaled run below for the
  pages those runs measured (no cancelled line on any page, 5 statements). The maximum-statement case (6 statements,
  a cancelled line on the page) was added afterwards and is **not yet met**: one sample at 203.6 ms, see «Maximum
  statement case» below. The scaled run has not been repeated with it. **The maximum-statement case has no accepted
  timing yet**, on a first page or on a cursor page, at either size; the fixture now supplies both page kinds (see
  «Fixture revised») but no timing run has been made on it.
- Item 3 (a) (bounded statement count, no join, no sequential scan, no table scanned more than once per statement):
  met, asserted in the suite on exactly four tables: `service_sessions`, `service_lines`, `line_performers` and
  `service_line_cancellations` (the sixth statement; for it the suite also asserts that `company_id` is in the Index
  Cond, against a fixture of 50 cancelled lines in the target tenant). The shared authority reads (context, months
  window, allowed columns) are not planned by this check. The count is not a constant five: it is 4, 5 or 6 for a non-empty page by column and cancellation
  combination, with a maximum of 6 (below).
- Item 3 (b): **the literal Index Cond check is not claimed.** Under stale statistics the id lists are filters in
  every id statement (below). Manager design decision, 2026-11-22, option 1 (binding): §5.3(3)(b) is read as
  requiring indexed per-id probes where such probes are repeated per outer row. A single bounded batch statement
  with an id Filter is acceptable only if the scaled evidence below passes. It passed, so the route may be exposed.

## Fixture

`__tests__/own-service-lines.seed.ts`, `own-service-lines-performance.spec.ts`. Two background tenants with 1,500
visits each are inserted, then `ANALYZE service_sessions,service_lines,line_performers` runs once. The target is
inserted afterwards in raw SQL batches (no `ANALYZE`): 600 own visits, **602 own lines** (two visits carry a second
line), and **6,020 same-business colleague lines** on 6,020 visits (ten times hers, §5.7) in month 2026-10 across 28
days with repeated `occurred_at`, so sort keys tie. An independent oracle (single-table statements on the owner
connection) asserts exactly 600 visits / 602 lines / 6,020 colleague lines and supplies the expected pages. A plain
three-table `JOIN` written as the oracle itself hit the 30 s statement timeout under the stale statistics (the same
pathology as #894), which is why the oracle uses single-table statements.

Statistics state (recorded per run by `pg_stats` on `company_id`): the target company id was absent from the MCV lists
of all three tables before and after the measured run (`n_mod_since_analyze` about 6,620; no `last_analyze` or
`last_autoanalyze` after its insert). Autovacuum fired once during the first attempt (it analysed `line_performers`
mid-run, so that attempt was discarded by the spec's own post-check); the second attempt on a fresh tenant is the
recorded one. The spec fails, not skips, when no valid stale attempt can be produced in three tries.

## Candidates compared (both read from one `withTenant({ readOnly: true })` snapshot, after the shared authority)

- (A) month first (§5.6): sessions of the business in the month → lines of those sessions → her performer rows among
  them. Rows moved to the API per page read: about 6,620 sessions, 6,622 line ids, 602 performer rows.
- (B) employee first (§5.7, `line_performers_employee_idx`): her performer rows → their lines → their sessions in
  the month. Rows moved: 602 / 602 / 600. Then, for both, details of at most `limit` lines (and names or
  cancellations only when needed).

| Measured (ms, `withTenant` incl. begin/commit, driver materialisation) | first-20 | first-100 | cursor-100 | deep-cursor-100 |
|---|---|---|---|---|
| (A) stale statistics, run 5 | 100.5 | 93.9 | 97.3 | 122.2 |
| (A) stale statistics, run 4 | 71.2 | 158.5 | 69.8 | 85.2 |
| (A) normal statistics, run 5 | 62.9 | 69.3 | 71.6 | 74.8 |
| (B) stale statistics, run 5 | 32.2 | 35.3 | 33.6 | 31.8 |
| (B) normal statistics, run 5 | 26.1 | 32.0 | 25.5 | 31.9 |
| (B) stale statistics, kept spec run | 28.8 | 33.0 | 28.4 | 30.3 |
| (B) normal statistics, kept spec run | 21.6 | 25.1 | 23.3 | 22.3 |

Heap and RSS deltas around the call: (A) about 10 MB heap and 5–7 MB RSS; (B) about 0.6–2.8 MB heap and at most
about 1 MB RSS. Every page matched the oracle exactly (ids and order, including the deep cursor at the 300th line).

**Chosen: (B).** Three to four times faster and one tenth of the memory. The rows it materialises in the API are
bounded by the employee (her own performer rows), not by the colleagues. The rows the database *examines* are not:
under stale statistics each id statement scans the tenant's rows in its table and filters, so examined rows (and
time) grow linearly with tenant size (measured below). (A) was deleted.

## Plan evidence

Recorded as JSON by the spec (`57-2b plans`). Final reader, per page, single-table statements counted after the shared
authority reads: four always (performer rows by employee, lines by id, sessions by id (+ month window), line details),
plus customer names only when the `customer_name` column is allowed, plus cancellations only when a listed line is
cancelled. A non-empty page therefore runs 4, 5 (names alone or a cancelled line alone) or 6 (both) statements; the
maximum is **6**. Empty paths: 1 when she has no performer rows, 3 when none of her lines falls in the month or the
cursor is refused. `own-service-lines-statements.spec.ts` asserts the count for every combination and the maximum. The
shared authority reads (context, months window, allowed columns) are a fixed extra count outside these numbers.

Stale statistics (target absent from the MCV lists), each statement one pass, no join node anywhere:

- performer rows: `Index Scan line_performers_line_fk_idx`, cond `company_id, business_id`, **employee id as Filter**,
  602 rows returned.
- lines by id: `Index Scan service_lines_discount_proposal_binding_idx`, cond `company_id, business_id`, **id list
  as Filter**, 602 rows.
- sessions by id: `Index Scan service_sessions_business_day_idx`, cond `company_id, business_id, business_date`,
  **id list as Filter**, 600 rows.
- details and customer names: same tenant-wide indexes, id list as Filter, 100 rows.

Normal statistics: performer rows use `line_performers_employee_idx` with the employee as an index condition;
details use `service_lines_business_id_key` with the id list as an index condition; lines by id and sessions by id
(and the customer names) still read through a `(company_id, business_id)` bitmap with the id list as a filter,
because the fixture tables hold only about 16,000 rows.

Probe (temporary spec, deleted) of other formulations of the same lookups under stale statistics: dropping
`business_id` made `service_lines` use `service_lines_company_id_id_pk` with the id list as an index condition, but
the same rewrite on `service_sessions` and `line_performers` chose `(company_id)`-only indexes again, and with
normal statistics on this small fixture it produced sequential scans. No formulation gave an index condition on the
id in every statement and both states. This is the §5.2 reading of the cause: with a one-row estimate every
company-leading index costs the same, so the choice among them is arbitrary.

## Why item 3 (b) fails, and what that costs

Under a one-row estimate the planner reads each table through a `company_id`-prefixed index and filters the id
list. Each statement is a single pass (so §5.6's "worst plan is one pass in one table" holds and no plan can
multiply two tables), but the pass covers the tenant's rows in that table, not the page's rows: lines and sessions
are scanned for their whole history, performer rows for the whole business. At the fixture size one pass costs 1–4
ms (6,622 rows scanned for 602 returned). The cost is linear in the tenant's total rows while the estimate stays
stale, which is until autovacuum analyses the table. The 200 ms bound is proven at the fixture's size only; a
tenant of hundreds of thousands of lines would be slower during that window, and the only remedies that stay
inside §5.1 do not exist (the remedies are an index, a statistics change or a planner setting, each needing fresh
authorization per §5.4).

## Other receipts

- Contract/privacy (`own-service-lines.spec.ts`, 9 tests): current performers only, her own `share_bps`, removed
  performer gone, each of the eight column codes alone (hidden column absent, and absent from the SQL select list),
  `late` only beside `date`, a late line under its own `business_date`, tied sort keys walked with no gap or
  duplicate, a cancelled anchor stays valid, one uniform 400 for unknown/removed/colleague/other-month cursors,
  inactive and transferred branches, month window and `staff_months_back` (including 24 clamped to 12), orders
  feature recheck. `line_performers` is selected as `line_id` only (and `line_id,share_bps` when the share column is
  allowed); no statement selects a phone, rating, comment, colleague id or name.
- Isolation (`own-service-lines-isolation.spec.ts`, 2 tests): real positive reads in a foreign business and a foreign
  tenant before each exclusion; foreign cursors → 400; scope keys → 403; a foreign tenant context inside another
  tenant's transaction → 403.
- Regression: `own-work-http` 11/11 and `own-tips-isolation` 3/3 still pass with the restored `branches` field of the
  shared context.
- Unchanged by design: no migration, index, setting, statistics target, planner flag or timeout.

## Scaled one-off run (manager decision 2026-11-22, option 1): ~66,000 target-tenant lines

Spec `__tests__/own-service-lines-scale.spec.ts`, **gated by the environment variable `POSPAY_57_2B_SCALE=1`** and
therefore skipped in the regular suite (run: `POSPAY_57_2B_SCALE=1 pnpm exec vitest run
src/modules/orders/__tests__/own-service-lines-scale.spec.ts` from `apps/api`). It shares its code with the regular
performance spec (`own-service-lines.perf.ts`, `own-service-lines.plans.ts`); the regular spec (600 visits / 602 own
lines / 6,020 colleague lines) is unchanged in fixture and now also asserts the statement count and loops.
Bulk batches above 10,000 visits use `SET LOCAL session_replication_role='replica'` on the owner connection only,
because the per-row foreign-key checks pushed one 65,400-visit statement past the 30 s statement timeout; the rows
are consistent by construction. No product code, index, schema, statistics target, planner flag or timeout changed.

Fixture (asserted by the independent single-table oracle): 66,002 `service_lines` in the target tenant: **602 own
lines on 600 own visits** plus **65,400 same-business colleague lines**; two background tenants with 3,000 visits each.

Stale-state verification (`pg_stats` on `company_id`, recorded before and after the measured run, default
settings, no `ANALYZE` after the target insert): in both runs the target company id was absent from the MCV lists of
`service_sessions`, `service_lines` and `line_performers` (two ids present, both background tenants) before and
after; `n_mod_since_analyze` 66,000 before and 66,001 after; no `last_analyze` or `last_autoanalyze` after the
insert (run 3 had one autoanalyse during the background phase, 13:43:21, before the target existed). First attempt
valid in both runs; no retry was needed. Normal statistics: one `ANALYZE` of the three tables, only to prepare that
part (MCV then lists three ids, `reltuples` about 72,000).

Samples (ms, `withTenant` including begin/commit and driver materialisation; first run then five warm runs each;
5 statements in every sample, all columns allowed and no cancelled line on any page, so these are 5-statement samples,
not the maximum case):

| Run / statistics | page | samples | max |
|---|---|---|---|
| run 2, stale | first-20 | 103.4 71.6 67.7 86.1 69.0 63.4 | 103.4 |
| run 2, stale | first-100 | 62.1 63.1 66.5 74.0 89.2 138.7 | 138.7 |
| run 2, stale | cursor-100 | 118.0 146.8 183.8 80.3 98.7 65.5 | **183.8** |
| run 2, stale | deep-cursor-100 | 95.4 67.3 73.6 81.3 67.7 65.6 | 95.4 |
| run 3, stale | first-20 | 93.2 68.9 60.6 84.9 62.1 60.1 | 93.2 |
| run 3, stale | first-100 | 62.2 62.2 63.0 62.1 63.9 62.1 | 63.9 |
| run 3, stale | cursor-100 | 70.4 72.9 64.6 66.1 64.5 70.9 | 72.9 |
| run 3, stale | deep-cursor-100 | 64.6 62.0 62.1 61.3 62.5 63.2 | 64.6 |
| run 2, normal | the four pages | 20.6–35.1 | 35.1 |
| run 3, normal | the four pages | 22.8–41.2 | 41.2 |

Every sample is under 200 ms. The stale-statistics margin is thinner than at the small fixture and noisy: one warm
sample reached 183.8 ms (run 2), the other run peaked at 103 ms. Heap delta at most 1.8 MB and RSS delta at most
3.1 MB per page. Every page equalled the oracle, including the deep cursor at the 300th line.

EXPLAIN (ANALYZE, BUFFERS) facts for the batched id statements, stale statistics, 66,002 tenant lines (run 2):

| Statement | Scan | Rows returned | Rows removed by filter | Loops | Shared hit blocks | ms |
|---|---|---|---|---|---|---|
| her performer rows | `line_performers_employee_idx`, employee as Index Cond | 602 | none | 1 | 561 | 0.2 |
| lines by id | `service_lines_recorder_idx`, Index Cond `company_id` only, id list as Filter | 602 | 65,400 | 1 | 2,255 | 9.5 |
| sessions by id | `service_sessions_recorder_idx`, Index Cond `company_id` only, id list as Filter | 600 | 65,400 | 1 | 1,792 | 11.3 |
| line details (100) | `service_lines_recorder_idx`, id list as Filter | 100 | 65,902 | 1 | 2,255 | 10.0 |
| customer names (100) | `service_sessions_recorder_idx`, id list as Filter | 100 | 65,900 | 1 | 1,792 | 12.3 |

Each table is scanned exactly once per statement (loops 1, no join, no per-id repeat, no sequential scan), and the
statement count of these pages is 5 (names allowed, nothing cancelled; independent of page size and tenant size; the
general rule is 4 to 6, above). The examined rows are
linear in tenant size, as the previous section warned: 65,400 rows removed per statement at this size, against about
6,600 at the approved fixture, with about 10 ms per statement. With normal statistics at the same size, run 2 showed
the id list as an Index Cond in every id statement (`service_lines_company_id_id_pk`, `service_sessions_company_id_id_pk`,
`service_lines_business_id_key`, `service_sessions_business_id_key`) and about 1 ms per statement; this is an
observation of that run, not a claim about the literal check under stale statistics.

Remaining risk, unchanged and for the record: the stale-statistics cost is linear in the tenant's rows until
autovacuum refreshes the statistics, so a tenant much larger than 66,000 lines would exceed the budget in that
window; the remedies (index, statistics, planner setting) stay out of scope without separate authorization.

Run 4 (final code, after the contract output parse was added): stale statistics max 93.4 ms (first-20), the three
other pages 62–74 ms; normal statistics 20.7–38.5 ms; target absent from all three MCV lists before and after
(two ids listed, `n_mod_since_analyze` 66,000 then 66,001, one autoanalyse at 13:56:10, before the target insert);
5 statements per sample (no cancelled line on any page). All four scaled runs (2, 3, 4 and the one summarised above)
passed every 200 ms assertion for those 5-statement pages.

## Maximum statement case (6 statements): regular fixture, open finding

The earlier text counted a fixed five statements. That was a fixture result: customer names and cancellations each add
an independent statement. Per request, after the shared authority reads (9 statements, fixed, outside the numbers
below): empty paths run 1 (no performer rows) or 3 (none of her lines in the month, or a refused cursor); a non-empty
page runs 4 (no names, nothing cancelled), 5 (names alone, or a cancelled line alone) or 6 (names allowed **and** a
cancelled line on the page). The maximum is **6**. `own-service-lines-statements.spec.ts` asserts every combination
and the maximum through the real reader (`1,3,3,4,5,5,6` plus a page with a cancelled line off the page = 5 and on the
page = 6).

Measured on the regular fixture **as it was then** (600 own visits, 602 own lines, 6,020 colleague lines; spec
`own-service-lines-performance.spec.ts`, one sample per page, `warm: 0`, first run only). That fixture cancelled two of
her lines (positions 250 and 450 in the newest-first order, through the real cancellation path: line status plus one
`service_line_cancellations` row each, no `ANALYZE`), so the three new pages carried a cancelled line and ran 6
statements; the four original pages ran 5. **No first page (first-20, first-100) carried a cancelled line, so every
six-statement sample of this table is a cursor page; see «Fixture revised» below:**

| Page (statements) | stale ms | normal ms |
|---|---|---|
| first-20 (5) | 66.6 | 73.7 |
| first-100 (5) | 73.9 | 71.7 |
| cursor-100 (5) | 78.6 | 49.0 |
| deep-cursor-100 (5) | 84.6 | 49.5 |
| cancelled-20 (6) | 96.5 | 46.8 |
| cancelled-100 (6) | **203.6** | 52.3 |
| cancelled-deep-100 (6) | 68.8 | 63.1 |

**One maximum-case sample is over the 200 ms bound: `cancelled-100`, stale statistics, 203.6 ms.** The spec failed on
it, as designed. Per the stop rule nothing was changed (no index, setting, statistics target or timeout), the run was
not repeated to obtain a green result, and the scaled 66,002-line run (`POSPAY_57_2B_SCALE=1`) with the maximum case
was **not** run. The statement-level evidence from the same run does not show a slow statement: under EXPLAIN
(ANALYZE) the five original statements took 2.3, 5.3, 4.7, 3.5 and 3.4 ms (stale) and the sixth, cancellations by
`line_id`, was an `Index Scan` on `slc_membership_idx` (`company_id` as Index Cond, the id list as Filter), 1 row,
loops 1, 0.14 ms (stale) / 0.21 ms (normal), so the page's database time is about 20 ms and the 203.6 ms sample is wall
time around it (begin/commit, driver materialisation, scheduling). The machine was not otherwise quiet in the later part
of the session (CPU at 100 % with another session's work; two unrelated specs of this suite failed once on statement
timeouts and passed when rerun), but the load during this particular sample was not recorded, so this is a hypothesis,
not a finding. The cancellations table held two rows in this fixture, so the cost of the sixth statement against a table of many
cancellations was unmeasured, and `service_line_cancellations` was not in the plan checks' table list; both are changed
in «Fixture revised» below. The item 3 (b) result is unchanged: the id list is a filter, the literal Index Cond check is
not claimed.

**Three further runs of the regular spec by the owner session (same head, same lane, no change), 2026-11-22.** Runs 1
and 2 passed: every page, the three maximum-statement pages included, was under 200 ms (the spec prints samples only
when it fails, so their values are not recorded). Run 3 failed on every page in both statistics states, the already
proven five-statement pages included: stale 257–1,043 ms, normal 162–711 ms (first-20 215, first-100 162, cursor-100
711), against 22–41 ms for those same normal-statistics pages in the earlier runs. The machine's processor load read
100 % immediately after run 3; other sessions share this machine. Reading: wall time on this host is not reproducible
under that load, so neither the 203.6 ms sample nor run 3 measures the query, and the passing runs cannot be presented
as a clean maximum-case proof either. **Open:** the maximum-statement case has no accepted measurement yet, at fixture
or at 66,002-line scale; it needs a run on a quiet host, or an acceptance rule that separates database time from wall
time, decided by the design approver. The route was exposed on the five-statement evidence above.

### Fixture revised (review findings G4 and G7): first-page and cursor evidence, and the cancellations table

The acceptance decision asks for the six-statement case on a first page **and** on a cursor page. The timing numbers
above do not answer that for the first page. The fixture and the suite are therefore changed (test code only, no
product code, index, setting, statistics target or timeout; **no timing run was made with this revision**, so the
timing receipt for the maximum case is still open and unchanged by this section):

- The target tenant now has three cancelled lines of hers, at positions 50, 250 and 450 of the newest-first order, plus
  47 cancelled lines of colleagues, all through the real cancellation path: **50 rows in `service_line_cancellations`**
  (asserted by the run's `57-2b cancellations table` log line: 50 tenant rows, never analysed, `n_mod_since_analyze`
  50). Position 50 lies inside `first-100` and outside `first-20`, so `first-20` stays a five-statement first page,
  `first-100` becomes a six-statement first page, `cursor-100` and `deep-cursor-100` stay five-statement cursor pages,
  and `cancelled-20`, `cancelled-100` and `cancelled-deep-100` are six-statement cursor pages.
- The suite records each sample's page kind (first page or cursor) and fails, per statistics state, unless a first page
  and a cursor page each ran exactly 5 statements and exactly 6 statements. This is asserted in the regular untimed
  suite and in both explicit timing suites (regular and 66,002-line, which share this code). The timed 200 ms judgment
  stays gated by `timing`.
- The plan checks (no join, no Seq Scan, every scanned table loops = 1) now cover **four tables**:
  `service_sessions`, `service_lines`, `line_performers` and `service_line_cancellations`. For the sixth statement they
  also assert that it appears exactly once on a page with a cancelled line and not otherwise, and that `company_id` is in
  its Index Cond. The `first-100`, `deep` and `cancelled` pages are planned; the first and the cancelled page carry the
  sixth statement. Observed in the regular untimed run, both statistics states: `Index Scan` on `slc_membership_idx`,
  `company_id` as Index Cond, `line_id = ANY(...)` and `business_id` as Filter, 1 row returned, 49 removed by filter,
  loops 1. This is the same id-list-as-filter shape as the other id statements, so the literal Index Cond check on ids
  is still **not** claimed.
- Residual risk of this check, stated plainly: with 50 rows the table sits exactly at the autovacuum analyse threshold
  (50 modifications, strict greater-than needed), so it stays un-analysed in a single attempt. A second stale-statistics
  attempt in the same run adds 50 more rows and could let autovacuum analyse the table; a table that small, once
  analysed, can legitimately be read by a sequential scan, which this check would then report. The run logs the table's
  analyse state so such a failure is readable.

## Phase 3: route exposed

Recorded before the route was added: the manager's design decision of 2026-11-22, option 1 (above), and the scaled
evidence above. The route `GET /v1/staff/me/service-lines?month&cursor&limit` (personal session or `STAFF_POS` with a
live private-view window, `no-store`, one `readOnly: true` snapshot), the contract
`packages/contracts/src/orders/own-service-lines.ts` and its OpenAPI paths file were then added, replacing the local
placeholder schema and type. The OpenAPI registration in `packages/contracts/src/openapi.ts` and the generated
clients are the manager's step. HTTP spec `own-service-lines-http.spec.ts` (6 tests: personal session, own lines
only and a walkable cursor, uniform 400, `STAFF_POS` window expiry and dead operator, scope keys and session-less
access, DENY and unlinked employee, log privacy) and the contract spec pass.
