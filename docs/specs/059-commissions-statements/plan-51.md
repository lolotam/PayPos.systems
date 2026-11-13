# Plan 51-1: generate-statement and the two fingerprints (spec 059)

Status: **DRAFT — planner lane, docs only** (2026-11-13). Base: `main` 971bdb232, read inside the worktree `feat-p1-059-51-generate-statement`. Every state below was re-checked with `grep`/`ls` in this worktree, not taken on trust. Nothing here is approved yet: the split, the order and the owner questions in §10 are for the manager and for Waleed.

Inputs: spec D-3, D-5, D-6, D-7, D-13, D-16, D-20, D-22, D-25, D-26, D-29; FR-025…FR-028; §6 _Schema changes_, _Fingerprint_, _Permissions_; row 51-1 of the sub-PR table (spec.md:1232); CM-23d…CM-23h, CM-27…CM-29, CM-28b, CM-28c, CM-33, CM-33d, CM-34e, CM-R11; ADR-0012 §1; ADR-0025; ADR-0054 §4, §5, §6; `docs/module-map.md` §3; `docs/owner-decisions.ar.md` PP-101.1/PP-101.2; `owner-questions.ar.md` items 39 (CS-Q37) and 40 (CS-Q38); `plan-50-3.md` and `plan-56-1.md` for shape; CLAUDE.md §1, §5, §6.

## 1. What exists (merged, verified in this worktree)

| Item | Evidence in this worktree |
| --- | --- |
| 48a-1 + 50-a | `packages/commissions-engine/src/**`; `assembleCommissionPeriodInput` in `period-input-assembly.ts`; the input types in `period-input-types.ts` (lines, sales, salary, versions, overrides, tips, corrections) |
| 48a-2 | `packages/db/schema/commissions-statements.ts` — `commission_statements`, `commission_statement_lines`, `commission_statement_attachments`; `lockStatementPeriods`, `assertStatementPeriodsOpen`, `reopenReviewedStatementPeriods`, `StatementPeriodClosedError` in `packages/db/src/statement-periods.ts` |
| 50-0 | `packages/db/src/dispatcher.ts` (`commissionInputReplayPage`) |
| 50-1 / 50-2 | `packages/db/schema/commissions-lines.ts` (migrations `0202`/`0203`); `commissions-tip-salary.ts` (`0208`/`0209`) |
| 50-3a / 50-3b | `apps/worker/src/modules/commissions/jobs/replay-commission-inputs.ts`; `use-cases/bootstrap-session-tips/` |
| 52-1b (domain only) | `apps/api/src/modules/commissions/domain/statement-return-plan.ts` — a domain file, no use case, no table |
| 56-0 / 56-1a / 56-1b | `packages/documents/src/excel/commission-statement.ts`; `packages/contracts/src/commissions/statement-exports.ts`; `packages/db/schema/commissions-statement-exports.ts`; worker `use-cases/read-commission-statement-export/` |
| helpers | `packages/db/src/canonical-json.ts` (`canonicalJson`, exported from `@pospay/db`); `withTenant` in `packages/db/src/with-tenant.ts` |

Not present anywhere under `packages/db/` (schema, `src/`, migrations): `commission_sales`, `commission_corrections`, `commission_period_generations`, `commission_blocked_corrections`, `commission_carries`, `commission_statement_returns`. `packages/db/src/access-catalog.ts` holds **no** `read:commissions:business`, `review:commissions:business` or `approve:commissions:business` (only `read:commissions:own` and `manage:commission-plans:business`). `TenantOptions` carries `userId`, `timeoutMs`, `drainOnTimeout` — **no `readOnly`**.

## 2. What is missing — dependency table

