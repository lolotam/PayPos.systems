# Row 61 with 57-2b and 57-4 — one PR: umbrella delivery plan

> **Status: PLAN ONLY (PP-204).** No code, test, migration, ADR, module-map or canonical-spec edit is made by this
> document; no branch, PR, deploy, database operation or experiment. `../plan-61.md` §5–§7 stay the per-slice design
> of row 61, `../spec.md` Part A the design of 57-2b and 57-4. This plan adds the single-PR order, the gates with
> their evidence, the 57-2b design submission, the migration rules, sizes and the open approvals.
>
> **Base:** canonical docs and code read with `git show` at `origin/main` `a32a6a211b383657cd65e180cd8a2c4aa3e9e666`
> (journal tail `0238`). These files sit on the local commit `2053a63130ac4751fede1c0d549b700535978bee`, whose tree is
> older than main. Spec: `./spec.md`.

## 1. The owner's instruction and what it replaces

Relayed by the manager on 2026-11-22, verbatim: «لية هما شرايح انا عايزهم كلهم في PR واحد بشريحة واحة Minimax 3.1 open
code حتي النهاية medium» and «خلي fabel يعدل الخطة ويضيفة ضمن الخطة الجديدة وال spec ويطحط في دورة المظبوط».

**Settled:** one PR; one implementation owner on OpenCode, from start to merge; tier Medium. The
former slices become **ordered checkpoints (commits) inside that PR**. 57-2b is added in its right place.
**Owner transfer (2026-11-22, manager):** MiniMax M3.1 Flash delivered checkpoint 61-2a (`c362b10f3`) and the
61-1c seed (`5adee26f1`, transferred as `bfe92d16b`) before its quota ran out; GLM 5.3 Flash continues the same
thread, worktree, plan and checkpoints with no scope change.
**Second transfer (2026-11-22, Waleed, in the delivery thread: «كمل أكتب الكود كلة ونراجع في الاخر»):** GLM 5.3
Flash delivered checkpoint 61-1d (`ab25b78ca`); Claude on the Claude Code harness (Opus 5.5, then Fable 5.2)
continues from checkpoint 61-1e in the same thread, worktree, plan and checkpoints, with no scope change. Guard
skills and the code review run once, after checkpoint 14.

| Earlier rule or record | What the instruction does to it | Still binding |
|---|---|---|
| One slice per PR (`CLAUDE.md` §10; the 14-row split of `../plan-61.md` §4) | Replaced by one PR for this work | Each checkpoint keeps its own behaviour, stop line and tests |
| PP-192 (600–900 hand-written production lines, and only without a migration or a sensitive permission) | Overridden for this PR | PP-112: the brief states an expected size, and twice that is refused (§8) |
| PP-195 tier rule (a migration or a permission makes a task Heavy) | The owner names Medium | PP-129 for staging migration (§6); PP-198's guard skills; no open P0/P1 at merge |
| 57-2 two-PR authorization (`../57-2a-manager-authorization.ar.md`: A then B, the same Codex session) | B is delivered inside this PR by the implementation owner | Everything else in it: B's design approval before any B code or experiment, P1 fixed before the route is exposed, the 200 ms bound, no migration/index/config, B's size bounds (§5.5) |
| This thread's earlier answers («57-4 + 61-3 في PR واحد», «57-4 يستنى 57-2b زي ما هو») | Superseded: everything is one PR, and 57-2b is inside it | The order 57-2b → 57-4 → 61-3 |
| Waves, X1/X2/X3 pairings and per-slice tier proposals of the previous revision | Withdrawn | — |

The owner gave no size number and named no mechanism for the gate of §4; neither is assumed here.

## 2. What changed on main since `plan-61.md` (verified at the base)

