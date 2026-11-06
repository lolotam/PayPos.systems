# 57-2 — «شغلي» API (service lines + tips) — plan, revision 2, for the manager's review

Status: **PLAN ONLY.** No worktree, no production code, no PR, no dispatch until the manager approves the final brief.
Revision 1 drafted 2026-11-06 23:29 KWT; revision 2 answers the manager's review of revision 1 (D1/D2/D3 decided, six
gaps). Planner lane: Claude Code `claude-opus-5-5`. Baseline: main `da775eb5` (fix(worker) #888). Every read was
read-only (`git show` / `git archive` of `da775eb5` into the session scratchpad); the main checkout was not touched.
Once approved, this file is copied into the slice worktree as `docs/specs/060-ratings-and-staff-app/plan-57-2.md`.

## 0. Inputs read

**The six governing documents, read in full at `da775eb5` in this planning pass (not deferred to the implementer):**
`CLAUDE.md` (369 lines), `CLAUDE.architecture.md` (718), `docs/06_Tech_Stack_Architecture_EN.md` (268),
`docs/module-map.md` (527) with `docs/module-map.yaml`, `.specify/memory/constitution.md` (476), `docs/PRD.md` (1,165,
including the Phase 1 tasks P1-T7.4 own permissions, P1-T8, P1-T10.5, P1-T11.1 and the decisions D-36 tips, D-43
customers, D-46, D-47 columns, D-49 late entry). The rules this plan relies on are cited by section below; the ones that
changed revision 1 are `CLAUDE.architecture.md` §3.1 (layer matrix) and §7.2, and constitution Principle II.

Also read: `docs/agent-delivery-pipeline.md` (PP-112 delivery size, PP-113, PP-119.1, PP-123, PP-125, PP-131.2, PP-136),
`AGENTS.md`, `.claude/skills/pospay-pipeline/SKILL.md`; spec 060 Part A (D-A1…D-A14, §A.2 edge cases, FR-A01…FR-A08,
§A.5 rows 57-2 and 57b-1); spec 050 FR-013 (`late`); ADR-0010 addendum 2026-10-21 (A-0); ADR-0041 (read-side
callbacks bound in `orders.module.ts`, lines 74/281/323; the `effectiveDiscountBps` separate-context copy, line 112);
the 57b-1 template at `5a4281149` (#861): `own-attendance.controller.ts`, `own-attendance.query.ts`,
`own-attendance-context.adapter.ts`, identity `own-attendance-access.ts`, and its module-map paragraph and YAML lines;
orders schema migrations 0131, 0145, 0184; `packages/contracts/src/pagination/cursor.ts`;
`orders/ports/staff-columns.port.ts`.

**Grilling.** Revision 1 wrongly said the `grilling` skill was missing. It is installed at
`C:/Users/waleed_Mohamed/.agents/skills/synced/a49607e8-f54e-4100-93e1-44bf20defa51_62361cb6-49ad-4012-a8bf-6b998ea4eb23/grilling/SKILL.md`
and was read; §7 follows its format (numbered questions, each with a recommended answer, facts looked up rather than
asked). Settled decisions are used, not re-asked: MY-Q1…MY-Q10 (spec 060), and the manager's D1 = (a), D2 = (a),
D3 = (a). No owner (feature/business) question is open; nothing is asked of Waleed.

## 1. Ancestors — verified (unchanged)

| Slice | PR | State | What 57-2 uses |
|---|---|---|---|
| A-0 | ADR-0010 addendum 2026-10-21 | on main | orders `StaffColumnsPort` row (module-map §3) |
| 57c-1 | #468 | MERGED `04a63940` | `orders/ports/staff-columns.port.ts` (`allowed`, `monthsBack`) + its adapter, already wired |
| #496 / #497 | issues | CLOSED | months-back default 2, range 1–12, clamp on read |
| 57-1b | #775 | MERGED `034db9cd` | private-view window store |
| 57-1c | #784 | MERGED `68e3e360` | `@PrivateViewRoute()`, `PRIVATE_VIEW_EXPIRED` |
| 57-1a | #845 | MERGED `5d15dc32` | `read:service-sessions:own`, defaults for every human role, devices forbidden |
| 57b-1 | #861 | MERGED `5a4281149` | the pattern; `MY_PERIOD_OUT_OF_RANGE` |
| #519 | issue | OPEN | not a blocker (clamp on read gives 1–12) |

PP-136 consultation: done by the manager.

## 2. Scope (unchanged)

In: FR-A01 `GET /v1/staff/me/service-lines?month=YYYY-MM&cursor&limit` and FR-A03 `GET /v1/staff/me/tips?month=YYYY-MM`
in `orders`, server-side projection, months window, live recheck, OpenAPI and both generated clients, tests MY-01,
MY-02, MY-03, MY-04, MY-07, MY-08, MY-13 plus access and history tests (§5).

Out: no migration; no UI (57-3/57-4/57-5); no estimate; `rating_average` never returned; no `leave.ts` or staff
leave-history (68-1); no #882 i18n file; no 42-3b1 file (spec 058 package-sale path); `orders.module.ts` appended lines
only; no change to any 57b-1 file.

## 3. Design

### 3.1 Route policy (as 57b-1)

`@Authenticated()` + `@SetMetadata(STAFF_ROUTE, 'staff')` + `@SetMetadata(PERSONAL_ROUTE, 'staff')` + `@PrivateViewRoute()`
+ `@Header('Cache-Control', 'no-store')`. Session = `request.staffSession ?? request.personalSession`; on `STAFF_POS`
`request.staffDevice.branchId` is passed as the device branch. Any of `employee_id`, `branch_id`, `business_id`,
`company_id` in the query → uniform 403 (MY-12). One `Clock.now()` per request; everything in one
`withTenant(companyId, …, { userId })` transaction.

### 3.2 Live recheck inside the read transaction (FR-A06)

Order, all on the caller's transaction and the one clock sample:
1. `reads.context(tx, ctx, now)`: the employee of the session's user **in the session's business**: not deleted,
   `hire_date ≤ today`, contract not ended, a dated `employee_branches` attachment live today (branch-local day),
   exactly one employee row; then membership + `evaluateAccess(…, 'read:service-sessions:own', { actorUserId,
   subjectUserId })` (ADR-0026: owner immunity, covering DENY) + feature `orders`. Any failure → 403 `FORBIDDEN`.
2. client scope keys → 403; parse (400 `VALIDATION_FAILED`); months window via `StaffColumnsPort.monthsBack`
   (422 `MY_PERIOD_OUT_OF_RANGE`); then `StaffColumnsPort.allowed`.

Recheck runs before the period is diagnosed, as 57b-1 does, so a refused caller learns nothing about the window.

**D1 = (a), decided.** Two new provider-owned readers through public exports, on the same `tx` and `now`; 57b-1 is not
modified:
- `staff/persistence/own-employee.ts` → `readOwnEmployee(tx, ctx, now)` → `{ employeeId, userId, branchIds }`, the same
  dated-eligibility rule as 57b-1's SQL (staff owns eligibility, ADR-0041 §1); one export line in `staff/index.ts`.
- `identity/persistence/own-service-sessions-access.ts` → `readOwnServiceSessionsAccess(tx, ctx, now)` (code
  `read:service-sessions:own`, feature `orders`), the shape of `readOwnAttendanceAccess`; export in `identity/index.ts`.
- Branch names and the timezone through tenancy's `describeWorkspaces` / `activeBusinessTimeZone`.

The orders adapter `persistence/own-work-context.adapter.ts` composes them and is bound into the query's `Reads`
interface in `orders.module.ts` (ADR-0041's read-side callback pattern). All arrows (`orders → staff | identity |
tenancy | settings`) are already declared (module-map §2), so no ADR addendum; the slice adds the `reads:` lines
(§4).

### 3.3 Historical scope: current authority vs what is listed (new)

The recheck proves **who is asking now**; it does not scope the history. Sources: spec 060 §A.2 edge cases ("attached to
two branches sees her lines of both, each with its branch"; "in two businesses … only the business of her session";
"a performer change … removes the line from that revision on"), D-A8 (a line is hers when she is a **current**
performer, in the line's business, in the month, by `business_date`), D-A7 (branch name is a context field "needed to
tell two branches apart"), and the 57b-1 precedent recorded in module-map: "The branch proving current authority does
not restrict historical attendance branches" (57b-1's SQL joins every branch of the business, not the device branch).

Therefore:
- **Listed:** lines where her `line_performers` row exists now, `employee_id` = the employee row of the **session's
  business**, `business_id` = that business, `business_date` in the month — **at any branch of that business, active or
  not**, with no filter on her `employee_branches` history. Branch names come from all branches of the business.
- **Personal session:** authority is proven if any live attachment branch passes membership + own permission.
- **Reception (`STAFF_POS`):** the device branch must be one of her live attachments and pass the access check (this is
  what proves the operator at that counter); it does **not** narrow the listed lines to that branch. Confirmed as §7 Q3.
- **Transferred employee** (same business, old attachment closed, new one open): still sees her lines at the old branch,
  because the listing keys on `employee_id`, not on today's attachments. An employee moved to another business has a
  different employee row there and sees only the business of her session.
- **Excluded:** another business's lines (even same company), lines she was removed from by a performer change, and
  colleagues' rows.

### 3.4 Service-lines query (FR-A01)

Orders-owned tables only: `line_performers` (her row: `share_bps`) → `service_lines` (status, service name snapshot,
`list_price`, `discount`, `net`, `late`) → `service_sessions` (`business_date`, `occurred_at`, `branch_id`, `customer_name`)
→ `service_line_cancellations.cancelled_at` for a cancelled line. Order newest first:
`(ss.business_date DESC, ss.occurred_at DESC, sl.id DESC)`. Paging reuses the house `pageQuery` (`limit` default 20,
max 100) and the `page()` envelope: response `{ month, items, next_cursor }`.

**Projection (D-A2, D-A7; strict object, a hidden key is absent, never `null`):**

| Key | Column (code) | Present when |
|---|---|---|
| `line_id`, `branch_name_ar`, `branch_name_en`, `cancelled` | context (D-A7) | always |
| `cancelled_at` | context (D-A7) | on a cancelled line |
| `date` | `business_date` (`date`) | `date` allowed |
| `late` | `service_lines.late` (`date`, see below) | `date` allowed |
| `time` | `occurred_at` UTC instant (`time`) | `time` allowed |
| `service_name_ar`, `service_name_en` | snapshot (`service`) | `service` allowed |
| `customer_name` | session snapshot (`customer_name`) | allowed |
| `list_price`, `discount`, `net` | canonical KWD strings (own codes) | each allowed |
| `share_bps` | her `share_bps` (`share`, D2 = (a), integer only) | `share` allowed |

**`late` is mapped under `date`, not always present (manager point 3).** D-A7 says the context fields are exactly
`line_id`, the branch name, `cancelled`, `cancelled_at`, and "every other field is one of the codes", so an
always-present `late` would break D-A7. The «متأخرة» mark comes from the edge case "a line recorded late (D-49) appears
under its own `business_date`, with the «متأخرة» mark", and spec 050 FR-013 defines `late = occurred business date <
recording business date` — a statement about the line's date. With `date` hidden, exposing `late` would reveal that the
hidden date lies before the recording day, so it travels only with `date`. Confirmation asked as §7 Q1 before the
contract is written; no always-present `late` ships on assumption.

**Never selected** (MY-03, S-9, S-12): `customer_phone_masked`, `customer_id`, `recorded_by*`, other performers' rows
or names, any rating or comment. A schema test asserts these keys are absent; a log-capture test asserts no phone in
logs or error bodies.

**Cursor without hidden date/time (manager point 5).** A cursor that encodes `(business_date, occurred_at, id)` is
base64, i.e. decodable, and would leak `date`/`time` when they are hidden. The cursor is therefore **the last row's
`line_id` only** — a value already in that row (context field). The server resolves the sort tuple in the same SQL
(a subselect on `service_lines` PK `(company_id, id)` + `service_sessions` PK) and applies the row-value keyset
`(business_date, occurred_at, id) < (…)`. The cursor line must be one of her current-performer lines of the requested
month in the session's business; otherwise 400 `VALIDATION_FAILED` (one uniform error, so a guessed id learns nothing).
If a performer change removes her from the cursor line between pages, the next page is 400 and the client restarts
from page one (documented in the contract). §7 Q4.

**Identifiers that already carry an instant (manager point 5).** IDs are UUID v7 (constitution Principle II), whose
first 48 bits are the creation millisecond, so `line_id` — always present by D-A7, and the join key for the
commissions estimate (D-A1) — reveals when the line was recorded even with `time` hidden; `cancelled_at` is
always-present by D-A7 too. These are spec-mandated context fields, not choices of this slice; §7 Q5 asks for the
explicit ruling the manager requires instead of shipping them silently.

### 3.5 Tips query (FR-A03, D3 = (a))

Order: recheck → scope keys → parse → months window → `allowed`. **If `tip` is not allowed, the route returns 200
`{ month, status: 'HIDDEN' }` and does not query `session_tips` at all** (no aggregate, no amount). Access and period
refusals stay 403/422 as in §3.2.

Visible: her `session_tips` rows in the **current** revision of each session (highest `session_tip_revisions.revision`,
as `session-tips-current.query.ts`), sessions of the session's business with `business_date` in the month, only her
`employee_id` (MY-08). Response `{ month, status: 'VISIBLE', total_cash, total_card }` — canonical KWD strings, the
exact pair `sumTipTotalsByMethod` returns. No grand total (FR-A03 says "by method"; a total would be one more piece of
money arithmetic). The contract is a discriminated union on `status`, each branch a strict object; a test asserts the
exact key sets of both branches.

**Money arithmetic stays in domain (manager point 4).** `CLAUDE.architecture.md` §3.1 lets `queries/` import only
`packages/db` (read-only) and `packages/contracts`; the only read-path exceptions are the commissions read use cases
(ADR-0054 §5) and customers `view-rating` (ADR-0011 addendum), none for orders. Constitution Principle II puts "tips"
and "totals" in domain. So `@pospay/domain` is **not** imported in `queries/`; the existing import in
`session-tips-current.query.ts` is not a precedent for new code. The SQL selects only `method, amount` of her
current-revision tips; the query calls an injected `reads.tipTotals(entries)` bound in `orders.module.ts` to
`sumTipTotalsByMethod` (the same injection 57b-1 uses for `periodAllowed`). No `SUM()` on money in SQL and no
re-implementation of the sum. The rows are summed, not mapped into a DTO, so §7.2 rule 3 ("no mapper for > 200 rows")
is not engaged; the EXPLAIN receipt (§5) still measures the month at seeded volume. §7 Q2 records the alternative.

### 3.6 Period rule

`ownAttendancePeriodAllowed` is in `staff/domain/`; orders cannot import another module's domain. A pure copy in
`orders/domain/own-work-period.ts` (ADR-0041 line 112 separate-context copy precedent) with an exhaustive unit test,
injected as `reads.periodAllowed`, never imported by `queries/`.

### 3.7 Contracts, OpenAPI, clients

`packages/contracts/src/orders/own-service-lines.ts` (+ `-openapi.ts`), `own-tips.ts` (+ `-openapi.ts`); appended
lines in `contracts/src/index.ts` and `openapi.ts`; 400/401/403/422 carry the `ErrorEnvelope`. Generated files
(`openapi.json`, two `schema.d.ts`) are regenerated only, and regenerated again on top of main after any other merge
that touches them. `errors.ts` and i18n: no change.

## 4. File ownership

New (orders): `http/own-work.controller.ts`, `queries/own-service-lines.query.ts`, `queries/own-tips.query.ts`,
`persistence/own-work-context.adapter.ts`, `domain/own-work-period.ts`.
New (providers): `staff/persistence/own-employee.ts`, `identity/persistence/own-service-sessions-access.ts`.
New (contracts): `orders/own-service-lines{,-openapi}.ts`, `orders/own-tips{,-openapi}.ts`.
Appended lines only: `orders/orders.module.ts`, `staff/index.ts`, `identity/index.ts`, `contracts/src/index.ts`,
`contracts/src/openapi.ts`, `docs/module-map.md`, `docs/module-map.yaml`.
module-map additions: one §3 paragraph in the 57b-1 style ("`OwnWorkReads` is a read-side interface beside the
«شغلي» queries … the branch proving current authority does not restrict the listed lines' branches …") and four
`reads:` lines with matching YAML edges:
- `orders -> staff.readOwnEmployee @ apps/api/src/modules/orders/persistence/own-work-context.adapter.ts`
- `orders -> identity.readOwnServiceSessionsAccess @ …/own-work-context.adapter.ts`
- `orders -> tenancy.describeWorkspaces @ …/own-work-context.adapter.ts`
- `orders -> tenancy.activeBusinessTimeZone @ …/own-work-context.adapter.ts`
Generated: `packages/contracts/openapi/openapi.json`, `apps/admin/src/shared/api/schema.d.ts`,
`apps/pos/src/shared/api/schema.d.ts`.
Docs: `docs/specs/060-ratings-and-staff-app/plan-57-2.md`, `57-2-validation.md`.
Tests (new): `orders/__tests__/own-service-lines.spec.ts`, `own-tips.spec.ts`, `own-work-http.spec.ts`,
`orders/domain/__tests__/own-work-period.spec.ts`, `packages/contracts/src/orders/own-work.spec.ts`.
Not touched: `packages/db/**`, `apps/pos/src/**` except the generated file, `leave.ts`, staff leave-history, #882's
i18n files, 42-3b1's files, every 57b-1 file.

## 5. Tests and gates

| Test | Where | What it proves |
|---|---|---|
| MY-01 | own-service-lines.spec (real Postgres) | her current-performer lines, newest first; رنا's absent; a 70/30 shared line for both with each `share_bps`; cursor walk returns every line once |
| MY-02 | same, data-driven over every D-A7 code | a disallowed code's key is absent (not `null`); `late` absent when `date` hidden; context keys always present |
| MY-03 | contract spec + log capture | no phone / colleague id or name / comment key; no phone in logs or error bodies |
| MY-04 | own-service-lines.spec | `customer_name` = session snapshot; opted-out customer still listed |
| MY-07 | own-service-lines.spec | cancelled line: `cancelled: true` + `cancelled_at`, no commission key |
| MY-08 | own-tips.spec | CASH/CARD from the current revision only; superseded revision and colleague's tip excluded; `tip` hidden → exact `{month, status}` and no `session_tips` read (asserted by a statement spy at the DB boundary) |
| MY-13 | own-work-http.spec + domain unit | `NULL` → current + previous pass, the one before → 422; 3 / 12 boundaries; stored 24 read as 12; malformed month → 400 |
| history | own-service-lines.spec | two branches, personal session: lines of both, each with its branch; two branches, reception session at branch B: lines of A and B; transferred employee (A closed, B open) still sees A's lines; same company, second business excluded; performer removed by a revision excluded |
| cursor | own-service-lines.spec | cursor = last `line_id`, no date/time in it; foreign/unknown/other-month line id → 400; removed-from-line between pages → 400 |
| access | own-work-http.spec | 401 no session; `STAFF_POS` without a live window → 403 `PRIVATE_VIEW_EXPIRED`; client scope keys → 403; device branch not a live attachment → 403; deleted/unlinked employee, expired membership; DENY of `read:service-sessions:own` (MY-11); feature `orders` off |
| live recheck | own-work-http.spec | contract ended / attachment closed after sign-in → 403 on the next request (positive control first, isolated fixture) |
| shapes | contract spec | strict keys of the line row and both tips branches |

Each `queries/` file gets a result-shape test and an `EXPLAIN` index-usage assertion (`CLAUDE.md` §9, constitution V).
**EXPLAIN gate, no migration:** existing `line_performers_employee_idx`, `service_sessions_business_day_idx`,
`session_tips_employee_idx`, `session_tip_revisions_session_revision_uq`, PKs for the cursor lookup. The PR carries
`EXPLAIN (ANALYZE, BUFFERS)` of both queries on the lane DB at seeded volume (one busy employee, ~600 lines a month);
target index scans and < 200 ms. If a plan needs an index, the slice stops and reports; it never adds a migration.

Local gates (PP-113): typecheck, lint, `pnpm lint:docs`, boundaries, `pnpm module-map:check`, `contracts:openapi` +
`api:generate`/`api:check`, the slice's own tests on a private lane. Done = `ci-gate` green on the exact head.

## 6. Size (corrected)

Revision 1 summed its own parts wrong (they add to 495, not 330–400) and set a production-only threshold that PP-112
does not provide. The pipeline rule is: "Every implementer brief states the expected size of the change. A delivery
more than **twice** that size is refused." The size is the whole change, measured as added + deleted lines of
`git diff --numstat <merge-base>...HEAD`, generated, tests and docs included.

Calibration, 57b-1 (#861, one route, spec row 220–320): production +366/−1, tests +473/−1, docs +313, generated +389;
total 1,541 insertions / 2 deletions in 24 files.

| File | Category | + | − |
|---|---|---|---|
| orders/http/own-work.controller.ts | production | 70 | 0 |
| orders/queries/own-service-lines.query.ts | production | 125 | 0 |
| orders/queries/own-tips.query.ts | production | 50 | 0 |
| orders/persistence/own-work-context.adapter.ts | production | 55 | 0 |
| orders/domain/own-work-period.ts | production | 17 | 0 |
| staff/persistence/own-employee.ts | production | 40 | 0 |
| identity/persistence/own-service-sessions-access.ts | production | 42 | 0 |
| orders/orders.module.ts | production | 30 | 1 |
| staff/index.ts, identity/index.ts | production | 3 | 0 |
| contracts own-service-lines.ts / -openapi.ts | production | 100 | 0 |
| contracts own-tips.ts / -openapi.ts | production | 62 | 0 |
| contracts index.ts, openapi.ts | production | 8 | 0 |
| **production** | | **602** | **1** |
| own-service-lines.spec.ts | tests | 330 | 0 |
| own-tips.spec.ts | tests | 170 | 0 |
| own-work-http.spec.ts | tests | 250 | 0 |
| own-work-period.spec.ts | tests | 15 | 0 |
| contracts own-work.spec.ts | tests | 60 | 0 |
| **tests** | | **825** | **0** |
| module-map.md / .yaml | docs | 16 | 0 |
| plan-57-2.md / 57-2-validation.md | docs | 590 | 0 |
| **docs** | | **606** | **0** |
| openapi.json | generated | 380 | 0 |
| admin + pos schema.d.ts | generated | 380 | 0 |
| **generated** | | **760** | **0** |
| **Total** | | **2,793** | **1** |

**Brief size: 2,800 changed lines (≈ 600 production, 825 tests, 610 docs, 760 generated). PP-112 refusal: a delivery
above 5,600 changed lines.** Any file over 300 lines (warn) or a function over 60 is a review finding regardless.
Production ≈ 600 is above the spec row's 300–420: the row predates the cursor, the second route's contract and the two
provider readers that D1 = (a) adds; 57b-1's production ran ≈ 1.15× the top of its row. §7 Q6.

## 7. Remaining technical questions (grilling format; nothing for Waleed)

❓ **Q1 — `late` under which column**: D-A7 allows no extra context field; the «متأخرة» mark is required by the §A.2
edge case and FR-013 makes it a statement about the date. ➡️ **Recommended:** `late` (from `service_lines.late`) is
present exactly when `date` is allowed. Alternative: under `time` (weaker fit), or a spec amendment adding `late` to
D-A7's context list (owner-level change; not proposed).

❓ **Q2 — tip totals**: ➡️ **Recommended:** SQL selects `method, amount` of her current-revision tips;
`reads.tipTotals` bound in `orders.module.ts` to `@pospay/domain` `sumTipTotalsByMethod`; no `@pospay/domain` import in
`queries/`. Alternative: SQL `SUM(amount) GROUP BY method` returned as `numeric` text — exact on `numeric(14,3)`, but it
is tip arithmetic outside domain (Principle II) and no `apps/api` `queries/` file sums money in SQL today.

❓ **Q3 — reception branch**: ➡️ **Recommended:** the device branch proves current authority only and does not narrow the
listed lines (57b-1 precedent and its module-map sentence; edge case "lines of both [branches]"). Alternative: narrow to
the device branch — contradicts the edge case and 57b-1.

❓ **Q4 — cursor**: ➡️ **Recommended:** cursor = last row's `line_id`, sort tuple resolved server-side, foreign or stale
cursor → 400 `VALIDATION_FAILED`. Alternatives: HMAC/encrypted tuple (new key material, a secret to manage); or a plain
decodable tuple with an explicit ruling that it may expose hidden date/time (not recommended).

❓ **Q5 — instants inside spec-mandated context fields**: `line_id` (UUID v7) encodes the recording millisecond and
`cancelled_at` is always present by D-A7, so with `time` hidden the recording/cancel instants remain derivable.
➡️ **Recommended:** accept as specified (D-A7 makes both context fields; `line_id` is the D-A1 join key for the
estimate), and record the ruling in the contract's description and the validation file. Alternative: an opaque
per-response handle instead of `line_id` — breaks the D-A1 join with 57-3 and needs a spec change.

❓ **Q6 — size**: ➡️ **Recommended:** keep 57-2 as one PR at the stated 2,800-line brief size (the spec's §A.5 row is
one row; both routes share the controller, context reader and recheck). Alternative: split the tips route into its own
PR (smaller diffs, but a second context-reader review and a second generated-client regeneration).

## 8. Roles and lanes

- Planner: this session. Manager review of this plan = the lead review.
- Implementer: Codex `gpt-6.1-sol`, effort medium, standard speed (PP-125), via `delegate_task` with
  `isolation: "worktree"`; fallbacks MiniMax → Kimi CLI → Claude Sonnet (PP-112 availability switch only). Corrections:
  Kimi K3.1 Pro `high` on T3 OpenCode, then its chain. The brief opens with: «ممنوع shell خالص حتى لو قراءة، وممنوع
  git، وممنوع قراءة `.env*` و`.git`، وممنوع أي حاجة برا الـ worktree».
- **Isolation and `.env` (replaces revision 1's `mv` step).** No blanket `mv`, copy or read of any `.env*` file, and no
  operation on old work (50-1 worktree and backups stay as they are). The worktree is created only by T3 isolation.
  Before dispatch the orchestrator verifies, by path and listing only: the worktree path T3 returns, that
  `git rev-parse --show-toplevel` equals it and the branch is the new 57-2 branch, and whether any `.env*` name exists
  in it (names only; values are never opened). If one exists, the orchestrator does not touch it and reports to the
  manager with its path and ownership facts (tracked or not, created by the worktree setup or not) before any dispatch.
- Orchestrator: line-by-line diff review, guards (`clean-code-guard`, `test-guard`, `docs-guard`), local gates, EXPLAIN
  receipt. PP-10.1: no production code or tests by the orchestrator.
- Code review: Codex `gpt-6-astra` high, read-only; Fable 5.1 fallback. No database reviewer (no `packages/db`).
- PR: MergePilot panel on every pushed head; `@codex review` once on the final head (PP-131.2); one push per correction
  round (PP-119.1); at most three rounds; P2/P3 fixed by default (PP-123). `ci-gate` green on the exact head.
- Merge: only on the manager's «دورك», after the backup receipt, `--match-head-commit`. No deploy, no server action.

## 9. Security plan

- Identity from the session only; uniform 403 on client scope keys.
- RLS: every read inside `withTenant(companyId, …, { userId })`; `company_id` and `business_id` predicates on every
  joined table.
- Live recheck (employee, dated attachment, membership, own permission with DENY and owner immunity, feature) in the
  same transaction and clock instant; on `STAFF_POS` the device branch must pass it.
- History scoped by the session's business and her current performer rows, never by a client value (§3.3).
- Projection on the server; hidden keys never serialised; `late` follows `date`; tips hidden → no tip read at all.
- Cursor carries only an already-visible `line_id`; uniform 400 on a foreign or stale cursor.
- `Cache-Control: no-store`; no PII in logs (log-capture assertion).
- No new grant, table, RLS policy, secret, external call, migration or server change.

## 10. Order and dependencies

Ancestors complete (§1). Provisional order: #882 → 68-1 → **57-2** → 61-1; 42-3b1 after the performance check and
generation coordination. 57-2 shares only append-line files and generated OpenAPI/clients with them; whichever merges
second regenerates on top of main.

## 11. Manager decisions on revision 2 (audit record, 2026-11-07)

Approved for implementation (not merge) by the manager, with these rulings binding on the brief:

- **Q1** `late` travels under `date` only.
- **Q2** tip totals through the `reads.tipTotals` callback bound in `orders.module.ts` to `sumTipTotalsByMethod`; no
  domain import in `queries/`.
- **Q3** the device branch proves current authority only; it does not narrow the same employee's history in the same
  business.
- **Q4** cursor = `line_id`; the sort tuple is resolved server-side in the same statement, inside the current-performer,
  month and tenant context; any invalid cursor → uniform 400.
- **Q5** D-A7 holds: `line_id` and `cancelled_at` are context fields. Hiding `time` does not guarantee hiding the UUID v7
  recording instant or the cancel instant; this is stated in the contract description. No other timestamp may be added.
- **Q6** one PR; brief size 2,800 changed lines including +/− of production, tests, docs and generated; refusal above
  5,600 total. The size is not a target and not a licence to widen scope.

Verification conditions, inside the same scope:
- **Tips performance.** The callback is not a performance exemption. Measure query + row materialisation + domain
  aggregation time and memory at a representative month volume, not only `EXPLAIN`. No silent `LIMIT`, no dropped
  rows, no `Number` for money. If the load is unacceptable, stop and raise a plan; never patch with a cap or change how
  money is summed.
- **Cursor.** The cursor lookup runs before pagination inside the same SQL. Tests: a cancelled anchor stays valid while
  she is still a current performer; removal / foreign / other-month anchor → 400; paging with `date`/`time` hidden; tie
  ordering on equal `(business_date, occurred_at)`; multi-tenant scope. No query per branch group or per line.
- **History branches.** The tenancy branch lookup covers every branch allowed in the history, inactive ones included,
  without losing rows; tests for an old/inactive branch and a transferred employee; current membership and permission
  are proven before any history is returned.
- **HIDDEN** only after authority and period checks pass, and with no `session_tips` query; `no-store` on every
  protected response, per the project pattern.
- **Workspace.** Created from freshly verified main by T3 isolation only. The implementer's first phase checks
  workspace identity with what it is allowed to do (file reads), then waits for the owner's receipt before editing
  source. Git and gates belong to the session owner; the no-shell rule does not ask the implementer for git. No `.env`
  value is read and nothing is moved in bulk.
- The implementer reads the rules and this plan in full. The manager's review and the planner's reading do not replace a
  fresh Codex `gpt-6-astra` high code review after implementation and gates. At most three correction rounds; no
  migration and no overlap with 57b-1, leave (68-1) or 42-3b1 production files.