| Row | What it must give 51-1 | State | Evidence |
| --- | --- | --- | --- |
| 48a-1 / 48a-2 | engine package, statement tables, `lockStatementPeriods` | **MERGED** | §1 |
| 50-a | input assembly + the input types | **MERGED** | `period-input-assembly.ts` |
| 50-1 | line projection | **MERGED** | `commissions-lines.ts` |
| 50-2 | tips + salaries projection | **MERGED** | `commissions-tip-salary.ts` |
| 50-3a | line/salary replay | **MERGED** | `replay-commission-inputs.ts` |
| 50-3b | tips bootstrap | **MERGED** | `bootstrap-session-tips/` |
| 50-3c | coverage readers, report, pure comparison, module-map Port rows | **OPEN PR #1010** | brief; `plan-50-3.md` |
| 50-3d | six-type retained-event replay (index-only migration) | **NOT STARTED** | no six-type facade; `commissionInputReplayPage` covers four types |
| 50-4 | `commission_sales` table + `PackageSaleChanged` handler; needs row 42's producer | **NOT STARTED** | no table; no branch/PR |
| 50-5 | `use-cases/get-commission-estimate/`, `{ readOnly: true }` on `withTenant`, HTTP + `read:commissions:business` | **NOT STARTED** | no `get-commission-estimate/`; no `readOnly` in `TenantOptions` |
| 55-1 | `commission_corrections`, `commission_period_generations` + the correction step | **NOT STARTED** | no table; no branch/PR |
| 55-2 | `commission_blocked_corrections` + repair use case + bell | **NOT STARTED** | no table; no branch/PR |
| 52-1 | review + approve code + `commission_statement_returns` | **NOT STARTED** (only 52-1b's domain file merged) | `statement-return-plan.ts` only |
| 56-x | export table, worker source, workbook | **MERGED** (56-0, 56-1a, 56-1b) | §1 |
| #1010 | 50-3c | **OPEN PR** | — |
| #996 | catalog close/reopen | **OPEN PR, unrelated** | — |

## 3. Dependency verdict

**51-1 cannot start as a whole.** Its own row lists `50-5` and `55-2`; `50-5` in turn lists `50-a, 50-1, 50-2, 50-4, 55-1`, and `55-2` lists `55-1`. The transitive closure therefore adds `50-4` and `55-1`, and **all four (50-4, 55-1, 55-2, 50-5) are NOT STARTED**. The owner already ruled this: CS-Q38 = PP-101.2 (2026-11-01), «أيوه، 51-1 يستنى 55-2 كمان (مع 50-5)» — because D-26 makes 51-1 fix the full canonical contract **once**. Shipping 51-1 first with empty sales/corrections/blocked-corrections would fix a fingerprint that later has to change, invalidating every `current_fingerprint` already stored.

| Part of 51-1 | Blocked by | Can it start now? |
| --- | --- | --- |
| `commission_carries` table + RLS + grants + indexes + CM-R11 | nothing (its FKs point at `commission_statements` and `employees`, both merged) | **YES** — the only unblocked piece |
| `review:commissions:business` catalog code, ROLE_DEFAULTS, owner-only grant/revoke lists, the reference-data migration | nothing (a reference-data migration on global roles, the 0187 shape) | **YES as code/migration**; its *proof* through `generate` needs 51-1c |
| pure input-fingerprint builder + hash port | 50-4, 55-1, 55-2 for the canonical contract | **NO** — the blocked-correction type does not exist yet |
| pure statement builder + statement fingerprint | 50-4/55-1/55-2 for the frozen rows' sources; the branch/service/customer name readers | **NO** — same reason, and 51-1 is the one that names those ports |
| the GET use case + HTTP | 50-5 (`read:commissions:business`, the effective-branch-set reader, `readOnly`) | **NO** |
| the generate use case + HTTP | 50-5 (the business-wide predicate) + the builders | **NO** |

Overlap with the open PRs: **#1010 (50-3c)** shares no table, no port and no use case — only `packages/commissions-engine/src/index.ts` (one export line each), `docs/module-map.md` §3 (its two coverage Port rows vs 51-1's reader rows) and `docs/adr/0054-…md` (§4 vs §6 addendum). Add-only lines in shared files, so the two run in parallel under PP-111.2 with the manager owning the merge order and both sessions rebasing: **#1010 does not block 51-1**. **#996** is the catalog module, with no overlap at all and not a blocker.

## 4. Proposed split (one use case per PR, CLAUDE.md §1)

The row's whole content is ≈ 830 production lines against a 350–480 budget, so it must be split. Every sub-PR stays inside its band; every sub-PR that carries a migration is flagged for the migration lane.

| Sub-PR | Scope | Prod. lines | Depends on | Migration lane |
| --- | --- | --- | --- | --- |
| **51-1a** | `commission_carries` table: migration (RLS `ENABLE`+`FORCE`, grants, CHECKs, UNIQUE, the four FKs, the indexes), `packages/db/schema/commissions-carries.ts`, the tenant-table inventory and the grants allowlist entries, CM-R11 | ~190 | 48a-2 | **yes** (number at merge) |
| **51-1b** | the two pure builders in `packages/commissions-engine` (input fingerprint + statement builder), the hash port (`hash(value) → hex`) and its `persistence/` adapter over `canonicalJson` + `node:crypto`, the canonical contract in ADR-0054 §6, the pure tests | ~200 | 50-4, 55-1, 55-2 (types and columns) | no |
| **51-1c** | the `generate` write use case + HTTP `POST …/:period/generate`, its guard, the `review:commissions:business` registration (catalog code, `ROLE_DEFAULTS`, `OWNER_GRANTED_PERMISSIONS` in db and identity, `OWNER_ONLY_EDIT_PERMISSIONS`), the reference-data migration, CM-27/CM-28/CM-29/CM-33/CM-33d, the migrate-only regression | ~230 | 50-5, 51-1a, 51-1b | **yes** (permission-catalog migration) |
| **51-1d** | the `get-statement` read use case + HTTP `GET …/:period`, the two Zod response shapes, the branch-scoped filter, CM-28b/CM-28c and the statement-view parts of CM-23d/e/f/g/h, the readers named in ADR-0054 §4 (branch names, service names, customer names) | ~230 | 50-5, 51-1b | no |

Order: **51-1a now** (unblocked) → 50-4, 55-1, 55-2 and 50-5 land → 51-1b → 51-1c and 51-1d. 51-1c and 51-1d are sequential in time but touch disjoint files except `packages/contracts/src/commissions/**` and the module-map §3 Port rows, so they may be built in parallel and merged one after the other (PP-111.2). Two sub-PRs carry migrations (51-1a, 51-1c): they are built on separate local Postgres and **merged one at a time**; the number is taken at merge and never renamed (pipeline §2/§13). The last merged migration on `main` today is `0223`.

## 5. Data and locking

### 5.1 Schema changes

**`commission_carries`** (spec §6, D-22): `company_id`, `id`, `business_id`, `employee_id`, `kind` (`COMMISSION`|`TIP_CARD`), `amount` (numeric(14,3), **negative**), `source_statement_id`, `source_period`, `target_period`, `target_statement_id`, `created_at`. `UNIQUE (company_id, source_statement_id, employee_id, kind)`; `CHECK (amount < 0)`; `CHECK (target_period > source_period)`; composite FKs `(company_id, business_id, source_period, source_statement_id)` and `(company_id, business_id, target_period, target_statement_id)` → `commission_statements(company_id, business_id, period, id)`; `(company_id, business_id, employee_id)` → `employees(company_id, business_id, id)`. Insert-only: `GRANT SELECT, INSERT` to `pospay_app`, `REVOKE ALL` from `PUBLIC`, `pospay_auth`, `pospay_dispatcher`; no UPDATE, no DELETE. RLS `ENABLE` + `FORCE` with `company_id = app_company_id()` `TO pospay_app`. Indexes on each FK's exact columns. **CM-R11** (company B reads 0 of A's rows, every insert for A fails as B) in the same PR. 53-2 writes the table; 51-1 only reads it.

