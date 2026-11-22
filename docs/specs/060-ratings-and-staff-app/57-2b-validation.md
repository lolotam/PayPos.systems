# 57-2b — own service-lines reader: local proof (phase 2)

Governing text: `61-remaining/plan.md` §5 (§5.3 items 1–3, §5.4 stop rule, §5.6, §5.7) and `61-remaining/spec.md`
AC-57-2b-1…8. Base `be0505eba`. Private synthetic lane only (Postgres `127.0.0.1:55404`, default autovacuum,
`statement_timeout` 30 s from the lane). No migration, index, server/table setting, statistics target, planner
flag or raised timeout was added or used. The route, OpenAPI operation and clients are **not** added (§5.3 item 7).

## Status

- Items 1 and 2 (200 ms, stale and normal statistics): **met**, with a wide margin.
- Item 3 (a) (no join, no table read once per outer row, no sequential scan): **met**.
- Item 3 (b) (where an id probe exists, the id is an index condition): **not met**. §5.4 applies: the checkpoint
  stops here and the route is not added. Evidence below; the decision is the manager's.

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

**Chosen: (B).** Three to four times faster, one tenth of the memory, and its cost does not grow with the colleagues'
volume (it grows with her own history instead). (A) was deleted.

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