| Fact | Effect |
|---|---|
| 61-1a #1138 (`4ab01c808`) and 61-1b #1135 (`336c5ea77`) are merged; the 61-1b guard is live on staging (manager's M3 receipt: running API SHA tag `336c5ea77253af9815ad39f1b35476367c250308`, deploy `LgVwPoeNfyQjqRqCxVQWx`) | 61-1c's precondition holds |
| 61-2a is implemented and rebased onto the base in its own worktree (head `c362b10f3`: 330 production, 902 test, 366 generated, 45 docs lines; tests under way) | It is checkpoint 1 of this PR and is completed, not rewritten |
| `apps/api/src/modules/identity/__tests__/ratings-read-grant.spec.ts` inserts the permission row itself | 61-1c must remove that insert (the seed would collide) and add the system-role cases |
| 57-2a merged as #896 (2,136 changed lines in all); 57-2b, 57-4 and 57-5 are not built; `apps/pos/src` has no `my-work` folder | 57-2b and 57-4 are built here; 57-5 stays out |
| The worker's rating sends are dormant: `apps/worker/src/main.ts:212` wires `closedRatingClaimsLifecycle()` (`eventTypes: []`), and the only writer of `rating_requests.token_hash` is the worker's claim (`rating-claim.repository.ts`) | No rating link can exist on a deployed build until 59b-3's activation change (§4) |
| `apps/worker/src/outbox/known-event-types.ts` lists types acknowledged **without** a consumer | `LowRatingSubmitted` is never added there; 61-1h registers its consumer in `main.ts` |
| Dispatcher poll 1 s, delivery timeout 60 s | SC-004's 2 minutes has wide margin |
| No worker phone-mask helper exists | 61-1h writes its own pure `phoneLast3` with parity samples against API `maskPhone` |
| `apps/admin/src/notifications/model/render-notification.ts` is 255 lines | 61-1f adds `model/low-rating-notice.ts` |
| Migration `0239` is being coordinated on PR #1189 (55-1d + 50-5) | §6: this PR's migrations are generated only after it lands |

Not re-verified (from `../plan-61-1.md` §7.2): an API without 61-1e fails the whole inbox page on an unknown template.
Checkpoint 61-1e proves it with its first test.

## 3. The order inside the one PR

One branch, one PR, continuing from the existing 61-2a worktree. Each checkpoint is one or more commits that build,
pass their own tests and the local gates before the next one starts. The PR is opened once, after checkpoint 14.

| # | Checkpoint | Starts after | Notes |
|---|---|---|---|
| 1 | **61-2a** staff rating summary API | — | Exists; finish its tests. First because 61-2b and the card build on it |
| 2 | **61-1c** permission seed | 1 | Schema, catalog, defaults, tests now; migration artifacts per §6 |
| 3 | **61-1d** `LOW_RATING` kind + ledger | 2 | Same |
| 4 | **61-1e** the two templates end to end | 3 | First test: unknown-template behaviour of the current inbox |
| 5 | **61-1f** admin renders the notice | 4 | |
| 6 | **61-1g** comment readers (worker identity) | 2 | |
| 7 | **61-1h** worker consumer | 3, 4, 6 | Leaves `closedRatingClaimsLifecycle()` wired exactly as it is |
| 8 | **61-1i** emit and list | 5, 7 | Built as designed; its release condition is §4 |
| 9 | **61-2b** ratings list API | 1, 2 | §6's `EXPLAIN` rule |
| 10 | **61-2c** averages API | 9 | |
| 11 | **61-2d** ratings screen | 9, 10 | |
| 12 | **57-2b** own service-lines API | **§5's design approval recorded** | No B code or experiment before that record |
| 13 | **57-4** «شغلي» screen | 12 | |
| 14 | **61-3** column lift + rating card | 1, 13 | |

Hard dependencies: 61-2a first; 57-2b → 57-4 → 61-3; inside 61-1 the order above. Two things are named once:

- **Coupling.** In one PR, checkpoint 12's acceptance tests and stop rule (§5.4) also hold checkpoints 1–11,
  including the 61-1 path that 59b-3's gate waits for. The approval is therefore requested now, not at checkpoint 12.
- **A stop is a stop.** If a checkpoint cannot meet its acceptance, the owner session stops and reports to the
  manager with the exact head; it does not skip the checkpoint, shrink it or reorder around it.

## 4. Gates: evidence, and the 61-1i condition in one PR

