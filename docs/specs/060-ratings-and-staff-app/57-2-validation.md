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

## Main update after opening PR #894

PR head `9ca23f180154d23804fc662e43c190578135ebb6` conflicted with main
`da16aae2c7cb315ee81f911ce637aab3b88cf267` (merged #882). The only conflict was
`owner-questions.ar.md`: both branches appended audit records. Local checkpoint
`checkpoint/57-2-before-main-9ca23f18` retains the original reviewed commit. The
resolution preserves the complete main audit followed by the complete 57-2 audit;
an append-only check verified both texts. No source conflict required resolution.
All original slice files except the combined audit retain their exact Git blob
hashes after regeneration. OpenAPI and all three clients were regenerated; menu
adds the same 192 generated lines previously added to admin/POS. Before this
receipt, the full main-relative diff was 3,010 changed lines, including menu.

API/contracts typecheck, all three client checks, API lint and module-map check
passed after the main update. Documentation lint passed with zero errors and
29 existing TODO warnings. Contracts tests passed 12/12. API slice retest passed
33/34: the representative tips test measured 602 rows in 34.4639 ms (query 34.0001,
materialisation 0.0224, aggregation 0.4414; heap delta 648,280 bytes, RSS delta zero),
then its first-page `EXPLAIN ANALYZE` failed with PostgreSQL `57014` statement
timeout. The lane role retains its existing 30-second statement limit. Investigation
used the unchanged query with a temporary diagnostic copy of the test that emitted
the estimated first-page plan before execution: 3/3 passed. The original test was
then run unchanged, without the diagnostic addition: 3/3 passed again. The temporary
copy was removed. The timeout was not reproduced and its cause remains unproven;
no timeout, dataset, assertion or production change was made to obtain either pass.
Post-update applicable local coverage is 46 passing tests across those runs, not a
single all-green full-suite or CI receipt.

Codex started automatically on PR opening, as recorded in
[its PR summary](https://github.com/lolotam/PayPos.systems/pull/894#issuecomment-6697676563).
No manual review trigger was sent. CodeRabbit reported a rate limit and performed
no review; no billing/configuration change or duplicate trigger was requested.
The conflicting head did not establish an Actions CI run. The main update and any
findings remain one consolidated push after the current reviews finish.

All four panel reviews completed on `9ca23f18`: Waleed_Bot (context outside the
diff), mohamed_Bot (security), MergePilot_Bot (cross-file consumers) and Hamza_Bot
(owner rules). The only published inline finding, nullable customer snapshots,
was rebutted with `packages/db/schema/orders.ts:19`: the actual source snapshot
`service_sessions.customer_name` is NOT NULL. The reply and resolution are
[recorded on the finding](https://github.com/lolotam/PayPos.systems/pull/894#discussion_r4498431848).
Codex's automatic review also completed on that head with no findings. Its receipt
does not satisfy the next head. The copied plan's stale session-level `late` source
examples are aligned to the accepted `service_lines.late` correction; Q1 is unchanged.
The consolidated main/client/documentation update is correction round 2 of 3.

Before pushing that round, main advanced to `319e8c637` (merged #893, 68-1a).
It was merged locally without conflicts and OpenAPI/admin/POS/menu regenerated
again. The main-relative full diff excludes 68 leave production, contracts and
history changes: those remain exactly main's content. The original implementation
commit remains unchanged in `git range-diff`; merge-resolution/generated/documentation
changes are checked separately in the full main-relative diff. These updates belong
to the same consolidated push; there was no empty commit or CI rerun request.

On the 68-1a base, API/contracts typecheck, all three client checks and module-map
check passed again. Contracts tests passed 12/12; service-line/isolation/HTTP/domain
rechecks passed 31/31. The unchanged tips test's 3/3 confirmation above remains
applicable. The original 23 API/contract source and test blobs are unchanged from
the independently reviewed checkpoint. API lint and documentation lint receipts
above apply to the same source, with only the documented plan/receipt additions.

## CI failure investigation and correction round 3 of 3

On `5b770810`, [CI run 42308596357](https://github.com/lolotam/PayPos.systems/actions/runs/42308596357)
failed only API shard 4: 1,740 tests passed and the first-page `EXPLAIN ANALYZE`
in `own-tips.spec.ts` reached PostgreSQL `57014` at the existing 30-second statement
limit. Tips query/materialisation/aggregation passed at 33.73422 ms for 602 entries.
The other API shards, check, worker integration and images passed; app build was
skipped after the API failure and ci-gate failed accordingly. Mobile passed.
The CI run lasted 12 minutes 15 seconds. No rerun or workflow change was requested.

A disposable diagnostic clone retained the initial 1–2-row statistics while
seeding the same 600 real-use-case visits. The original query then reproduced the
30-second timeout. Its estimated cost was 34.53, with nested loops combining
performers and sessions before filtering lines. Activity samples through 29.6
seconds showed no blockers or wait event. Normal-statistics cost was 139.88.
Actual CI statistics/plan were not captured, so this explains a local reproduction,
not a proven reconstruction of the CI planner state.

Two local LATERAL/OFFSET experiments were rejected: one still timed out; the other
took 632.866 ms and failed the cursor-index assertion, retaining repeated broad
scans. Neither was committed or pushed. Their diff/plans remain in the ignored
diagnostic directory. The production query was restored byte-for-byte to `5b770810`.

[PP-136 advisor receipt](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa6b10cf3-6079-453b-8c1e-21af485e49f5%3Adelegate-task%3A0bcf7cad-07d0-4505-8a1b-ada5f680bdf2>)
changed the approach to the repository's post-seed ANALYZE convention, also used
by `discount-proposals-explain.spec.ts` and `attendance-board-performance.spec.ts`.
The advisor disclosed one shell read contrary to its brief; this advice is not a
code-review or gate receipt.

The correction refreshes statistics after the complete seed, without changing
production SQL, data volume, timeouts or planner settings. A refreshed tips plan
may scan the tiny tip table where almost every entry qualifies; the current-revision
index assertion and exact totals remain. The entry-table-index-only assertion was
removed after observing this legitimate 10.4696 ms plan. Page/cursor EXPLAIN checks
remain, and an actual first-page query/driver-materialisation measurement now checks
21 limit-plus-one rows, cursor validity and time below 200 ms, recording heap/RSS deltas.
The controlled stale-statistics diagnostic passed 3/3 after the refresh, using the
unchanged production query. EXPLAIN execution: tips 7.287 ms, first page 6.082 ms,
cursor 5.818 ms; planning 2.238/10.819/7.985 ms respectively. Shared hit blocks:
3,634/72/81. Both cursor index assertions passed, and the actual first-page query
and materialisation satisfied the 200 ms bound with 21 rows. The temporary source
file was archived outside source and removed; its disposable database was closed.
The original test file then passed 3/3 without the diagnostic fixture; API typecheck,
targeted lint and diff whitespace checks passed. The 46-test applicable local
coverage remains across the relevant runs; no extra unique tests are inferred from
diagnostic copies. Temporary diagnostic DDL/files are not part of the PR.

Fresh Astra high independently accepted this correction with no actionable findings:
[Correction review](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aa6b10cf3-6079-453b-8c1e-21af485e49f5%3Adelegate-task%3A23fb3cbc-35c9-4e72-bdc3-f7a5fa1827b9>).
It read the complete 526,931-byte snapshot and verified SHA256
`186214d639868d069f0543cf0e0e347f8307567c0d07fef331da4c8adfaa2382`,
including the unchanged production-query blob. It ran no tests/checks and did not
approve CI or merge. The actual CI failure cause remains unproven. Round 3 of 3 is
the final consolidated correction; new-head CI/panel receipts remain required and
Codex is reserved for the final head. No budget reset or merge waiver applies.