**Permission catalog** (ADR-0025, the 0187 shape): `INSERT INTO permissions(code) VALUES ('review:commissions:business') ON CONFLICT DO NOTHING;` then `INSERT INTO role_permissions(role_id, role_owner_key, company_id, permission_code) SELECT r.id, 'global', NULL, 'review:commissions:business' FROM roles r WHERE r.company_id IS NULL AND r.code IN ('owner','general_manager','business_manager') ON CONFLICT DO NOTHING;` — global roles only, **no per-tenant data step**, no change to custom roles, memberships or personal overrides. Code side: `PERMISSIONS` in `packages/db/src/access-catalog.ts`, `OWNER_GRANTED_PERMISSIONS` and `ROLE_DEFAULTS` in `packages/db/src/role-defaults.ts`, and `OWNER_GRANTED_PERMISSIONS` + `OWNER_ONLY_EDIT_PERMISSIONS` in `apps/api/src/modules/identity/domain/permission-edit.ts`. The same migration must also carry the `read:commissions:business` code if 50-5 does not (Q6 in §10).

### 5.2 Lock order

- One `lockStatementPeriods(tx, { businessId, periods, ids })` call per transaction, **all** periods of that transaction in **one** call, ascending (the helper sorts them). It creates the DRAFT row with an id from the injected `IdGenerator` (UUID v7) and then takes `SELECT … FOR UPDATE`.
- `assertStatementPeriodsOpen` refuses `APPROVED`/`PAID` → typed `StatementPeriodClosedError` → mapped to `COMMISSION_PERIOD_CLOSED` (CLAUDE.md §5: a typed error, never a plain `Error`).
- `generate` locks **only** the requested period. It writes no correction and no carry (53-2 does both, and D-13 then locks every candidate month in one ascending call).
- `GET` **never locks and never writes** (FR-025, D-25, ADR-0054 §5): one `READ ONLY` transaction (the `{ readOnly: true }` option of `withTenant` that **50-5 adds** — `TenantOptions` has no such option today). CM-28b asserts after the call that no statement row, no fingerprint and no lock is left behind.