| Gate | State |
|---|---|
| **G1** 61-1b live before the permission seed (M3, PP-207.4) | **Satisfied** (§2) |
| **G2** 61-1e live on API and worker before any `low_rating*` inbox row can exist | Met by one release: the three services ship from the same merge, and no row can exist while sends are dormant |
| **G3** consumer (61-1h) and admin renderer (61-1f) live before rating sends activate | **Approved by Waleed (PP-219).** Merge the single PR with the current issuance lock in place. Prove rollout and delivery before wider activation. |
| **G4** permission before its readers | Met by checkpoint order |
| **G5** 57-2b design approval before any B code | **Approved for local implementation and proof** with §5.7's conditions. Performance and privacy acceptance are pending. |
| **G6** Fresh staging rollback snapshot and verified restore immediately before `migrate` (PP-129) | Applies to the separately authorized staging migration. Backup and verified restore are optional at PR merge unless a separate requirement applies (§6). |
| **G7** 59b-3 activation | Out of scope; stays a separately reviewed change |

### The 61-1i condition

**The literal text.** `../spec.md` row 61-1i: depends on «61-1h and 61-1f **deployed**»; `../plan-61.md` §4: «61-1h
before 61-1i (consumer before producer)» and «61-1i … 61-1h and 61-1f **deployed**». One atomic PR merges the
producer together with its consumer and renderer, so «already deployed when the producer merges» is impossible.

**What the gate protects.** That no `LowRatingSubmitted` is produced while no worker can compose the notice and no
admin can render it.

**What the source shows today (an existing guarded mechanism, not a new one).**

- A rating is accepted only through a link whose hash is stored on the request
  (`drizzle-rating-submission-transactions.ts` matches `token_hash`).
- The only writer of `token_hash` is the worker's rating claim, and the shipped worker installs
  `closedRatingClaimsLifecycle()`: it subscribes to no event and claims nothing. Requests stay `SCHEDULED`.
- `../spec.md` (dormancy of the shipped composition): no environment flag opens the scheduler; the active factory is
  wired only by 59b-3's reviewed activation change, «after 60-1, 60-2, 61-1». The test
  `runtime_stays_dormant_with_valid_token_settings` (`apps/worker/src/shared/otp-startup.spec.ts`) pins it.

The shipped composition prevents issuance of new rating links. It does not prove that a particular database has no
earlier unconsumed, unexpired links. If none are present in a target, no rating can be submitted there until
59b-3 is activated. The canonical spec places that activation after 61-1 is deployed and verified.

**PP-219, approved by Waleed.** Merge 61-1i with its consumer and renderer while the existing issuance lock is closed. The deployment evidence gates 59b-3 activation.

1. The PR changes nothing in the dormancy: `main.ts` keeps `closedRatingClaimsLifecycle()`, and the dormancy test is
   green on the PR's exact head (a merge condition).
2. After the PR's staging release, a DEP-1 receipt shows API, worker and admin running the merge SHA and worker
   `/ready`. That receipt is «61-1 deployed».
3. Before a target release, a separately authorized read-only DEP-1 check confirms there is no request with a set
   token hash, no consumption time and an expiration in the future. Record only the absence or count and the check
   time, without tokens or row data. If any exist, stop the release and re-evaluate.
4. `spec.md` AC-1i-5 (the staging SC-004 measurement) moves to a controlled staging activation check for 59b-3,
   after confirming consumer and renderer versions and before wider activation. Inside this PR, SC-004 is covered
   by an integration test from submit through both outbox hops to the stored inbox row.
5. Keep the planned `LOW_RATING` row in Alert Rules. Customers start generating alerts only after the separately
   authorized activation. PP-219 changes the delivery gate and does not itself authorize a release or activation.

## 5. 57-2b — query-hardening design submission

> Fable submitted this design. The manager approved the bounded local proof in §5.7. Performance on the acceptance
> fixtures remains unmeasured.

### 5.1 What must not change

The contract and decisions of 57-2: FR-A01 (`GET /v1/staff/me/service-lines?month&cursor&limit`), D-A2, D-A7, D-A8,
D-A9, D-A13, FR-A06, FR-A06b; the manager's D1–D3 and Q1–Q6 rulings (`late` travels only with `date`; the device
branch proves authority and does not narrow history; cursor = `line_id` resolved server-side with one uniform 400;
`line_id` and `cancelled_at` are context fields); the shared authority and context that 57-2a merged
(`queries/own-work-context.ts`, `readOwnEmployee`, `readOwnServiceSessionsAccess`). No migration, index, server or
table setting, statistics target, planner flag or raised timeout.

### 5.2 The finding to close (P1 of #894, `discussion_r4498824739`)

Recorded evidence (`archive-894-2f8858d4/tenant-lag-report.md` and its plan files, in the 57-2 briefs archive):

