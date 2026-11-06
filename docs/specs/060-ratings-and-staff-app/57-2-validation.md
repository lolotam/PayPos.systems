# 57-2 validation record

Base: `da775eb5e5b62adcb48b26d1e55fdba1a2ce671f`. The first independent review
returned two P2 findings; their correction checks and fresh independent recheck
passed. This is not a merge receipt.

## Binding interpretations

- `late` follows the `date` column. `share_bps` is the caller's integer share.
- `line_id` and `cancelled_at` remain D-A7 context fields. UUID v7 reveals the
  recording instant; hiding `time` does not conceal recording/cancellation instants.
- Cursor carries only `line_id`; SQL resolves its sort tuple within the current
  performer, tenant, business and month. Cancellation retains anchor eligibility;
  removal, another business/month or an unknown anchor returns uniform 400.
- The device branch proves current authority; it does not narrow historical
  branches. Tenancy supplies inactive as well as active history branch names.
- Hidden tips return only month/status after authority and period checks; no tip
  read or aggregation occurs. Visible tips use the domain callback, without SQL SUM.

## Local environment

Fresh random local test credentials were created exclusively with `wx`, without
reading or copying another checkout's credentials. `.env` and `.env.test.local`
are ignored. Private containers belong to this worktree and lane `57-2-my-work`:
Postgres `127.0.0.1:55722`, Redis `127.0.0.1:56722`. Shared Redis and the ports
reserved for 68-1a were not used. The old worktree and backups were not touched.

## Verification evidence to date

- Frozen-lockfile dependency install and API dependency builds passed.
- Contracts and API typecheck passed after prerequisite packages were built.
- API lint passed; module-map check passed.
- Documentation lint: zero errors, 29 pre-existing TODO warnings.
- Contract tests: 12 passed. Domain month-window tests: 10 passed.
- OpenAPI and both clients generated; both `api:check` commands passed.
- Initial local slice tests: service lines 9, HTTP 10, tips 3, domain 10 and contracts 12:
  **44 passed**, with no remaining failed or skipped slice tests.
- Earlier integration run: 17 passed, three failed, eight skipped. Fixture-only failures
  attempted an unledgered performer deletion and reopening closed branch history;
  the fixture now uses the real performer-change use case and preserves closed
  history. HTTP setup once reported `OTP_DATABASE_UNAVAILABLE_CONNECTION_CLOSED`;
  subsequent real-session HTTP runs passed without an auth/database source change.
- Seeding 600 monthly tip rows exceeded the initial 300-second test timeout before
  measurement. Seeding now runs in bounded batches of ten; all 600 rows remain.
- An actual HTTP defect was fixed locally: guard refusals now receive `no-store`
  through a route-local filter delegating the existing error envelope. HTTP tests
  assert this on missing/admin sessions and rejected client-scope fields.
- Initial EXPLAIN assertions incorrectly assumed particular planner choices.
  Final assertions verify the observed existing tip and cursor indexes, without
  disabling sequential scans, forcing a plan or adding a migration.

## Representative performance receipt

`own-tips.spec.ts`, passing measurement receipt (2026-11-07): 601 service lines, 602 own
current-revision tip entries. Query and driver materialisation: **12.9569 ms**;
array materialisation: **0.0350 ms**; domain aggregation: **0.7685 ms**;
combined: **13.7604 ms**, below 200 ms. Heap delta: **644,272 bytes**;
RSS delta: **12,288 bytes**. Totals: CASH `2.100`, CARD `2.250`, with no dropped rows.

Both query statements and the cursor statement run with `EXPLAIN (ANALYZE, BUFFERS,
FORMAT JSON)` on the private lane. The test emits their complete plans, making the
receipt reproducible in CI. The cursor uses `line_performers_employee_idx` and
`service_lines_id_session_key`; tips use `session_tips_session_revision_idx` and
`session_tip_revisions_session_revision_uq`. A first page may scan the tiny fixture
where almost every row qualifies; its plan is retained rather than artificially
forcing an index.

`EXPLAIN (ANALYZE, BUFFERS)` from that receipt (milliseconds; shared reads zero):

| Statement | Planning | Execution | Shared hit blocks |
| --- | ---: | ---: | ---: |
| Tips | 0.937 | 6.407 | 3,634 |
| Service-lines first page | 7.315 | 5.390 | 83 |
| Service-lines cursor page | 5.104 | 5.887 | 92 |

## Outstanding delivery gates

The independent review gate passed before the single PR. Exact-head CI, the four
MergePilot panel receipts, Codex once on the final head, coordinated merge turn and
applicable verified backup/restore remain required. No CI, backup/restore, merge or
deployment receipt is claimed here. Correction-round budget has not been reset.

## Independent review and correction round 1 of 3

Astra high reviewed snapshot SHA256
`f13f745a100033c5f84d8043ef5d6993553b682e5fada50f17715d4184c3f0ec`.
[Review receipt](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa6b10cf3-6079-453b-8c1e-21af485e49f5%3Adelegate-task%3A8db7f515-2792-44d4-b16d-d4a89b910a41>).

1. P2: the query read `ss.late`, so an on-time visit with a next-day appended line
   incorrectly showed that line as on time. The projection now reads `sl.late`.
   This corrects the copied plan's source-column example without changing Q1:
   `late` still follows `date`. The regression creates the visit on time, appends
   a line the next day, and verifies false/true flags and their absence with date hidden.
2. P2: the initial foreign-context test stopped at authority refusal, so it did
   not prove query isolation or foreign-cursor refusal. The replacement creates
   actual lines and eligible employee/membership contexts in another business and
   another tenant, proves both reads succeed, then checks exclusion and uniform
   400 in both cursor directions. The finding was a test gap, not a proven leak.

The read-only reviewer did not run checks. The implementer corrects these small
findings in this session; no duplicate implementer or extra PR was started.

Correction checks: both affected integration files passed, **11/11** (8 service-line
tests plus 3 positive-control isolation/late-append regressions). API typecheck and
targeted lint passed. Current local slice coverage is **46 passing tests** across
the relevant runs: 8 service lines, 3 isolation/late, 10 HTTP, 3 tips, 10 domain and
12 contracts. Unchanged HTTP/tips/domain/contract receipts above remain applicable;
no full-suite or exact-head CI success is inferred from these local checks.

## Fresh independent correction recheck

A new Astra high reviewer accepted snapshot SHA256
`cc2f33f40432377ca58130ff4868d4055749088866d087206688005e7642e8bb`:
[Recheck receipt](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa6b10cf3-6079-453b-8c1e-21af485e49f5%3Adelegate-task%3A1694310c-15b5-4231-916f-563721d592ae>).
Both P2 findings are closed; no new findings require correction within the reviewed
scope. The reviewer read the complete snapshot and verified its hash, but ran no
tests or gates. The reviewed snapshot contained 2,806 changed lines, including all
production, tests, documentation and generated additions/deletions. This receipt
adds documentation only after that snapshot. One of three correction rounds used.