### 5.3 Transaction and role per step

| Step | Role and transaction |
| --- | --- |
| permission and business-wide predicate | `pospay_app`, `withTenant`, one read-only transaction (the identity reader bound at the root, D-16) |
| `generate` | `pospay_app`, `withTenant`, **one** transaction: `lockStatementPeriods` → read the projection rows → run the pure builders → `hash` → `UPDATE commission_statements SET current_fingerprint = …` → audit → commit. One transaction, no nested one (CLAUDE.md §6) |
| `GET` | `pospay_app`, `withTenant(…, { readOnly: true })`, one read-only transaction, no lock, no write |
| the hash itself | a `persistence/` adapter over `canonicalJson` + `node:crypto`; `use-cases/` may not import `@pospay/db` (ADR-0054 §6) |

### 5.4 The canonical contract of the two fingerprints (D-26 — 51-1 fixes it once)

**Input fingerprint** — the canonical input of one business and month, per employee in ascending id: ACTIVE projected lines (`line_id`, `revision`, `occurred_at`, `recorded_at`, `business_date`, `net_share`, `share_bps`, `rule_snapshot`, `counts`); sales (`sale_id`, `revision`, `price_paid`, `refunded_amount`); tip rows (`session_id`, `revision`, `method`, `amount`); the salary entry selected for the month's last day; the plan versions and the overrides that can apply in the month; the corrections received by the month; the **open blocked corrections** whose stored `target_statement_id` is this month's statement; the **incoming carries** whose `target_statement_id` is this month's statement (`source_statement_id`, `kind`, `amount`). Every list sorted by its identity; money as KWD strings; ISO dates only; `null` kept as `null`. **The branch attribution is NOT in the input fingerprint** (D-6, ADR-0054 §6) — it lives in the statement fingerprint.