- With normal statistics the original statement ran in about 6 ms (hash joins).
- For a tenant absent from the three `company_id` MCV lists (default autovacuum, no manual `ANALYZE`) the planner
  estimated one row and chose nested loops whose inner scans used `company_id` as the **only** index condition
  (`service_lines_recorder_idx`, `service_sessions_recorder_idx`, `service_lines_id_session_key`), with the line and
  session ids as join filters. The same 600-visit data hit the 30 s statement timeout.
- Two rewrites were already rejected on evidence: `LATERAL` with `OFFSET 0` barriers, in one and in two layers.

**Reading of the cause.** When the estimate for a tenant is one row, every index that starts with `company_id` costs
the same to the planner, so a probe «by id» may be executed as a pass over all of the tenant's rows. Any plan that
probes a table once per outer row can therefore become quadratic. Naming an index in a test does not prevent it.

### 5.3 Acceptance (what an approved implementation must prove)

1. **Stale-statistics regression, kept in the suite:** populated background tenants, then a target tenant absent
   from the MCV lists of `service_sessions`, `service_lines` and `line_performers`, **no `ANALYZE`** after its
   insert. First page and a cursor page each complete in **under 200 ms** including driver materialisation, with heap
   and RSS recorded, on the approved fixture of **600 visits / 602 own lines**. The statistics state and the plans
   are recorded with the result.
   **Superseded for timing (2026-11-23):** the operative timing rule is `spec.md` AC-57-2b-9 — the 200 ms bound is
   judged on the sum of PostgreSQL `Execution Time` over the page's statements, in an explicit run on the delivery
   head, at the regular fixture and at 66,002 lines; wall-clock time including the driver is a diagnostic only. The
   sentence above is kept as the original method.
2. **Normal-statistics run** of the same fixture, also under 200 ms. `ANALYZE` may prepare only this run.
3. **Plan evidence, not index names:** no table is read once per outer row through a tenant-wide scan; where a probe
   by id exists, the id is an index condition, not a join filter.
4. **Privacy and scope:** only her current-performer lines are returned; a hidden column is never selected for the
   response (absent, not `null`); no customer phone, colleague id or name, rating or comment is selected at all; the
   log-capture and schema tests of 57-2 hold.
5. **Contract tests:** ownership and removal, cancelled lines, ties in the sort tuple, foreign business or tenant
   cursor → uniform 400, a late line under its own date, inactive and transferred branches, `share_bps`, month window
   and `staff_months_back`, personal and `STAFF_POS` sessions with the private-view window, `no-store`.
