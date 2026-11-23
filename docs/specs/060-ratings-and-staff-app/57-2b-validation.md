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

**Cost the design accepts, stated explicitly (review comment on `own-service-lines.membership.ts`, MEDIUM).** The first
statement of every page (her performer rows) has no month predicate and no `LIMIT`: it reads **all of her lifetime
`line_performers` rows** on every page, grows with her tenure (the fixture puts 602 of her lines in ONE month, so at
that rate about 7,200 rows per year; both scaled fixtures keep her own history at 602 lines and grow only the
colleagues' volume, so no run here measures this growth term), and sends that id list back as the `ANY(...)` list of the second and third
statements. Month and keyset pagination are applied afterwards, in memory, over those ids. There is no bound that does
not need a schema change: `line_performers` carries no date (the month lives on `service_sessions`), and a month-first
read is candidate (A), which was measured and deleted for moving about ten times the rows. A bound would need a date
column or an index (a migration), which this slice must not add. So an empty month still pays for the full lifetime
read; this is the manager-accepted single-table design (§5.6, §5.7), not an oversight, and it sits next to the
residual-risk paragraph below (examined rows grow with tenant size until statistics refresh) as a second, separate
growth term: lifetime rows per employee.

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
  (logged, not asserted, by the run's `57-2b cancellations table` line, which the recorded run reads as: 50 tenant rows,
  never analysed, `n_mod_since_analyze` 50). Position 50 lies inside `first-100` and outside `first-20`, so `first-20` stays a five-statement first page,
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

## Execution-time acceptance metric (owner decision 2026-11-23): method

**Owner decision, verbatim** (relayed by the manager on 2026-11-23): «نعم نقبل  القياس و نقبل وقت PostgreSQL لتسريع الشغل  (دا تصريح مني)».

Meaning, as the manager stated it: AC-57-2b-9 is accepted on the **measured PostgreSQL execution time** instead of the
wall-clock time that included the driver. Unchanged: the ceiling (< 200 ms), the six-statement case (`customer_name`
allowed **and** a cancelled line), the regular fixture (600 visits, 602 own lines, 6,020 colleague lines), the 66,002-line
fixture, stale and normal statistics, a first page and a cursor page. The earlier «mean CPU < 40 %» rule applied to
starting a wall-clock run and no longer gates the measurement.

**Method difference.**

| | Earlier sections (history) | This metric |
|---|---|---|
| What is timed | `withTenant` wall time: begin, every statement, driver round trips and materialisation, commit | The sum, over the statements of one page, of the top-level `Execution Time` that PostgreSQL itself reports in `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` |
| Sensitive to node-side CPU load | Yes (the 203.6 ms sample and the 257–1,043 ms run above) | Far less; the time is measured inside the server |
| Statements in the sum | 4, 5 or 6 data statements plus the shared authority reads | The 4, 5 or 6 data statements of the page only (see below) |

What is judged and what is only recorded (`__tests__/own-service-lines.{dbtime,phases,measure,perf}.ts`, driven by the two
spec entry files):

- **Judged:** for every page (first-20, first-100, cursor-100, deep-cursor-100, cancelled-20, cancelled-100,
  cancelled-deep-100) in each statistics state, every data statement runs under `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
  inside the same `readOnly` tenant transaction the reader uses, and `execution_ms_sum < 200` is asserted. Each page is
  explained 3 times and **every sample is judged** (no best-of, no retry until green). A sample at 200 ms or more is a
  recorded violation. The regular (untimed) suite logs the same lines for one sample per page and judges nothing.
- **Planning time:** `Planning Time` is recorded next to it (`planning_ms_sum` and `execution_plus_planning_ms_sum`)
  so the reader sees both numbers, but the judgement follows the owner's sentence and uses Execution Time only.
- **Six statements:** the run fails unless a first page and a cursor page each ran exactly five and exactly six
  statements in each statistics state (`kindViolations`, checked on the judged samples and on the diagnostic samples).
- **Diagnostic only, no assertion:** the wall-clock samples of the earlier method (first run and five warm runs per
  page, `elapsed_ms`, heap and RSS deltas) are still logged as `57-2b measurement`.
- **Not measured:** the nine shared authority statements of the route (context, months window, allowed columns) are not
  part of the page sum and are not timed by this harness; they are covered for correctness by
  `own-service-lines-http.spec.ts` only. The judged number is the page's data statements, as the owner accepted.

Stale-statistics acceptance, tightened (review finding «MCV absence does not prove statistics stayed stale»): an attempt
counts as stale only if the target tenant is absent from the three MCV lists **and** the `last_analyze` and
`last_autoanalyze` stamps of `service_sessions`, `service_lines` and `line_performers`, captured immediately before the
attempt's seeding, are identical before the measurement and again after the judged phase. Autovacuum analyses these
tables roughly a minute after a large insert, so the judged phase (db-time samples, then the plan checks) runs **first**,
and the validity check follows it directly; the long wall-clock diagnostic runs after the check and may see refreshed
statistics (its statistics are logged again as `57-2b statistics after diagnostics`). Up to five attempts are made to
establish the state; a rejected attempt discards only its own violations and is never a way to hide a slow sample, because
a sample is only discarded together with an attempt whose statistics were refreshed. The normal-statistics case builds its
own fixture when it runs without the stale case, so it can run by name.

Fixture-seeding order (same rows, same sizes): the 47 colleague cancellations (one real-path transaction each, the slowest
part of seeding) now run while the target tenant is still small, before the large batches, so the window between the
autoanalyze threshold and the judged phase is short. The sample line is excluded from the colleague cancellations
because the batches copy its status.

Plan checks (statement count, no join, no sequential scan, every scanned table loops = 1, on four tables): unchanged,
with one tolerance made explicit. When autovacuum has analysed the 50–150-row `service_line_cancellations` table, the planner
may legitimately read it sequentially, so the «no sequential scan» and «`company_id` Index Cond» checks are skipped for the
cancellations statement only (the other three tables, the join and loops checks stay). The run logs that table's analyse
state (`57-2b cancellations table`). The literal Index Cond check on id lists is still **not** claimed.

How to run and what to collect (run on the delivery head, one at a time, in the announced heavy-DB window, with `REDIS_PORT`
pointing at the private lane Redis; `POSPAY_57_2B_OUT=<file>` makes every recorded line also land in a file, because
vitest hides the console output of passing tests):

```
POSPAY_57_2B_PERF=1  POSPAY_57_2B_OUT=<file-1> pnpm --filter @pospay/api exec vitest run src/modules/orders/__tests__/own-service-lines-performance.spec.ts
POSPAY_57_2B_SCALE=1 POSPAY_57_2B_OUT=<file-2> pnpm --filter @pospay/api exec vitest run src/modules/orders/__tests__/own-service-lines-scale.spec.ts
```

Lines to collect from each file: `57-2b db-time` (one JSON line per page and sample: `label`, `page`, `sample`, `kind`,
`statements`, `execution_ms_sum`, `planning_ms_sum`, `execution_plus_planning_ms_sum`, `per_statement`), `57-2b
statistics before|after|after diagnostics|normal` (stale-state proof), `57-2b cancellations table`, `57-2b fixture`,
`57-2b measurement` (wall-clock diagnostics) and `57-2b plans`. Host CPU is recorded before each run, for the record only.

### Result of the run of 2026-11-23 on `7d9e6d20d` — regular fixture PASSED, 66,002-line stale case FAILED

**The acceptance is NOT met.** On the 66,002-line fixture with stale statistics, 4 of 21 judged samples were at or above
200 ms. Nothing was changed and no run was repeated to obtain a different result.

Head: `7d9e6d20d783165899fa54c43feeccbe9a09796a` (round-1 fixes committed, main merged, tree clean; the commit that
records these numbers is a docs-only child). Each run was made once, in the announced heavy-DB window, on the private
lane (`127.0.0.1:55404`). Host processor load before each run: 100 % on 6 of 6 samples (other sessions share the
machine; a repository-wide typecheck of this branch was also still running during the regular run). Regular run
13:45:41–13:50:17 Kuwait, 4 tests passed. Scaled run 13:51:08–13:55:18 Kuwait, 2 tests failed.

Fixtures: regular 600 own visits / 602 own lines / 6,020 colleague lines; scaled 600 / 602 / 65,400, 66,002 lines in the
target tenant. Stale state of the scaled run, verified by the tightened rule on attempt 0: the target was absent from
the three MCV lists before and after the judged phase, `n_mod_since_analyze` went 66,000 → 66,002, and the analyse
stamps of the three tables were unchanged; autoanalyze ran only later, during the wall-clock diagnostics.

`execution_ms_sum` per sample, in ms (regular: 4 samples per page; scaled: 3). **Bold** = at or above 200.

| Page (statements, kind) | Regular, stale | Regular, normal | 66,002 lines, stale | 66,002 lines, normal |
|---|---|---|---|---|
| first-20 (5, first) | 51.5, 27.3, 31.5, 32.5 | 8.1, 8.8, 8.3, 8.4 | 143.5, **350.8**, 116.3 | 9.2, 8.7, 11.5 |
| first-100 (6, first) | 34.1, 36.7, 57.6, 41.6 | 11.5, 14.8, 15.6, 22.4 | 158.6, 120.5, 128.9 | 19.9, 10.9, 10.4 |
| cursor-100 (5, cursor) | 36.2, 41.5, 38.1, 30.4 | 10.7, 10.9, 15.0, 15.1 | 109.6, 102.0, 111.7 | 10.6, 11.1, 19.6 |
| deep-cursor-100 (5, cursor) | 29.9, 40.3, 39.6, 35.0 | 10.1, 12.2, 10.5, 10.5 | 105.1, **224.6**, **237.7** | 10.0, 9.4, 9.3 |
| cancelled-20 (6, cursor) | 29.3, 39.0, 67.4, 37.9 | 8.4, 11.2, 12.4, 9.9 | **218.7**, 193.4, 121.1 | 9.1, 9.3, 12.0 |
| cancelled-100 (6, cursor) | 30.2, 42.2, 35.4, 28.1 | 12.0, 15.8, 11.6, 11.6 | 94.6, 101.0, 96.0 | 9.9, 10.0, 9.8 |
| cancelled-deep-100 (6, cursor) | 27.9, 28.8, 27.7, 28.3 | 12.5, 11.0, 11.2, 10.5 | 111.9, 193.8, 173.1 | 10.1, 9.5, 9.5 |
| Worst sample | 67.4 | 22.4 | **350.8** | 19.9 |

Planning time per page was 1.9–6.7 ms in every state and does not change any verdict.

Per-statement `Execution Time` of the four failing samples (rows removed by the filter in brackets):

| Sample | 1 `line_performers` | 2 `service_lines` | 3 `service_sessions` | 4 `service_lines` | 5 `service_sessions` | 6 cancellations | Sum |
|---|---|---|---|---|---|---|---|
| first-20 | 213.9 (65,400) | 38.2 (65,400) | 52.7 (65,400) | 24.2 (65,982) | 21.9 (65,981) | — | 350.8 |
| deep-cursor-100 | 0.8 (0) | 42.3 (65,400) | 68.0 (65,400) | 54.8 (65,902) | 58.6 (65,900) | — | 224.6 |
| deep-cursor-100 | 0.9 (0) | 52.1 (65,400) | 81.3 (65,400) | 51.9 (65,902) | 51.5 (65,900) | — | 237.7 |
| cancelled-20 | 0.8 (0) | 50.4 (65,400) | 66.7 (65,400) | 47.7 (65,982) | 52.9 (65,981) | 0.3 (49) | 218.7 |

What the numbers show, and what they do not:

- With stale statistics every id-list statement is one pass over the tenant's rows of that table (about 65,400 rows
  removed by the filter), as the earlier sections state. At 66,002 lines four such passes took 40–80 ms each in this
  run; the 2026-11-22 run on the same fixture recorded 9.5–12.3 ms for the same scans. The first statement of one
  sample took 213.9 ms where the other samples of the same statement took 0.8 ms.
- The wall-clock diagnostics of the same run are LOWER than the instrumented sums for the same pages: cancelled-20
  85–101 ms wall against 121–219 ms `Execution Time`; deep-cursor-100 78–119 ms against 105–238 ms. `EXPLAIN ANALYZE`
  times every row of every plan node, and that overhead on 65,000-row scans, on a host at 100 % load, is part of the
  measured figure. Reading, not a finding: this run does not separate the query's own cost from instrumentation and
  host load. Whether to judge with per-node timing off (`EXPLAIN (ANALYZE, TIMING OFF)`, which still reports the total
  `Execution Time`) is a method decision for the design approver and the owner; it was not tried.
- The scaled run's normal-statistics TEST is also reported as failed, but its own 21 samples are all at or below
  19.9 ms. The harness shares one `violations` array between the two cases, so the four stale violations were counted
  again. That is a harness defect to fix; it does not change the stale result.
- Wall-clock diagnostics (not judged), scaled run: stale 72–364 ms, normal 72–290 ms.

The earlier statement «The maximum-statement case has no accepted timing yet» therefore still stands: the regular
fixture is measured and under the bound in both states for five- and six-statement pages, first and cursor; the
66,002-line stale case is over it in four samples.

Raw files (outside the repository): `F:/Dev/Temp/57-2b/dbtime-regular-7d9e6d20d.jsonl` and
`F:/Dev/Temp/57-2b/dbtime-scale-7d9e6d20d.jsonl`.

### Correction to the conditions of the run above (learned afterwards, 2026-11-23)

The window of the per-node-timing run was 10:45:41–10:55:18 UTC (13:45:41–13:55:18 Kuwait). The other team sharing
this host later reported that one of its lanes had a database test process alive on its own cluster
(`127.0.0.1:55401`) from 10:27 to 10:52 UTC, and started another file at 10:55 UTC. Whether that process was working
or hung at exit is not known. The overlap may have affected the figures above; its effect is not established. The
figures are kept exactly as recorded, and **this first run is used neither as acceptance evidence nor for any causal
comparison** with the run below (manager decision, 2026-11-23). It is not repeated.

## Measurement tool corrected after the failing run: `TIMING OFF` (manager decision 2026-11-23) — method fixed before the run

The result above (per-node timing on: 4 of 21 samples at or above 200 ms at 66,002 lines with stale statistics, worst
350.8 ms) **stands as recorded**. It is not withdrawn, and this section does not claim that the cause of that failure
is established. The judged statement was changed AFTER that failing run, and that order is stated here on purpose.

**Decision (manager, design approver, 2026-11-23, option (a)).** The judged `EXPLAIN` runs with per-node timing off:
`EXPLAIN (ANALYZE, TIMING OFF, BUFFERS, FORMAT JSON)`. The PostgreSQL 16 documentation of `EXPLAIN` states that
`TIMING OFF` disables the per-node start-up and total timing — whose clock reads can slow the statement
significantly on some systems — while the total run time of the statement is still measured
(https://www.postgresql.org/docs/16/sql-explain.html). The total `Execution Time` is therefore still reported and is
what is summed.

**Method, fixed before running (nothing below may be changed after seeing a result):**

- One run per fixture with the new statement, on the private lane, in an announced heavy-DB window: the regular
  fixture (600 / 602 / 6,020) with `POSPAY_57_2B_PERF=1`, then the 66,002-line fixture with `POSPAY_57_2B_SCALE=1`.
- The same cases in the same order as the run above: stale statistics first (state proven by the tightened rule: the
  target absent from the three MCV lists and unchanged analyse stamps before and after the judged phase), then normal
  statistics; the same seven pages; first page and cursor page; five- and six-statement pages both required.
- For every sample the sum of `Execution Time` over the page's statements is computed, and **every sample must be
  under 200 ms** (three samples per page; no best-of; no rerun to obtain a different result).
- Recorded for diagnosis only: the plan of each statement (node types, rows, loops, rows removed by filter, buffers —
  per-node times are absent by construction), `Planning Time`, the wall-clock samples, and the host processor load
  before each run. Host load is NOT a condition of the run.
- The two cases no longer share a violations list: a stale-statistics violation is no longer counted again in the
  normal-statistics case (the harness defect noted above).
- If any sample is at or above 200 ms, AC-57-2b-9 stays FAILED and the merge stays blocked; the report then names the
  heaviest plan nodes with their row counts and the smallest remedy that needs a decision. No repeated measuring and
  no index or setting change on our own initiative.

### Result of the `TIMING OFF` run of 2026-11-23 on `11c7c3974` — regular fixture PASSED, 66,002-line stale case FAILED

**The acceptance is NOT met, and the corrected tool did not change the verdict.** At 66,002 lines with stale statistics
all 21 judged samples of the accepted attempt were at or above 200 ms (459.4–745.2 ms). No run was repeated.

Head: `11c7c39746a900cf3b021e6b09f987856d0fd38d` (the pushed code of `8f78adffb` plus the `TIMING OFF` statement and the
separated violation lists; no product code differs). One run per fixture in the announced window, private lane
`127.0.0.1:55404`. Host processor load before each run: 100 % on 6 of 6 samples, then 100,100,100,99,100,100. Harness
specs first: 12 of 12. Regular run 14:07:31–14:14:16 Kuwait (11:07:31–11:14:16 UTC), 4 tests passed. Scaled run 14:15:10–14:23:52 Kuwait
(11:15:10–11:23:52 UTC): the
stale-statistics test failed with 21 violations; the normal-statistics test passed (the cases are now separate).

`execution_ms_sum` per judged sample, ms. **Bold** = at or above 200.

| Page (statements, kind) | Regular, stale | Regular, normal | 66,002 lines, stale (accepted attempt) | 66,002 lines, normal |
|---|---|---|---|---|
| first-20 (5, first) | 24.5, 35.9, 26.8 | 7.9, 5.4, 4.6, 4.2 | **684.3, 660.6, 546.3** | 9.9, 10.7, 10.2 |
| first-100 (6, first) | 22.8, 41.1, 29.8 | 13.6, 4.7, 6.8, 6.8 | **544.4, 501.8, 533.9** | 12.2, 11.9, 13.4 |
| cursor-100 (5, cursor) | 21.1, 21.5, 29.7 | 30.5, 6.8, 7.8, 7.2 | **511.8, 515.4, 496.5** | 11.8, 10.2, 12.9 |
| deep-cursor-100 (5, cursor) | 22.6, 25.0, 20.3 | 10.0, 5.4, 7.6, 8.0 | **528.4, 582.1, 745.2** | 13.4, 10.9, 10.5 |
| cancelled-20 (6, cursor) | 28.2, 44.9, 22.5 | 15.4, 8.0, 7.2, 6.5 | **621.6, 465.0, 485.2** | 10.8, 10.8, 10.9 |
| cancelled-100 (6, cursor) | 33.3, 21.5, 29.6 | 10.3, 6.8, 9.4, 8.0 | **479.8, 459.4, 576.9** | 12.2, 18.0, 15.9 |
| cancelled-deep-100 (6, cursor) | 32.7, 22.0, 28.1 | 26.0, 6.9, 8.7, 8.3 | **563.2, 615.4, 516.9** | 30.6, 21.6, 12.6 |
| Worst sample | 44.9 | 30.5 | **745.2** | 30.6 |

Regular-fixture stale column: the accepted attempt was the second one (the first was discarded because autoanalyze
ran during its judged phase); its three samples per page are shown. The four samples of the discarded attempt were
20.1–62.7 ms.

Stale state of the scaled run. Five attempts were made, each seeding a NEW 66,002-line target tenant in the same
database. In attempts 0–3 autoanalyze of the three tables fired during the judged phase (stamps moved, about one minute
after each insert), so they were discarded under the rule fixed beforehand. Attempt 4 is the accepted one: analyse
stamps identical before and after the judged phase, `n_mod_since_analyze` 66,000 → 66,002. By then the database held
five target tenants of 66,002 lines each.

Heaviest plan nodes of the accepted attempt (one sample per page shown; the others are alike). All buffers were shared
hits, none read from disk; every node has loops = 1.

| Statement | Rows returned | Rows removed by filter | Shared hit blocks | `Execution Time`, ms |
|---|---|---|---|---|
| 1 `line_performers` by employee (`line_performers_employee_idx`, Index Cond) | 602 | 0 | 548 | 0.6–0.8 |
| 2 `service_lines` by id list (company-leading index, id list as Filter) | 602 | 65,400 | 66,976 | 106.7–154.6 |
| 3 `service_sessions` by id list (company-leading index, id list as Filter) | 600 | 65,400 | 66,804 | 123.6–244.8 |
| 4 `service_lines` details of the page (same shape) | 20 or 100 | 65,902–65,982 | 66,976 | 117.7–244.6 |
| 5 `service_sessions` customer names (same shape) | 20–100 | 65,900–65,980 | 66,804 | 110.0–133.1 |
| 6 `service_line_cancellations` | 1 | 49 | 3 | 0.2–0.3 |

What this run shows, and what it corrects:

- **The reading offered after the first run is not supported by this run.** With per-node timing off the scaled
  stale case is still over the bound. No comparison with the first run's figures is drawn (see the correction
  above): this run stands on its own.
- Host conditions of this run: the other team reports its last database test process stopped at 11:11 UTC; the
  regular run began at 11:07:31 UTC and so overlapped its tail for about four minutes (it passed); the scaled run
  began at 11:15:10 UTC. The other team then confirmed from its lanes' records: its database test process ran until
  11:11 UTC, so only the regular run overlapped it; during the scaled run (11:15:10–11:23:52 UTC) none of its lanes
  ran anything database-backed, one lane ran unit and typecheck gates (processor load, no database work) and one
  pushed and wrote replies. The scaled result therefore has no known database-test overlap; host processor load
  was 100 % and is recorded as a diagnostic only.
- The cost is the stale plan itself: four statements each walk the tenant's ~66,000 rows through a company-leading
  index and discard all but the wanted ids, about 67,000 buffer hits and 105–245 ms each on this host. On 2026-11-22
  the same four scans touched 1,792–2,255 blocks and took 9.5–12.3 ms; the fixture seeding order was changed since
  (colleague cancellations moved earlier) and this database held five large tenants, so the rows a scan visits are no
  longer physically adjacent. That difference is observed, not explained further here.
- With refreshed statistics the same pages take 9.9–30.6 ms at 66,002 lines: the id lists become index conditions.
- Staleness was short-lived in this configuration: in four of five attempts autoanalyze refreshed the three tables
  within about one minute of a 66,000-row insert, and the discarded attempts' later samples dropped to 8–20 ms.
- Wall-clock diagnostics of the scaled run (not judged): stale 103–1,342 ms, normal 91–245 ms.

Smallest remedies, each needing a decision; none was tried:

1. Make the id an index condition whatever the statistics say: an index or a statement shape for the four id-list
   reads (plan §5.1 bars an index, a statistics change and a planner setting without a fresh authorization; a new
   statement shape would need its own measurement).
2. Accept a stated limit: under 200 ms at the regular fixture in both statistics states and at 66,002 lines with
   normal statistics; above it for a tenant of that size only in the window between a bulk insert and the next
   autoanalyze (about one minute here).
3. Keep the acceptance as written: 57-2b's route stays unmerged until a remedy from item 1 is authorized and measured.

AC-57-2b-9 stays FAILED and the merge stays blocked. The earlier statement «The maximum-statement case has no accepted
timing yet» stands for the 66,002-line stale case; for the regular fixture the six-statement pages are measured and
under the bound in both states, first page and cursor.

Raw files (outside the repository): `F:/Dev/Temp/57-2b/timing-off-regular-11c7c3974.jsonl` and
`F:/Dev/Temp/57-2b/timing-off-scale-11c7c3974.jsonl`.

### Decision after the `TIMING OFF` run (manager, design approver, 2026-11-23)

The run is not repeated because of the overlap: the other team's database test process ended at 11:11 UTC, during the
regular run, which passed; the 66,002-line run began at 11:15:10 UTC, 4 min 10 s later, and failed 21 of 21 samples
(459.4–745.2 ms). **The failure stands.**

Authorized next, and nothing wider: one bounded LOCAL experiment with a new statement shape for the four id-list
reads, inside plan §5.1 — existing indexes only; company, business, `withTenant` and RLS kept; the same result shape,
cursor pages, authorized columns and the six-statement maximum; no index, statistics change, planner setting or
migration; the alternatives already rejected (the `LATERAL` / `OFFSET 0` rewrites of §5.2 and dropping `business_id`)
are not tried again. Order: the heaviest read first on large data; if the plan shape improves, baseline and candidate
of all four statements on two identical copies of one fixed fixture, by the same `TIMING OFF` method and statistics
state, without piling up a new large tenant per attempt; rows, buffers and plans kept; results compared for equality.
The final measurement (regular fixture and 66,002 lines, stale and normal) is made only after a fix is fixed in the
code. If no shape reaches the bound, the outcome is an evidence card for the smallest index or statistics exception —
the plan is not edited and the 200 ms bound is not relaxed.

### Re-reading the `TIMING OFF` raw file before the experiment (2026-11-23, no database used)

All 126 `db-time` lines of `timing-off-scale-11c7c3974.jsonl` were tabulated by attempt and statement. Attempts 0–3
stay discarded as acceptance samples (autoanalyze fired during each); they are read here only for the plan shapes
they show.

| Attempt | Statement | Samples | Execution ms | Rows removed by filter | Shared hit blocks |
| ------- | --------- | ------- | ------------ | ---------------------- | ----------------- |
| 0 | 1 `line_performers` | 21 | 0.5–95.1 | 0 or 65,400 | 24 – 66,476 |
| 0 | 2 `service_lines` (ids) | 21 | 2.4–51.2 | 0 or 65,400 | 1,812 – 2,258 |
| 0 | 3 `service_sessions` (ids) | 21 | 3.4–67.5 | 0 or 65,400 | 1,469 – 1,817 |
| 0 | 4 `service_lines` (page) | 21 | 0.4–43.0 | 0, 65,902 or 65,982 | 80 – 2,258 |
| 0 | 5 `service_sessions` (page) | 21 | 0.4–49.5 | 0, 65,900 or 65,980 | 70 – 1,792 |
| 2 | 2–5 | 21 each | up to 251.1 | 0 or about 65,400–65,982 | up to 66,975 |
| 3 | 2–5 | 21 each | up to 264.7 | 0 or about 65,400–65,982 | up to 66,969 |
| 4 (accepted) | 2 | 21 | 106.7–231.1 | 65,400 | 66,976 |
| 4 (accepted) | 3 | 21 | 120.4–270.2 | 65,400 | 66,804 |
| 4 (accepted) | 4 | 21 | 101.6–244.6 | 65,902 or 65,982 | 66,976 |
| 4 (accepted) | 5 | 21 | 103.4–194.6 | 65,900–65,980 | 66,804 |
| 4, normal statistics | 2–5 | 21 each | 0.3–15.4 | 0 | 79 – 2,368 |

What this shows:

1. **The tenant-wide read is not special to attempt 4.** In every attempt, while the statistics were stale, the
   id-list reads removed about 65,400 rows by filter; the samples with nothing removed in attempts 0–3 come after
   the autoanalyze of that attempt. The recorded `plans` lines of attempts 0–3 were captured after it and are not
   stale plans.
2. **The stale plan has two costs.** Through an index whose order follows the heap it touches about 2,000 blocks
   (28–67 ms per statement); through `service_lines_discount_proposal_binding_idx` or
   `service_sessions_business_day_idx` it touches about 67,000 blocks (100–270 ms per statement). Which one is
   chosen changed between attempts.
3. **The first statement is not exempt.** In attempt 0, with `reltuples` still 6,002, the `line_performers` read by
   employee also removed 65,400 rows and touched 66,476 blocks (95.1 ms). It has no id list. A change limited to
   the four id-list reads may therefore not close F6 in that state; the experiment measures it too and reports it.
4. **Heaviest reads:** statement 3 (`service_sessions` by ids, 270.2 ms worst) and statements 2 and 4
   (`service_lines`, 231.1 and 244.6 ms worst).

Rule for the experiment, fixed before any run: a statement shape counts only if the id is an index condition, with
no tenant-wide filter, on all four id-list reads in three states — stale statistics on a clean fixture, stale
statistics on the multi-tenant state that failed, and normal statistics — for id lists of 1, about 100 and 602,
measured as `pospay_app` inside `withTenant` with RLS on. One passing state is not evidence.