**Statement fingerprint** — every statement row sorted by `(employee_id, source_ref)` with `kind`, `amount`, `previous_amount`, `new_amount`, `source_period`, `source_branch_id`, `source_branch_name_ar`, `source_branch_name_en` (both null when `source_branch_id` is), `source_business_date`, `attached_branch_ids` (sorted), the employee label (`employee_number`, `employee_name_ar`, `employee_name_en`) and, on a line source, `line_id`, `session_id`, `service_id`, `service_name_ar`, `service_name_en`, `customer_id`, `customer_name`, `business_date`; then every attachment row sorted by `(employee_id, branch_id, attached_from)` with `attached_to`. Row ids, `statement_id`, `company_id`, `business_id` and timestamps are left out. Money as KWD strings. Review hashes the builder's output; the freeze re-reads the rows and hashes the same shape (CM-34e's round trip).

Still open inside that contract: the sort key of each list (the spec says only "sorted by its identity"), whether the business/period identity sits inside the hashed value, and the `null` treatment of the optional detail columns — 51-1b's job to fix (ADR-0054 §6), recorded as `TODO(spec)` Q6 in §10.

## 6. Contract and HTTP

`packages/contracts/src/commissions/statement.ts` (+ its `-openapi.ts`), two response shapes — **not optional fields on one shape** (FR-025):

- **Business-wide** — `period`, `business_id`, `status`, `generated`, the employees with their per-employee totals (commission per source, sales, card tips, cash tips, corrections received, total, payable), the blocking issues per employee, `current_fingerprint`, `current_statement_fingerprint`, `reviewed_fingerprint`, `reviewed_statement_fingerprint`, `changed_since_review`, `changed_cause` (`INPUTS`|`STATEMENT`) and `return_required`.
- **Branch-scoped** — `period`, `business_id`, `status`, `generated`, the same employee rows **filtered to the reader's effective branch set** and the blocking issues for the visible employees, and **no whole-statement field at all**: no fingerprint, no `reviewed_*`, no changed-since-review flag or cause (FR-025, CM-28c).

The use case picks the shape from the same predicate as the guards: a current company- or business-scoped `ALLOW` of `read:commissions:business` with **no** `DENY` of it at any scope.

Error codes: `422 COMMISSION_PERIOD_NOT_ENDED` (the month has not ended in the business timezone, read through the root-bound `BusinessCalendarPort`); the **uniform `403 FORBIDDEN`** for every refusal (no permission at all, a branch-scoped reader on a whole-statement route, or a DENY) — the same code, never a distinguishing one; `409 COMMISSION_PERIOD_CLOSED` from `StatementPeriodClosedError`. `422 COMMISSION_STATEMENT_BLOCKED` is 52-1's, not 51-1's (51-1 lists the issues instead of refusing).

`Idempotency-Key`: the review request (FR-029) carries one; FR-025 does not say for `generate`. The position is the standard header, and the semantics of a repeated generate are `TODO(spec)` Q4 in §10.

Audit: `commission_statement.reviewed`, `.approved` and `.returned` are named by the spec; **no audit entry for `generate` is named** — `TODO(spec)` Q5 in §10. The `audit_log.action` CHECK (`^[a-z][a-z0-9_.]{1,62}$`) accepts `commission_statement.generated` if the owner picks it.

Outbox: **none** from 51-1. `StatementAwaitingReview` and `StatementAwaitingApproval` are 52-1's, `CommissionCorrectionBlockedNoticeRequested` is 55-2's.