6. **Isolation:** RLS stays the tenant boundary (every statement inside the read's `withTenant` transaction); a
   positive control in a foreign tenant and a foreign business before each exclusion assert.
7. **Exposure order:** the route, OpenAPI operation and generated clients are added only after items 1–3 pass
   locally.
8. **Closure:** the PR description links `discussion_r4498824739` and attaches the proof of items 1–3.

### 5.4 Stop rule

If the acceptance cannot be met inside §5.1's limits, checkpoint 12 stops and the manager is told. An index, a
migration, a configuration or statistics change, a planner setting or a relaxed bound each needs fresh evidence and
an explicit authorization first. P1 is never deferred to an issue.

### 5.5 Fixed size bounds (approved earlier, in ALL changed lines)

57-2b: expected **1,800**, refuse above **3,600**; A + B together at most **5,600**. A merged at 2,136, so B's
effective ceiling is **3,464**. B is measured by its own commit range inside the PR and is not folded into §8's
production/test split.

### 5.6 Candidate approach — unproven, for the approver to accept, change or reject

**Principle.** Take the join order away from the planner: read each table a **fixed number of times per request**,
each time in a single-table statement, so the worst plan for any statement is one pass over that tenant's rows in
one table and no plan can multiply two tables.

**Shape (all inside the one read transaction, after the shared authority check):**

1. Sessions of the session's business in the month: `id`, `business_date`, `occurred_at`, `branch_id` only.
2. Line ids of those sessions: `id`, `session_id` only.
3. Her performer rows among those line ids: `line_id`, `share_bps`.
4. In the query layer: intersect, order by `(business_date, occurred_at, line_id)` descending, resolve the cursor
   against that ordered set (not a member → the uniform 400), keep `limit + 1`.
5. Details for at most `limit + 1` of **her** lines: the allowed line columns, the cancellation instant, and the
   customer name only when `customer_name` is allowed.

Steps 1–3 carry only ids and sort keys, so no colleague's amount, name or customer ever reaches API memory. Sorting
and paging in `queries/` is read orchestration, not business arithmetic, and imports no `domain/`.

**Known costs and open points of the candidate:**

- Steps 1–2 grow with the **business's** month, not only with her lines. The approved fixture does not fix that
  volume. **Proposed, needs approval with the design:** add same-business colleagues at ten times her volume.
- It assumes an id-list filter is evaluated without a per-row linear search and that large id arrays stay cheap to
  bind. Both are to be shown by the acceptance plans, not assumed.
- It is several statements where the original was one, all under the 200 ms rule.

**Not proposed without authorization:** a supporting index or a denormalised date on `line_performers`; extended
statistics or per-table autovacuum settings; any `SET LOCAL` planner or plan-cache setting; a relaxed bound.

### 5.7 Manager design acceptance for local proof

The manager accepts §5.3 and authorizes testing the candidate on the private synthetic lane, including the
tenfold same-business colleague fixture. Try an employee-scoped starting set where the existing
`line_performers_employee_idx` supports it. Compare plans and timings before choosing the reader.
Keep authority, keyset membership and field projection in one read-only snapshot using the existing
`withTenant` read-only option. Verify stable ordering and the uniform cursor rejection without dropping rows or
selecting other employees' details. Refresh the data and timing receipts after any material query change.
The route, OpenAPI and clients stay outside the change until performance, privacy and query-plan acceptance pass.

## 6. Migrations and the list index

- The PR carries **two migrations**, in this order: 61-1c (permission seed, shape of 0167 and the newer
  `0236_2026-11-21_imported-refunds-permission.sql`), then 61-1d (CHECK `alert_rules_kind` widened as 0219 did, plus
  the `low_rating_notices` table with RLS and grants). A third exists only if the rule below fires.
- **No provisional numbers.** `0239` is coordinated on PR #1189. This PR builds and tests its schema changes on its
  own private cluster; the numbers, `pnpm db:generate` and the snapshot and journal entries are produced only when
  the manager grants the lane, from live `main`, 61-1c first, then 61-1d, then the optional index. The journal and
  the snapshot chain stay consecutive; a branch behind `main` fails `migration-chain:check` until it is updated.
- **Before staging migrate:** a fresh rollback snapshot and restore check (PP-129). The 2026-11-17 owner override
  makes pre-merge backup and verified restore optional unless a separate task or operation requirement applies.
  No SQL reverse is planned; all three are expand-only.
- **The `EXPLAIN` rule for 61-2b** (decided by measurement on the PR's private cluster, before the query's final
  form): at least 50,000 ratings across 20 branches of one business plus a second tenant, `ANALYZE` run; the real
  keyset page for (1) business-wide, (2) one branch, (3) business-wide + one employee, (4) one branch + one employee.
  An index `(company_id, business_id, submitted_at, id)` on `ratings`, created `CONCURRENTLY` (shape of 0195), is
  added **only if** a plan shows a sequential scan or a sort that grows with the date range. Expectation, not a
  decision: combination 1 is the likely trigger. The owner session tells the manager before generating it.

## 7. Per-checkpoint design, tests and stop lines

Design of record: `../plan-61.md` §5 (61-1c…61-1i), §6 (61-2a…61-2d), §7 (61-3); `../spec.md` A.5 and Part A for
57-2b and 57-4; §5 above for 57-2b's hardening. Differences and additions only:

| Checkpoint | Difference from the design of record | Tests (`spec.md` §4) |
|---|---|---|
| 61-2a | Complete as built at `c362b10f3`; no redesign | Its own spec in the 61-2a worktree |
| 61-1c | Edit `ratings-read-grant.spec.ts` (§2); confirm whether the permission-code enum reaches the generated clients | AC-1c-1…5 |
| 61-1d | Update `packages/db/src/__tests__/rls-alert-rules.spec.ts:128` to a kind that stays unsupported; fix the comment at `packages/domain/src/alert-rules.ts:2` | AC-1d-1…5 |
| 61-1e | First test: unknown-template behaviour of the current inbox | AC-1e-1…5 |
| 61-1f | New `model/low-rating-notice.ts`; `render-notification.ts` only dispatches | AC-1f-1…4 |
| 61-1g | None | AC-1g-1…5 |
| 61-1h | Own `phoneLast3`; consumer registered in `apps/worker/src/main.ts` without touching the rating-claims lifecycle; the five `# Planned:` module-map comments become real `reads` lines; `docs/module-map.yaml` regenerated | AC-1h-1…8 and the dormancy test |
| 61-1i | The staging measurement moves per §4; the end-to-end integration test is added here | AC-1i-1…5 |
| 61-2b | Builds on 61-2a's wiring in `customers.module.ts`; §6's rule; ADR-0011 addendum withdrawing §8 | AC-2b-1…6 |
| 61-2c | Reuses 61-2b's access reader | AC-2c-1…4 |
| 61-2d | Lovable base style; check whether spec 074's navigation model (074-1/074-2, merged) owns nav items and register there if so | AC-2d-1…4 |
| 57-2b | §5; `queries/own-service-lines.query.ts` (split so no file passes 300 lines), the route added to `http/own-work.controller.ts`, contracts `orders/own-service-lines.ts` and its OpenAPI file, a separate performance spec | AC-57-2b-1…9 |
| 57-4 | `apps/pos/src/my-work/{api,model,ui}` reached from `apps/pos/src/personal-staff`; generated hooks only (tips, service lines, `/v1/staff/me/private-view` and its `/touch`); the PIN step, idle close, throttled touch and cache clearing as one reusable piece | AC-57-4-1…8 |
| 61-3 | The card is a component under `apps/pos/src/my-work/ui/` on 57-4's screen, inside the same private view | AC-3-1…3 |

Local gates at every checkpoint (`CLAUDE.md` §1 step 3): typecheck, lint, `pnpm lint:docs`, boundaries,
`pnpm module-map:check`, the checkpoint's own tests; database suites one at a time on the private lane cluster. The
PR is reported «implementation complete, pending `ci-gate`».

One author owns every file here, so the previous overlap table is reduced to two rules: generated files
(`openapi.json`, the three `schema.d.ts` clients, `docs/module-map.yaml`) are regenerated, never hand-merged; and
`packages/notifications` templates are one-at-a-time with 59b-3 (no 59b-3 PR is open on the base).

## 8. Size

Calibration from merged work (production / test / generated): #1135 67 / 342 / 74; 61-2a 330 / 902 / 366; #937
72 / 210 / 28,073; #946 246 / 591 / 2; a permission-seed migration's snapshot is about 30,800 lines (0236).

| Checkpoint | Production | Test | Generated |
|---|---|---|---|
| 61-2a (measured at `c362b10f3`) | 330 | 902 | 366 |
| 61-1c | 45–70 | 180–260 | ~31,000 snapshot + journal |
| 61-1d | 100–140 | 260–340 | ~31,000 snapshot + journal; ~80 |
| 61-1e | 240–300 | 380–480 | 350–450 |
| 61-1f | 110–140 | 220–280 | 0 |
| 61-1g | 140–170 | 350–450 | 0 |
| 61-1h | 420–500 | 650–850 | ~10 |
| 61-1i | 80–110 | 300–380 | 0–40 |
| 61-2b | 280–340 | 550–700 | 350–450 (+ ~31,000 if indexed) |
| 61-2c | 140–180 | 300–400 | 300–400 |
| 61-2d | 300–360 | 260–340 | 0 |
| 57-4 | 350–450 | 450–600 | 0 |
| 61-3 | 110–140 | 220–300 | 0 |
| **Sum without 57-2b** | **2,645–3,230** | **5,022–6,282** | **~64,000** (~95,000 if indexed) |
| 57-2b | measured in ALL changed lines: expected 1,800, ceiling 3,464 (§5.5) | | |

- **Hand-written, without 57-2b:** about 7,670–9,510 lines; midpoint **8,590**. With 57-2b's expected 1,800 the PR
  is about **10,400** changed lines of hand-written and 57-2b work, plus roughly 64,000 generated and 200–300 docs.
- **PP-112 refusal threshold:** twice the expected 8,590 = **17,180** hand-written lines outside 57-2b. The
  separately approved 57-2b limit of 3,464 changed lines includes its generated artifacts and docs.
- **Exception evidence:** the owner's sentence in §1 is the PP-192 and one-slice-per-PR exception. **Remaining
  record:** he named no number, so the manager records the expected size and the refusal line in the brief and in
  `docs/owner-decisions.ar.md`; nothing more is asked of Waleed for size.

## 9. Release and rollback

- One release carries API, worker, admin and POS from the same merge SHA, after §6's backup and snapshot steps.
- The floors of `../plan-61.md` §4 follow the stored data, not the issuance lock: **API and worker not below this
  PR while any `low_rating` or `low_rating_with_comment` inbox row exists**, in any environment and whether issuance
  is open or closed (a controlled delivery test on staging leaves such rows); worker and admin not below this PR
  while the producer is live. A pre-61-1e API fails the whole inbox page on such a row.
- Rolling the whole release back is safe only where no such row exists. Before a rollback below this PR, a
  read-only check counts the `low_rating*` inbox rows of the target; the count and the check time are recorded,
  without row data. With a count above zero the rollback stops at the floor. The additive migrations stay.
- A zero inbox count is the API gate only; it does not make a WORKER rollback safe. A submitted low rating travels
  two outbox hops (`LowRatingSubmitted`, then `LowRatingReceived`), and either can still be pending while the inbox
  is empty; an older worker would leave the first unacknowledged (retried, then parked) or reject the second. Before
  lowering the worker below this PR, in this order:
  1. **Stop the source, not only issuance.** Closed issuance stops new links but does not invalidate a link issued
     earlier, and a customer can still submit through one. So either the API is already below 61-1i (it no longer
     emits the event), or a read-only count shows no usable rating link in the target (unconsumed and unexpired);
     with a count above zero the rollback waits for the seven-day expiry of the last one. No submission may be in
     flight when the counts below are read.
  2. **Drain both hops with a worker at or above this PR**, then confirm by a read-only count that the outbox holds
     no undelivered `LowRatingSubmitted` or `LowRatingReceived` row, parked ones included.
  3. **Count the inbox rows after the drain, not before**, because the compatible worker can still write a
     `low_rating*` inbox row while the outbox drains; that count is the API gate of the bullet above.
  Each count and its check time are recorded, without row data. A count above zero at any step stops the rollback
  at the floor.
- API not below 61-1b while the permission rows exist.
- A rollback that would cross a floor is the manager's decision; a production, server or secret change is Waleed's.

## 10. Owner session and review path (from the manager's brief, 2026-11-22)

1. One OpenCode owner session owns the whole build, continuously, in its
   worktree, through reviews and merge — GLM 5.3 Flash since the 2026-11-22 quota transfer; MiniMax M3.1 Flash
   delivered 61-2a and the 61-1c seed before it. From checkpoint 61-1e the owner is Claude on the Claude Code
   harness (§1, second transfer). No second implementer and no extra slot.
2. PP-218 adds Heavy review to this one Medium delivery. Run `clean-code-guard`, `test-guard`, `docs-guard`,
   `review-agent`, `requesting-code-review` and the relevant API, architecture and i18n skills. Run focused
   tests and the slice's acceptance proofs in the private lane. Unrelated heavy suites remain in CI under PP-113.
3. It launches its own independent, defensive, exact-head review: Codex `gpt-6.2-sol`, `reasoningEffort = medium`,
   with `waleed-security-reviewer`; it fixes and has the new head re-checked.
4. It opens the one PR. GitHub starts CI automatically and runs it in parallel with Codex and the four MergePilot
   reviewers. Consolidate findings under PP-119.1. CodeRabbit is optional for merge under PP-208.
5. The manager merges under PP-201 after reviews, the required `ci-gate` on the exact final head and the current
   tested base, the gates in §4 and §6, **and Waleed's approval on a card (PP-195): this PR carries two migrations
   and a permission seed, and the Medium tier the owner named does not remove that approval**. Other deliveries continue in their own slots. No branch-protection
   settings or workflow changes are part of this task.

## 11. Open items

1. **61-1i (§4):** apply PP-219 and attach the exact-head issuance-lock and integration evidence before merge.
2. **57-2b (§5.7):** local proof authorized. Attach passing performance, privacy and plan evidence before API exposure.
3. **Record:** the owner's instruction is recorded in the manager's local PP-217 alongside the §8 estimates.
4. **Lane:** the migration turn after #1189 lands `0239`.
5. **DEP-1, read-only:** the staging check of §4 item 3.
6. **Abu Salem's RT-Q17 pick** is still PENDING on the page; a different pick changes only `noticeComment` (61-1h)
   and the comment column (61-2b).
7. **Review round 2 (2026-11-23), recorded follow-ups, none in this PR:**
   - **Deploy order:** the admin ratings screen takes its month from the `month` field of the averages response, so
     the API of this PR is deployed before the admin; against an older API the month field stays disabled.
   - **Ratings read rule (FR-B15, both routes):** `GET …/ratings` and `GET …/ratings/averages` share one read gate,
     and it now applies the 61-1g rule of the worker: the `read:ratings:branch` ALLOW must be on the covering manager
     membership itself, so a role from one membership and an ALLOW from another are never combined (owner answer of
     2026-11-22; accepted by the manager for the API on 2026-11-23). A covering DENY from any active membership still
     removes the branch and the canonical owner still ignores a DENY. Both sides run one shared 21-case table, and an
     integration case covers the separate-membership ALLOW (403).
   - **Follow-up migration candidates:** an index on `(company_id, employee_id, branch_id, submitted_at)` to bound the
     employee-filtered ratings page, and a composite foreign key from `low_rating_notices` to the rating's business
     and branch. Migrations 0240 and 0241 are not changed here.
   - **L2 (accepted P2), second path (accepted by the manager, 2026-11-23):** the in-flight open guard of the
     reception private view is per controller, so a remount (close and reopen, offline and online) can leave an
     abandoned open whose request reaches the server after she left. Two moments are distinct: the operator's exit,
     at which the screen conceals and drops its data at once, and the arrival of the abandoned request at the server,
     which may be later. The answer of an abandoned open is never rendered: its controller generation is gone, and a
     late window is closed by its own id. A window the server may still create is bound to the identity of the same
     employee by her PIN and ends at the server's idle limit counted from its opening on the server. It widens
     neither the identity nor the duration and shows no rows again. Evidence: `private-window-controller-memory.spec.ts`
     (late open closed by its id, no reference to her rows kept) and the controller generation tests.
8. **Review round 3 (2026-11-23), recorded, none blocking:**
   - **Rollout note:** the alert-rules GET now always returns a `LOW_RATING` row, and an admin tab opened before
     the deploy parses the response with its older bundled enum and rejects the page until it is reloaded. Reload the
     admin after the deploy.
   - **Owner question, answered (RT-Q18, batch 101, PP-241):** the own rating average stays business-wide while
     `read:ratings:own` is effective on at least one branch; Waleed and Abu Salem both picked it on 2026-11-23
     (`../owner-questions.ar.md`). No code change.
   - **Deferred:** one snapshot for the alert rule and the recipients of a low-rating notice in the worker (the
     consumer runs READ COMMITTED with a single decision timestamp; a snapshot read needs a new option in
     `packages/db`), and the same snapshot option for the own-tips route.

### ملخص للمالك (بالعربي)

> **نقل التنفيذ (2026-11-22):** MiniMax 3.1 سلّم شريحة 61-2a وبذرة 61-1c قبل نفاد حصته، وكمل GLM 5.3 Flash
> نفس الجلسة ونفس الخطة ونفس الـ checkpoints من غير أي تغيير في النطاق. وبعد 61-1d طلب وليد إن Claude يكمل
> كتابة باقي الكود في نفس الجلسة، والمراجعة مرة واحدة في الآخر.

- كل الشغل الباقي بقى PR واحد بمنفّذ واحد على OpenCode (Medium) زي ما طلبت، والشرايح بقت 14 خطوة
  مرتبة جوه نفس الـ PR: 61-2a ثم 61-1c…i ثم 61-2b…d ثم 57-2b ثم 57-4 ثم 61-3.
- 57-2b قبل شاشة «شغلي». التصميم معتمد للإثبات المحلي، وإتاحة الـAPI تنتظر نجاح الاختبارات والأداء.
- اختار وليد قفل الإصدار الحالي في PP-219. الدمج يحصل والقفل مقفول. قبل النشر تُفحص البيئة المستهدفة للروابط السارية،
  وقبل التفعيل الأوسع لـ59b-3 نثبت تشغيل العامل والإدارة ونقيس التوصيل على staging.
