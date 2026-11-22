# 57-2b — own service-lines reader: local proof (phase 2)

Governing text: `61-remaining/plan.md` §5 (§5.3 items 1–3, §5.4 stop rule, §5.6, §5.7) and `61-remaining/spec.md`
AC-57-2b-1…8. Base `be0505eba`. Private synthetic lane only (Postgres `127.0.0.1:55404`, default autovacuum,
`statement_timeout` 30 s from the lane). No migration, index, server/table setting, statistics target, planner
flag or raised timeout was added or used. The route, OpenAPI operation and clients are **not** added (§5.3 item 7).

## Status and manager decision

- Items 1 and 2 (200 ms, stale and normal statistics): met at the approved fixture and at the scaled run below.
- Item 3 (a) (fixed statement count, no join, no sequential scan, no table scanned more than once per statement):
  met, asserted in the suite.
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

Recorded as JSON by the spec (`57-2b plans`). Final reader, per page, five single-table statements: performer rows by
employee, lines by id, sessions by id (+ month window), line details, customer names (only when the column is
allowed), cancellations (only when a listed line is cancelled).

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
5 statements in every sample):

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
statement count is asserted at exactly 5 per page (independent of page size and tenant size). The examined rows are
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
5 statements per sample. All four scaled runs (2, 3, 4 and the one summarised above) passed every 200 ms assertion.

## Phase 3: route exposed

Recorded before the route was added: the manager's design decision of 2026-11-22, option 1 (above), and the scaled
evidence above. The route `GET /v1/staff/me/service-lines?month&cursor&limit` (personal session or `STAFF_POS` with a
live private-view window, `no-store`, one `readOnly: true` snapshot), the contract
`packages/contracts/src/orders/own-service-lines.ts` and its OpenAPI paths file were then added, replacing the local
placeholder schema and type. The OpenAPI registration in `packages/contracts/src/openapi.ts` and the generated
clients are the manager's step. HTTP spec `own-service-lines-http.spec.ts` (6 tests: personal session, own lines
only and a walkable cursor, uniform 400, `STAFF_POS` window expiry and dead operator, scope keys and session-less
access, DENY and unlinked employee, log privacy) and the contract spec pass.