Module map and ADR: 51-1 **names** the branch-names, service-names and customer-names reader ports that `docs/module-map.md` §3 already reserves for it ("port named by 51-1" / "port named by the sub-PR that adds it"), and replaces those placeholders with the real interface names. A root-bound read adds a Port row and **no import arrow** (D-29). ADR-0054 §6 gains the canonical contract; §5 needs no addendum (51-1's folder is `use-cases/get-statement/`, already listed there). ADR-0054's own status line still says "Proposed … number provisional": 51-1 must not renumber it, but the manager should confirm the status is final.

## 7. Speed

- The **200 ms rule** (CLAUDE.md §6) applies to both routes: anything expected to exceed it must be a BullMQ job in the worker, never a synchronous wait in the API.
- `generate` runs the whole month of one business inside the transaction that holds the statement lock: assembly + engine + canonical JSON + SHA-256 over every line, sale, tip, salary, version, override, correction, blocked correction and carry of the month. `GET` runs the same computation.
- **Measure before deciding.** PP-165: a perf check is a **ratio to the unchanged baseline measured in the same run**, never a fixed millisecond limit. If the p99 of `generate`/`GET` over a realistic month exceeds 200 ms, the answer is a worker job — but FR-025 says `generate` "computes the view … and returns the view" synchronously, so that needs an owner answer (`TODO(spec)` Q3 in §10).
- EXPLAIN / query-shape assertions that 51-1 owns: the statement row read by `(company_id, business_id, period)` (the unique index exists), the incoming-carries read by `(company_id, business_id, target_period, target_statement_id)` (the new index), and the frozen rows read for a closed month (`commission_statement_lines_statement_idx`, `commission_statement_attachments_statement_idx` — both exist). The projection reads themselves belong to 50-5's readers, not to 51-1.

## 8. Permissions

| Code | Who by default | Who grants | Owner |
| --- | --- | --- | --- |
| `read:commissions:business` | owner, general manager, business manager, accountant **and branch manager** (CS-Q14 = PP-17.2) | grantable | **50-5** (§6 _Permissions_) |
| `review:commissions:business` | owner, general manager, business manager (CS-Q2b = PP-25.1; CS-Q2, Abu Salem) | granted and revoked **by the owner only**, to a named person (CS-Q2, CS-Q37 = PP-101.1) | **51-1** |
| `approve:commissions:business` | owner only (CS-Q5) | owner only | 52-1 (not 51-1) |

- `review:commissions:business` **only works together with a business-wide read**: the holder must also hold a current company- or business-scoped `ALLOW` of `read:commissions:business` with no `DENY` of it at any scope. A branch manager holding review gets the **uniform 403 `FORBIDDEN`** before any fingerprint is computed or returned (CS-Q26 = PP-24.1, FR-029, CM-33d) — including on `generate`, which returns the whole view.
- The **business-wide reader** is exactly that predicate; a union of branch-scoped grants is **not** a business-wide grant (CS-Q20 = PP-20.1), and a business-wide holder with any `DENY` is filtered (CM-23g). An empty effective branch set (no grant, or a business-wide ALLOW with a business-wide DENY) is the **uniform 403**, never an empty list. DENY wins at any scope and from any membership; expired overrides are ignored.
- Owner-only grant/revoke: the code is added to `OWNER_GRANTED_PERMISSIONS` in **both** `packages/db` and `apps/api/src/modules/identity/domain/permission-edit.ts`, and to identity's `OWNER_ONLY_EDIT_PERMISSIONS`; the existing parameterized proofs for a non-owner SAVE (ALLOW and DENY) and REVOKE refusals, and the owner success cases, are reused. The grant-screen warning (FR-029b) is 52-1's, not 51-1's.

## 9. Tests (mapped to the CM ids and to the owning sub-PR)

| Sub-PR | Tests |
| --- | --- |
| 51-1a | **CM-R11** — company B reads 0 of A's `commission_carries` rows and every insert for A fails as B; `relforcerowsecurity` is true; the grants and the tenant-table inventory accept the new entries and fail without them; each FK, CHECK and UNIQUE constraint refuses a bad row |
| 51-1b | the pure round trip of the two builders: the same input gives the same hash and every input kind changes it (line, tip, salary, sale, plan version, override, correction received, blocked correction, incoming carry) — CM-28's unit half; the canonical JSON shape (KWD strings, ISO dates, `null` kept, sorted lists, no `bigint`); the builder's rows hash to the same value as the same rows read back (CM-34e's round-trip unit test; the integration half lands with 53-2) |
| 51-1c | **CM-27** (the DRAFT row exists; per-employee commission/sales/tips/corrections/total/payable; a negative total shows negative and pays 0; the blocking issues per employee; nothing per line is stored); **CM-28**'s integration half (generating twice gives the same value; an applied input change changes it); **CM-29** (a month that has not ended → 422 `COMMISSION_PERIOD_NOT_ENDED`, and the estimate is still readable); **CM-33** (without `review:commissions:business` → 403; the defaults; the owner grants it to the accountant and revokes it, each taking effect on the next request; a business manager trying to grant it is refused); **CM-33d**'s generate-only part (a branch manager holding review gets the uniform 403, the statement stays DRAFT, no fingerprint is returned, no audit row is written); the migrate-only regression (companies and owner/manager memberships created before the permission migration: the approved defaults work without re-running the seed, non-default roles get no implicit grant) |
| 51-1d | **CM-28b** (a `GET` of a never-generated month returns the computed view with `generated: false` and leaves no statement row, no fingerprint and no lock — asserted in the database after the call); **CM-28c** (a branch manager's response matches the branch-scoped shape with no fingerprint/`reviewed_*`/changed-since-review field and is unchanged after a rename in another branch, while the business manager's response carries both fingerprints and shows `STATEMENT`); the statement-view parts of **CM-23d, CM-23e, CM-23f, CM-23g, CM-23h**; the constructor-surface unit test of the read use case (reader ports only) (D-25, ADR-0054 §5) |

No UI in 51-1: the statement screen is 53-3's. DB tests run on a private Postgres, one at a time.

## 10. Risks and open questions

**Risks.** (1) 51-1a and 51-1c both carry migrations → the migration lane is one merge at a time, and the number is taken at merge. (2) 51-1b fixes a canonical contract that no later release may change: if 50-4/55-1/55-2 change a column or a filter, every stored fingerprint becomes stale and needs a data migration. (3) 51-1c edits 50-5's estimate use case (the row says 51-1 "adds the incoming carries to 50-5's estimate") → 51-1 is **not** file-disjoint from 50-5 and must be built after it merges. (4) 51-1d's read-only transaction depends on the `{ readOnly: true }` option that 50-5 adds to `withTenant`; without it CM-28b has no proof. (5) #1010 and 51-1 both edit `packages/commissions-engine/src/index.ts`, `docs/module-map.md` and ADR-0054 → rebase on `main` after each merge. (6) ADR-0054 still carries the status "Proposed … number provisional" — confirm before 51-1 cites it as binding.

**Open questions.** Each is `TODO(spec)` until the owner answers; the business/feature ones go to the decisions page, the technical ones to Waleed only.

- **Q1 — starting 51-1 before the blockers, with the sales/corrections/blocked-corrections inputs stubbed empty (blocks 51-1b, 51-1c, 51-1d).** CS-Q38 answered «wait for 55-2», but the broader case of 50-4 (sales) and 55-1 (corrections) is not settled, and the hash-stability consequence is new: a fingerprint computed without those inputs must be recomputed once they exist, which invalidates every stored `current_fingerprint` and every `expected_fingerprint` a reviewer already saw. Options: 1 ⭐ **لا، ننتظر 50-4 و55-1 و55-2 زي ما CS-Q38 قرر**، والبصمة تتثبّت مرة واحدة كاملة زي D-26؛ 2 نبدأ 51-1b دلوقتي بنسخة مؤقتة من العقد (من غير بيع ولا تصحيحات ولا وقوف) ونعيد تثبيتها لما الجداول توصل، والـ view يعرض إن البصمة مؤقتة لحد ما تتعاد؛ 3 نبني العقد الكامل دلوقتي (بكل الحقول والجداول المقترحة) والـ hash يبقى على المدخلات الفاضية لحد ما الجداول توصل.
- **Q2 — what happens to the fingerprints already computed under an incomplete contract (blocks the migration plan of Q1 option 2/3).** Options: 1 ⭐ **مفيش إصدار قبل العقد الكامل**؛ 2 إعادة توليد تلقائي: الـ writer يعيد حساب `current_fingerprint` في كل كتابة والـ view يعرض «تغيّر منذ المراجعة» بسبب `INPUTS` من غير راية جديدة؛ 3 راية صريحة `fingerprint_contract_version` على صف الكشف، والـ migrations تعيد الحساب.
- **Q3 — the 200 ms rule against a synchronous `generate`/`GET` (blocks the route design).** Options: 1 ⭐ **نقيس الأول (PP-165 بنسبة إلى الأساس في نفس التشغيل) ونبقي المسارين متزامنين طالما هما داخل الـ 200 ms**، ولو عدّيناها يبقى `generate` مهمة BullMQ في الـ worker والـ GET يقرأ المحفوظ؛ 2 من دلوقتي `generate` مهمة worker والـ GET يقرأ `current_fingerprint` المحفوظ؛ 3 نخلي `GET` على دفعات (صفوف على دفعات) ونبقي `generate` متزامناً.
- **Q4 — `Idempotency-Key` on `generate` and the semantics of a repeated generate (blocks the HTTP contract).** Options: 1 ⭐ **`generate` takes an `Idempotency-Key` like `review` (FR-029)، ومفتاح متكرر يرجع النتيجة المحفوظة**؛ 2 `generate` naturally idempotent (يعيد الحساب ويكتب `current_fingerprint`) وما بياخدش مفتاح؛ 3 مفتاح مطلوب، ومفتاح متكرر بعد تغيّر مدخلات يعيد الحساب ويرجع النتيجة الجديدة.
- **Q5 — does `generate` write an audit entry (blocks the audit contract).** The spec names `commission_statement.reviewed`, `.approved` and `.returned` but nothing for the generate. Options: 1 ⭐ **أيوه، `commission_statement.generated`** بنفس سطر الـ audit بتاع `commission_statement_lines` (من غير مبلغ ولا بصمة ولا اسم)؛ 2 لأ، `generate` مايكتبش audit (بيعمل قراءة وتخزين)؛ 3 أيوه بس سطر واحد بس لكل بصمة جديدة.
- **Q6 — the remaining canonical-contract details of D-26, and who registers `read:commissions:business` (blocks 51-1b and the permission migration).** The sort key of every list, whether the business/period identity sits inside the hashed value, the `null` treatment of the optional detail columns — and the fact that the row 50-5 does not say it carries the `read:commissions:business` catalog code, ROLE_DEFAULTS entry and reference-data migration, although §6 _Permissions_ and FR-028 make that code a prerequisite of 51-1's `GET`. Options: 1 ⭐ **51-1b fixes the contract once and documents it in ADR-0054 §6 with the CM-34e round trip, and 50-5 registers `read:commissions:business` with its own migration**؛ 2 نأجّل تثبيت العقد لحد ما 50-4/55-1/55-2 يحددوا أعمدتهم النهائية، و51-1 يسجّل الكودين في نفس الـ migration.

**Spec inconsistencies found while planning** (for the manager, they do not need an owner):

1. The row 51-1 lists its dependencies as `50-5, 55-2`, but §6 _Fingerprint_ makes the input fingerprint read the **sales** (50-4's table) and the **corrections received by the month** (55-1's table). The row's list is incomplete; the transitive closure of §3 is the honest one.
2. The row 50-5 does not say that it registers `read:commissions:business` in the catalog, in `ROLE_DEFAULTS` and in a reference-data migration, although §6 _Permissions_ and FR-028 make that code a prerequisite of 51-1's `GET`. 50-5's row mentions only "HTTP + permission".
3. The row 51-1 item 1 makes 51-1 edit 50-5's estimate use case; combined with "51-1 fixes the full canonical contract", 51-1 and 50-5 are strictly sequential, not parallel.
4. CM-27 writes "ليلى generates October" while CM-23c, CM-28c and CM-33d use "ليلى, branch manager of السالمية" — under FR-029 and §6 _Permissions_ a branch manager cannot generate. Low severity: the spec reuses the name for two roles, but the CM-27 scenario needs a business-wide reader.

## Summary

**Dependency verdict: 51-1 is blocked as a whole on 50-4, 55-1, 55-2 and 50-5 (all NOT STARTED, and CS-Q38 already ruled «wait for 55-2»); only `commission_carries` (51-1a) and the `review:commissions:business` registration can land today, and 51-1b/51-1c/51-1d follow the blockers.**
