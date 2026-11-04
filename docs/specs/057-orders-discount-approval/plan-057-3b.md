# Plan 057-3b — The owner/team bell for a self-performed discount approval (DA-Q3, D-19, DP-19c)

> **Status (plan draft — historical):** Implementation plan, second revision after two advisory reviews. The claim "no production code, tests or migrations are written by the plan's author; nothing is approved, merged, deployed or claimed passing" describes the **drafting moment**, not the current tree.
> **Implementation status (2026-10-26 — current):** implemented on this worktree, **unmerged**. The delivery is **one** migration — `0188_2026-10-26_discount-self-approval-notices.sql` — carrying both the new ledger table and the `alert_rules_kind` CHECK widening (no `0189`; the header of 0188 records both DDL steps).
> **Gate receipts, by runner and completeness (no receipt is inflated):**
> - **Parent receipts (complete):** the full worker orders suite `pnpm --filter @pospay/worker exec vitest run src/modules/orders` — **54 files / 314 tests, exit 0**, recorded run ending 14:04:40 at 231.94 s; plus 12 focused parent checks green (contracts parity, Prettier globs and docs, explain/bell/groups specs, db RLS + privileges, worker `tsc`/`eslint`, `lint:docs`, `module-map:check`, `git diff --check`).
> - **Parent receipts (incomplete — NOT green, NOT a proven timeout):** repeated `delegation_verify` full-orders runs stopped at exit 1 mid-run with ~29 passing files and **no final summary**; an incomplete run is not a completed failing suite and no cause is asserted for it.
> - **Author receipts (this worker, complete):** the same focused gates re-run green on the final tree after correction 4/4 (exact commands in the delivery report), and the full worker orders suite re-run green in a completed background run.
> - **Root `pnpm check`:** **not completed on the final tree.** The only full-root run so far (author, earlier correction) used the whole-main-`.env` `--env-file` bootstrap, which the pipeline review ruled unsafe for the root gate; it finished with 64/67 turbo tasks and `@pospay/api#test` failing 86 files / 314 tests, all with the staff synthetic device-setup 500. That 500 **cause is unknown** (a separate benchmark on the clean baseline `5e3c42b` independently reproduced 2 timing failures, 7/9 passed — which neither waives the gate nor identifies a cause). The deciding root gate is the Redis-only in-memory bootstrap preserving the private PG lane (preflight + PING at 127.0.0.1:6379); its receipt is appended when complete.
> **Not claimed:** any reviewer acceptance (Astra DB review, Sonnet layer 2), the six PR bots, CI, or any staging/deploy step — all still owed per `docs/agent-delivery-pipeline.md`.
> **Baseline (draft):** worktree `feat/p1-057-3b-self-approval-notice` at `5e3c42b055b1f1e344d5affa1a19e8fb67fdb654` (main @ #697), clean.
> **Spec:** [spec.md](spec.md) §6 (PR row 057-3b, DP-19c, D-19) · **Owner questions:** [owner-questions.ar.md](owner-questions.ar.md) — DA-Q3, DA-Q10, DA-Q11, DA-Q12 are answered; **no new owner question is needed and none is guessed.**

## Goal

Land the consumer side of the self-approval bell: worker `orders` consumer `orders.discount-self-approval-notice-v1` consuming `DiscountApprovedByPerformer`, claiming one row per source event in a new `discount_self_approval_notices` tenant ledger, resolving recipients from the effective alert rule of the new kind `DISCOUNT_SELF_APPROVED` (master switch + per-kind editable rule, default `owner`, `IN_APP`, branch-scoped), appending `DiscountSelfApprovalNoticeRequested` to `notifications` in groups of at most 100 — once per event, replay/concurrency/rollback safe, inside the existing `withTenant` consumer transaction, no new transaction, HTTP or BullMQ call in the consumer. The writer (057-6) is out of scope; the consumer is built and fixture-tested before its writer exists, exactly as 057-3 was.

## Architecture

- **Templates, both already merged.** Structure mirrors 057-3 ([`discount-approval-notice.ts`](../../../apps/worker/src/modules/orders/use-cases/request-discount-approval-notice/request-discount-approval-notice.ts), its [ports](../../../apps/worker/src/modules/orders/ports/discount-approval-notice.port.ts), [domain](../../../apps/worker/src/modules/orders/domain/discount-approval-notice.ts), [persistence](../../../apps/worker/src/modules/orders/persistence/discount-approval-notice.repository.ts), [tests](../../../apps/worker/src/modules/orders/__tests__/discount-approval-notice.spec.ts)); rule reading mirrors the price-edit bell ([`request-price-edit-notice.ts`](../../../apps/worker/src/modules/orders/use-cases/request-price-edit-notice/request-price-edit-notice.ts) + [`alert-rule-bell.ts`](../../../apps/worker/src/modules/orders/domain/alert-rule-bell.ts)).
- **Already merged (057-1, 62-x, A-0):** both event contracts ([`discount-approval-events.ts`](../../../packages/contracts/src/orders/discount-approval-events.ts)), recipient/parameters ([`in-app-notifications.ts`](../../../packages/contracts/src/in-app-notifications.ts)), template `discount_self_approved` rev 1 ([`discount-self-approved.ts`](../../../packages/notifications/src/templates/discount-self-approved.ts)), `DiscountSelfApprovalNoticeRequested` in worker `notifications` `NOTIFICATION_SOURCE_EVENTS` and `KNOWN_EVENT_TYPES`, worker `settings` `alertRule` reader, worker orders `AlertRulesPort` adapter, `bellDelivery`, identity `branchManagerRecipients`, tenancy `companyOpen`/`branchPlace`. **No new module arrow** — `orders → identity, settings, tenancy` is declared in [`docs/module-map.md`](../../module-map.md) §2 line 43; only exact per-adapter `reads` registrations are added (task 12).
- **Minimal source proof, not envelope derivation.** The handler checks event type + Zod schema; the repository then proves the event against the stored immutable proposal facts (`matchesProposals`) before any claim. No aggregate-type/aggregate-id convention is imposed on the 057-6 source writer (review items 7-8 below).

## Tech Stack

TypeScript worker modules (plain functions + one use-case class), Drizzle `sql` on the caller's `Tx`, PostgreSQL 16 with `ENABLE` + `FORCE` RLS, Zod contracts, Vitest on the T2 compose Postgres, one cloned database per spec file (**ADR-0006 — real Postgres, never mock-only proof**), drizzle-kit migrations under the ADR-0033 recoverable concurrent-index runner.

## Global constraints (verbatim, governing this PR)

> - "**New table ⇒ new policy + negative isolation test, in the same PR.** A tenant table's primary key is `(company_id, id)` — never `id` alone" (`CLAUDE.md` §5).
> - "All tenant-data access goes through `withTenant(companyId, tx => …)` … **Exporting the raw Drizzle client from `packages/db` is forbidden** — modules receive `tx` only." (`CLAUDE.md` §5).
> - "**A use case never contains the words `drizzle`, `sql`, `fetch` or `axios`.**" / "**No arithmetic in a use case.**" (`CLAUDE.md` §4.2).
> - "`Clock` and `IdGenerator` are ports. A use case that calls `Date.now()` or `crypto.randomUUID()` directly … will be rejected." (`CLAUDE.md` §4.3).
> - "**Arabic JSDoc is mandatory** on `domain/**`, `ports/**` and `events/published.ts`" (`CLAUDE.md` §3.1); "A doc comment MUST change in the same commit as the function it describes." (constitution Principle VII).
> - "`max-lines`: **300 warn / 400 error** … `max-lines-per-function`: 60." (`CLAUDE.md` §3).
> - "A module may import **only** another module's `index.ts`." (`CLAUDE.md` §4.1).
> - "**Integration tests for each use case** … against a real Postgres" and "**RLS negative tests for every tenant table**" (`CLAUDE.md` §9).
> - "**One use case per PR**" (`CLAUDE.md` §1); the slice is done only when `CLAUDE.architecture.md` §15 passes.
> - Migrations "follow **expand/contract** … and are never destructive in the same release as the code change." (`CLAUDE.md` §10).
> - "The **database reviewer** (Codex astra 6 medium, read-only) reviews every PR that touches `packages/db/**`" (pospay-pipeline SKILL §5) — mandatory here.

## Owner-approved decisions implemented (settled — nothing re-asked)

| Decision | Content | Source |
|---|---|---|
| DA-Q3 | A performer may approve a discount on her own line; flagged `approver_is_performer`, bell to the rule's recipients | batch 34 |
| DA-Q10 | Approving owner **not excluded**; every active owner covering the branch is told, single-owner salon included | batch 43, PP-26.1 |
| DA-Q11 | Request bell (057-3) **always on** — untouched by this PR; self-approval bell follows the master switch and its own editable rule | batch 45, PP-29.2 |

**Chosen identifiers:** alert kind `DISCOUNT_SELF_APPROVED` (matches `ALERT_KINDS` convention and spec 057 §6); template `discount_self_approved` rev 1 (merged); consumer id `orders.discount-self-approval-notice-v1` (spec §6); outbound notice aggregate `discount_self_approval` correlated by the ledger row id (task 6); ledger table `discount_self_approval_notices`.

## Scope and exclusions

**In scope:** the ledger migration (table + RLS + grants), the `alert_rules_kind` CHECK widening, catalog registration (domain, contracts, i18n, admin listed kinds), the worker consumer (domain, ports, use case, handler, persistence, wiring, root registration), delivery/rule/groups/EXPLAIN/always-on tests on real Postgres, module-map `reads` registrations.
**Out of scope:** 057-6 (approve/reject writer, `approver_is_performer` computation, PIN/device routes, event emission); any change to the 057-3 consumer beyond a new guard test; 057-9 edit path; UI work beyond kind registration; contracts/events/templates except the `alertKind` enum and the required `max(15)` bound; unrelated modules.

## Advisory review record (this revision)

Both design advisors of the pipeline (Codex `gpt-6-astra` medium — "Astra"; Claude Fable 5.1 medium — "Fable"), read-only, reviewed the first draft; the parent consolidated their findings. Dispositions below are plan edits only; **no advisor PASS is claimed on anything**, and the implementation PR still owes the pipeline's review layers (DB review, layer 1, layer 2, bots).

| # | Finding (Astra/Fable) | Disposition in this plan |
|---|---|---|
| 1 | DB catalog blocker: `packages/db/schema/settings.ts:101-106` `ALERT_KINDS_SQL` and the `alert_rules_kind` CHECK omit the kind | Task 1: schema edit + generated CHECK-widening migration + tests |
| 2 | Admin blocker: [`listed-alert-kinds.ts`](../../../apps/admin/src/settings/alert-rules/model/listed-alert-kinds.ts):4-17 hardcodes the listed kinds; no automatic display | Task 2: add the kind, update the comment, extend `listed-alert-kinds.spec.ts` and `alert-rules-page.spec.tsx` |
| 3 | Generated API clients must be regenerated; `max(15)` is required, not optional; assert default owner/no-timing and enum parity | Task 2 + success commands |
| 4 | Fixture cannot INSERT `APPROVED`: migration [`0166`](../../../packages/db/migrations/0166_2026-10-21_discount-proposal-expiry-immutable.sql):5-8 rejects non-PENDING inserts | Task 7: insert PENDING, then UPDATE only the trigger-allowed decision columns |
| 5 | Two distinct concurrency proofs; `sourceEventId = event.id` from the envelope, not the payload | Tasks 5/7 |
| 6 | EXPLAIN of an INSERT asserts the conflict arbiter, not `Index Cond` | Task 10 |
| 7 | Add `matchesProposals` source proof before claim; accept `APPROVED`/`CONSUMED`; no envelope-aggregate derivation | Tasks 4-7 |
| 8 | Drop the aggregateType/min-proposal-id convention and any 057-6 requirement; choose a narrow outbound correlation only | Task 6 |
| 9 | Module-map is NOT unchanged: exact adapter `reads` registrations + `module-map:generate` | Task 12 |
| 10 | Approver fallback: reuse `inApp.editor_generic`; `maxPercentText` verified exported | Tasks 3/6 |
| 11 | RLS error-code split (`42501` vs `23503`); zero-count replay retention; no-`IN_APP` case; overlapping-membership dedupe | Tasks 1/7-9 |
| 12 | Migration workflow: author schema first; parent runs root `pnpm db:generate discount-self-approval-notices` (verified script); number provisional, date = actual work date | Task 1 + workflow below |

**Parent correction accepted:** the parent's earlier worry that decision columns might be absent was wrong — [`orders-discount-proposals.ts`](../../../packages/db/schema/orders-discount-proposals.ts):59-78 already carries `decidedBy`/`decidedVia`/decider snapshots/`approverIsPerformer`; the fixture UPDATEs them, nothing is added.

## Migration workflow (orchestrator + author; the implementer cannot shell)

1. The author edits the schema TS first: the new `discountSelfApprovalNotices` table in [`orders-discount-proposals.ts`](../../../packages/db/schema/orders-discount-proposals.ts) and `DISCOUNT_SELF_APPROVED` in `ALERT_KINDS_SQL` in [`settings.ts`](../../../packages/db/schema/settings.ts) (both diffs are one expand-only release unit).
2. The **parent runs `pnpm db:generate discount-self-approval-notices` from the repository root** (root `package.json` verified: `"db:generate": "pnpm --filter @pospay/db db:generate"` — do not invoke anything inside `packages/db` by hand) and hands the generated SQL back.
3. The **author edits the generated SQL**: for the new table, into the shape of [`0172`](../../../packages/db/migrations/0172_2026-10-22_discount-approval-notices.sql) (leading `SET LOCAL lock_timeout = '5s';` + Arabic header, FKs, `(company_id,business_id)` index, `ENABLE`/`FORCE` RLS, two explicit policies, `REVOKE ALL … FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher;`, `GRANT SELECT, INSERT TO pospay_app;`); for the CHECK, keep the generator's `ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_kind;` + `ADD CONSTRAINT alert_rules_kind CHECK (kind IN (<15 kinds>))` in one transaction — expand-compatible, no data step.
4. **Numbers/date are provisional until merge:** highest baseline migration is `0187`; working names `0188_2026-10-26_discount-self-approval-notices.sql` (and `0189_…_alert-rules-kind.sql` if the generator splits the CHECK), dated at actual generation per the established renaming convention; the orchestrator renumbers at merge. Nothing claims the migration was applied — only `pnpm db:migrate` against T2/test applies it.

**Actual outcome (2026-10-26):** the generator emitted **one** file, `0188_2026-10-26_discount-self-approval-notices.sql`, carrying the table DDL and the `alert_rules_kind` CHECK widening in a single expand-only migration (no `0189`); the RLS/grant hardening followed the 0172 shape and its header records both DDL locks. Renumbering at merge, if needed, stays the orchestrator's step.

## Tasks (TDD order; acceptance assertions inline)

### Task 1 — DB layer: ledger table + `alert_rules_kind` widening + RLS + grants

**Files:** `packages/db/schema/orders-discount-proposals.ts`; `packages/db/schema/settings.ts`; migrations `0188_…_discount-self-approval-notices.sql` / `0189_…_alert-rules-kind.sql` (provisional, per workflow); `packages/db/test/table-grants.ts`; `packages/db/test/tenant-table-inventory.ts`; new `packages/db/src/__tests__/rls-discount-self-approval-notices.spec.ts` (modelled on the [057-3 sibling](../../../packages/db/src/__tests__/rls-discount-approval-notices.spec.ts)).

**Table (exact):** `company_id`, `id`, `business_id`, `source_event_id`, `decided_at timestamptz`, `recipient_count int`; PK `(company_id,id)`; `UNIQUE (company_id, source_event_id)` as `discount_self_approval_notices_source_event_key`; CHECK `recipient_count >= 0`; FKs `…_company_fk (company_id)→companies(id)`, `…_business_fk (company_id,business_id)→businesses(company_id,id)`; index `…_business_fk_idx (company_id,business_id)`. `source_event_id` is deliberately **not** an FK to `outbox` (old outbox cleanup must not break the ledger, as the 057-3 comment records). Schema TS also adds `DISCOUNT_SELF_APPROVED` to `ALERT_KINDS_SQL` (settings.ts:101-106).

**Acceptance assertions:** `relrowsecurity`/`relforcerowsecurity` true, owner ≠ `pospay_app`; exactly the `_select`/`_insert` policies with `app_company_id()`; `UPDATE`/`DELETE`/`TRUNCATE` rejected `42501`; `pospay_app` `NOSUPERUSER`/`NOBYPASSRLS`; the five-name constraint list; **foreign-company insert rejected `42501`** (RLS `WITH CHECK`) **vs own-company/foreign-business rejected `23503`** on `discount_self_approval_notices_business_fk`; duplicate `(company_id,source_event_id)` refused `23505`; negative count `23514`; no-context connection sees 0 rows; rollback and interleaved `withTenant` reads never leak. Allowlist/inventory gain `discount_self_approval_notices:INSERT`/`:SELECT` and the table name; [`privileges.spec.ts`](../../../packages/db/src/__tests__/privileges.spec.ts) then covers them with no further edit. CHECK widening: a saved valid `DISCOUNT_SELF_APPROVED` rule inserts (asserted in task 8) and an unknown kind still fails `23514` (asserted here by direct insert).

### Task 2 — Catalog registration: domain + contracts + i18n + admin listed kinds

**Files:** `packages/domain/src/alert-rules.ts`; `packages/contracts/src/settings/alert-rules.ts`; `packages/i18n/src/alert-rules-catalog.ts`; `apps/admin/src/settings/alert-rules/model/listed-alert-kinds.ts` (+ its comment); tests: additions to `packages/domain/src/__tests__/alert-rules.spec.ts`, a new enum-parity test, [`listed-alert-kinds.spec.ts`](../../../apps/admin/src/settings/alert-rules/model/listed-alert-kinds.spec.ts), `apps/admin/src/settings/alert-rules/pages/alert-rules-page.spec.tsx`, `apps/api/src/modules/settings/__tests__/alert-rules.spec.ts` (14→15).

**Behaviour:** add `'DISCOUNT_SELF_APPROVED'` to `ALERT_KINDS` and to the contract `alertKind` enum (the two lists must stay identical). Definition: `managersInApp({ defaults: { enabled: true, recipientRoles: ['owner'], channels: IN_APP, delayMinutes: null, leadMinutes: null } })` — default **owner only**, `IN_APP` only, branch-scoped, no timing. Admin: append the kind to `LISTED_ALERT_KINDS` and update the comment (the file's own comment already names 057-3b as the adding PR); the deferred `STATEMENT_*` kinds stay unlisted. i18n `kind_DISCOUNT_SELF_APPROVED` in both catalogs (parity enforced by the `Record<keyof typeof alertRulesEn, string>` type): proposed en "Discount approved on the approver's own work", ar «موافقة على خصم على شغل الموافِق» (settings-screen label, not owner copy).

**Acceptance assertions:** the generic iterated tests now cover the kind; **new explicit assertions** — default `recipientRoles` equals `['owner']` exactly, `delayMinutes`/`leadMinutes` null, `hasDelay`/`hasLead` false, `alertKindAllowsBranchOverride` true, `alertRuleViolation(kind, default)` null; **new parity test** — contract `alertKind.options` equals `ALERT_KINDS` (none exists today); admin `listed-alert-kinds.spec.ts` proves the new kind is returned and editable while `STATEMENT_*` stay unlisted; `alert-rules-page.spec.tsx` proves a visible, editable row for the kind (visible-outcome assertions per `CLAUDE.md` §9); API view length 15. **Contract surface is exactly:** the enum addition and `setAlertRulesInput.rules` `max(14)` → **`max(15)` (required**, not optional — with 15 kinds a full-form save of every changed row would otherwise fail).

### Task 3 — Domain pure functions + unit tests

**File:** `apps/worker/src/modules/orders/domain/discount-self-approval-notice.ts` (new) + `domain/__tests__/` unit spec (no DB).

**Functions (full Arabic JSDoc):** `DiscountSelfApprovalNoticeNameFallback` = `{ service:{ar,en}, branch:{ar,en}, safeName }` — the approver fallback **reuses the existing `inApp.editor_generic` catalog label** («مستخدم» / "User", already in [`in-app-catalog.ts`](../../../packages/i18n/src/in-app-catalog.ts):31,70) through the injected fallback, as [`editor-label.ts`](../../../packages/i18n/src/editor-label.ts):36 does; no new i18n keys. `assertDiscountSelfApprovalEventValues` — per-proposal bps in `1..10000`, count in `1..20`, unique proposal ids; throws `DISCOUNT_SELF_APPROVAL_EVENT_INVALID` (the use case passes the **max over the proposals**, computed in domain, never in the use case). `discountSelfApprovalRecipientGroups` — dedupe/sort/chunk ≤100 (same contract as the sibling). `selfApprovalNoticeParameters` — seven parameters in the template's fixed order (`branch_name_*`, `approver_name_*`, `service_name_*` = first flagged proposal, `max_percent` = largest bps); bps→percent reuses the sibling's **`maxPercentText`, verified exported** at [`discount-approval-notice.ts`](../../../apps/worker/src/modules/orders/domain/discount-approval-notice.ts):37 (a sibling `domain` import, allowed by the boundaries config).

**Acceptance assertions (unit):** 100/1050/2050/10000 ⇒ `1`/`10.5`/`20.5`/`100`; invalid bps/count/duplicates throw; output parses against the contract tuple `discountSelfApprovedParameters`; a display-name-rejected decider label falls back per locale, never `null`/empty; groups of 0/1/100/101 chunk `[]`/`[1]`/`[100]`/`[100,1]`.

### Task 4 — Ports

**File:** `apps/worker/src/modules/orders/ports/discount-self-approval-notice.port.ts`.

**Interfaces (Arabic JSDoc per method):** `DiscountSelfApprovalNoticeEvent` (`companyId`, `sourceEventId`, `businessId`, `branchId`, `decidedBy`, `deciderLabelAr/En`, `decidedVia`, `proposals[{id, serviceId, nameAr, nameEn, effectiveBps}]`); `DiscountSelfApprovalNoticeRecipients` (`companyOpen`, `roleRecipients(event, at, roles)`); `DiscountSelfApprovalNoticePlace` (`branchPlace`); `DiscountSelfApprovalNoticeRepository` with **`matchesProposals(event)`** and `claim(event, decision)`; `DiscountSelfApprovalNoticeOutbox`; `DiscountSelfApprovalNoticePorts` (five, bound on the caller's `Tx`).

`matchesProposals` is the source proof (advisory item 7): true only when every flagged id exists in this tenant/business/branch with the **immutable stored facts** equal to the event — `service_id`, `effective_bps`, `decided_by`, `decided_via`, `approver_is_performer IS TRUE` — the count exact, and the status `APPROVED` **or** `CONSUMED` (a delayed/replayed event after legitimate consumption must not poison). It never re-evaluates the current performer link, permissions, expiry or staff labels; labels stay the decision-time snapshot the validated event carries.

### Task 5 — Persistence

**Files:** `apps/worker/src/modules/orders/persistence/discount-self-approval-notice.repository.ts` (claim + matches + outbox); `discount-self-approval-recipients.adapter.ts` (identity `branchManagerRecipients` + tenancy `companyOpen`). **Reuse** the existing `discountApprovalPlace` adapter (structurally compatible, already registered in module-map line 353) — no new place file.

**Claim (exact):** `INSERT INTO discount_self_approval_notices (company_id,id,business_id,source_event_id,decided_at,recipient_count) VALUES (…event.companyId, decision.id, event.businessId, decision.sourceEventId, decision.decidedAt::timestamptz, decision.recipientCount) ON CONFLICT (company_id, source_event_id) DO NOTHING RETURNING id`, where `decision.sourceEventId` is the **envelope `event.id`**, never a payload field. `matchesProposals` is one query per proposal id on the PK — `WHERE company_id AND id = $1` plus the fact columns — served by the `(company_id,id)` primary key; the EXPLAIN test (task 10) proves the PK arm. Outbox append: `aggregateType: 'discount_self_approval'`, `aggregateId: <ledger decision id>` — a narrow deterministic correlation for the outbound notice only (task 6); payload `discountSelfApprovalNoticeRequested.parse(payload)`.

### Task 6 — Handler + use case + wiring

**Files:** `events/handlers/on-discount-approved-by-performer.handler.ts`; `use-cases/request-discount-self-approval-notice/request-discount-self-approval-notice.ts`; `orders.module.ts`; `orders/index.ts`; `apps/worker/src/main.ts`.

**Handler:** checks `event.eventType === 'DiscountApprovedByPerformer'` and `discountApprovedByPerformer.safeParse(event.payload)`; malformed ⇒ throw `DISCOUNT_SELF_APPROVAL_EVENT_INVALID`. **No aggregate check, no derived envelope convention, nothing required of the 057-6 writer** — integrity comes from `matchesProposals` (advisory items 7-8; the earlier invented convention is dropped, and no ADR is needed since no new architecture decision remains).

**Use case `execute` (orchestration only):** 1) domain assert; 2) `matchesProposals` ⇒ false ⇒ throw `DISCOUNT_SELF_APPROVAL_EVENT_INVALID` (before anything is claimed); 3) `companyOpen` — a closed valid-source company returns **without claiming**, the event still consumed (sibling convention); 4) `bellDelivery(rules.rule(companyId, {businessId, branchId}, 'DISCOUNT_SELF_APPROVED'))`; 5) `decidedAt = clock.now()`; `roleRecipients(event, decidedAt, roles)`; 6) `branchPlace`; groups forced to `[]`/`0` when the branch is gone (recorded zero decision; tests inject a null place port — never a physical delete, `dp_branch_fk` forbids it); 7) `claim` with injected `ids.newId()`; `!won` returns (same-source retry/replay stops); 8) `recipientCount === 0 || channel === null || branch === null` returns — zero-recipient decisions are recorded once and never re-counted when the rule later changes; 9) publish one outbox append per group, recipients `{ channel:'IN_APP', user_id, locale:'ar', template_key:'discount_self_approved', template_revision:1, safe_parameters }`, `proposal_ids` = all flagged ids.

**Acceptance:** no `drizzle`/`sql`/`fetch` in the use case; `Clock`/`IdGenerator` injected; consumer `{ id:'orders.discount-self-approval-notice-v1', eventTypes:['DiscountApprovedByPerformer'], handle }`; one `withTenant` transaction, no nested tx/second connection; the fallback factory supplies `service`/`branch` labels and `safeDisplayName`, the approver fallback via `inApp.editor_generic`.

### Task 7 — Fixture + core delivery tests (real Postgres)

**Files:** `__tests__/discount-self-approval-notice.fixture.ts` + `-data.ts` + `-notice.spec.ts` (cloned from the [057-3 family](../../../apps/worker/src/modules/orders/__tests__/discount-approval-notice.fixture.ts)).

**Seeder (advisory item 4):** insert proposals as `PENDING` through the existing valid fixture path, then `UPDATE` **only the trigger-allowed decision columns** ([`0166`](../../../packages/db/migrations/0166_2026-10-21_discount-proposal-expiry-immutable.sql):5-25: `status`, `decided_*`, decider snapshots, `approved_limit_*`, `approver_is_performer`) — `expires_at` untouched — then append the outbox event with the merged contract payload. Knobs: `malformed`, `mismatchFacts`, `again(prepared)`.

**Named tests:** 1) **DP-19c default rule** — owners أم فهد and سلمى, أم فهد approved ⇒ both get one bell (approver included, DA-Q10); a non-owner branch manager gets nothing; payload carries branch, first flagged service, largest percent, approver label; **no customer name or phone**; 2) single approving owner gets her own bell; 3) once per source event — redeliver, and re-deliver after `DELETE FROM consumed_events`, keeps one ledger row and one notice set; 4) **concurrency A** — the *same* `ClaimedEvent` delivered in parallel through the deliverer ⇒ `consumed_events` dedupe ⇒ one ledger row; 5) **concurrency B** — two connections run `db.withTenant(company, tx => consumer.handle(tx, sameEvent))` directly ⇒ ledger `ON CONFLICT` arbitration ⇒ one winner, one ledger row, one notice set; 6) **distinct event ids** for the same decision ⇒ two ledger rows; 7) zero owners ⇒ ledger `recipient_count 0`, no notice, consumed, no error; 8) closed company ⇒ nothing claimed, consumed (restored in `finally`); 9) injected null place ⇒ ledger row count 0, no notice, not retried; 10) malformed payload ⇒ throws, **no ledger claim**; 11) `matchesProposals` mismatch — wrong tenant/company/branch, unflagged id, wrong `service_id`/`effective_bps`/`decided_by`/`decided_via`, `approver_is_performer` not true, count mismatch — each throws `DISCOUNT_SELF_APPROVAL_EVENT_INVALID` **before any ledger row/bell**; 12) a valid event whose proposals are already `CONSUMED` is accepted (no poison); 13) rollback — a throwing outbox after claim rolls back the whole transaction, no ledger/notice survives; 14) **complete inbox delivery** — deliver the produced notice through the real in-app consumer ⇒ one `in_app_notifications` row per recipient, `template_key 'discount_self_approved'`, rev 1, parameters matching the template slots.

### Task 8 — Alert-rule behaviour tests

**File:** `__tests__/alert-rule-self-approval-bell.spec.ts` (modelled on [`alert-rule-price-edit-bell.spec.ts`](../../../apps/worker/src/modules/orders/__tests__/alert-rule-price-edit-bell.spec.ts); `saveRule(kind 'DISCOUNT_SELF_APPROVED')`, `setMaster`).

**Named tests:** default (owner only, approver included); business rule adding `branch_manager` ⇒ manager gets it too; kind off ⇒ count 0, no bell, consumed; branch rule off silences that branch; **master off ⇒ nobody, count 0, consumed**; master `NULL` on; **a rule with `channels` not containing `IN_APP` ⇒ no bell** (count 0); **zero-count replay retention** — claim with count 0 under an off rule, then switch the rule on, delete `consumed_events`, redeliver ⇒ still count 0, no bell (the ledger won once). Each test clears its rule rows in `finally`.

### Task 9 — Groups + dedupe

**File:** `__tests__/discount-self-approval-notice-groups.spec.ts`. 101 distinct owners ⇒ two outbox groups `[100,1]`, union equals the 101 sorted ids, one ledger row `recipient_count 101`. **Overlapping-membership assertion:** a user holding an owner and a branch_manager membership (rule roles = both) appears in exactly one group; the ledger counts her once.

### Task 10 — EXPLAIN

**File:** `__tests__/discount-self-approval-notice-explain.spec.ts`. For the claim (seed 10+ same-business decisions, `ANALYZE`, `SET LOCAL enable_seqscan=off`): the `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plan's **"Conflict Arbiter Indexes" contains `discount_self_approval_notices_source_event_key`**, **"Conflict Resolution" is `NOTHING`**, and the test executes both an inserting and a conflicting statement asserting the actual inserted/conflicted outcomes — **no `Index Cond` assertion on an INSERT** (the sibling spec's conflict-arm lines prove the JSON shape). For `matchesProposals`: a result-shape test plus EXPLAIN proving the PK `(company_id,id)` arm, no `Seq Scan`.

### Task 11 — Guard: 057-3 stays always-on

**File:** `__tests__/discount-approval-notice-always-on.spec.ts` (new; the 057-3 consumer is unchanged — it has no `AlertRulesPort` and gains none, DA-Q11). With `alerts_enabled = false` **and** a stored rule row, delivering `DiscountApprovalRequested` still rings every eligible approver (bell rows present, ledger count = approver count).

### Task 12 — Module-map registrations + generated clients + final checks

**Files:** `docs/module-map.md` — append two `reads` lines in the YAML-adjacent list (shape of lines 351-353): `orders -> identity.branchManagerRecipients @ apps/worker/src/modules/orders/persistence/discount-self-approval-recipients.adapter.ts` and `orders -> tenancy.companyOpen @ apps/worker/src/modules/orders/persistence/discount-self-approval-recipients.adapter.ts`; the reused place adapter is already registered (line 353). **No new arrow, no ADR.** The parent then runs `pnpm module-map:generate` (regenerates the YAML block) before `pnpm module-map:check`. After the contracts change the parent also runs `pnpm contracts:openapi`, `pnpm --filter @pospay/admin api:generate`, `pnpm --filter @pospay/pos api:generate` — regenerating [`apps/admin/src/shared/api/schema.d.ts`](../../../apps/admin/src/shared/api/schema.d.ts) and [`apps/pos/src/shared/api/schema.d.ts`](../../../apps/pos/src/shared/api/schema.d.ts); `pnpm check` includes both `api:check` gates. Final self-check: Arabic JSDoc on every new `domain/**` function and `ports/**` method; no `FIXME/HACK`; file limits; `git diff --check`.

## Dependencies and order

`1 (DB) ∥ 2 (catalog+admin)` → `3 → 4 → 5` → `6` → `7 → 8 → 9 → 10 → 11 → 12`. TDD within each task; the orchestrator runs all gates.

## Future success commands (parent/orchestrator runs; nothing here has been run)

```
pnpm check
pnpm --filter @pospay/worker exec vitest run src/modules/orders
pnpm --filter @pospay/db exec vitest run src/__tests__/rls-discount-self-approval-notices.spec.ts
pnpm module-map:check
git diff --check
```

Also: `pnpm --filter @pospay/db exec vitest run src/__tests__/privileges.spec.ts`; `pnpm --filter @pospay/domain exec vitest run`; `pnpm --filter @pospay/contracts exec vitest run`; `pnpm --filter @pospay/api exec vitest run src/modules/settings`; the admin alert-rules specs (`pnpm --filter @pospay/admin exec vitest run src/settings/alert-rules`); `pnpm contracts:openapi`; `pnpm --filter @pospay/admin api:generate`; `pnpm --filter @pospay/pos api:generate`; `pnpm module-map:generate` (before `module-map:check`). Generation: root `pnpm db:generate` by the parent, author RLS edits after.

## Plan-only success commands (for this document)

```
pnpm exec prettier --check docs/specs/057-orders-discount-approval/plan-057-3b.md
git diff --check
```

(Parent recorded both passing on the previous revision; they must pass again on this one.)

## Independent review

**Verdict at plan time (historical): not reviewed yet — this is the second draft.** Revision 1 was reviewed by the two design advisors; their findings are recorded above with dispositions, and no advisor passed anything at drafting time.

**Current state (2026-10-26):** implementation is complete on this worktree; gate receipts are listed by runner and completeness in the header (parent-complete, parent-incomplete, author, and the still-open root gate). **No reviewer acceptance is claimed.** Per `docs/agent-delivery-pipeline.md` the PR still owes: the mandatory Astra database/security review (`packages/db` is touched), the general review layer 1, one fresh-context Sonnet layer-2 review, **six** required bot reviews on the exact head (Codex bot, paid CodeRabbit, four MergePilot panel bots), green CI on that head, a completed root `pnpm check` under the safe Redis-only bootstrap, and the staging-only backup/restore/rollback workflow. Nothing here is merge-ready until those complete.

## Remaining concrete gaps (for the parent)

- The two new module-map `reads` lines and `pnpm module-map:generate` land in the same PR as the adapters (task 12) — **done**: lines for `identity.branchManagerRecipients` and `tenancy.companyOpen` on `discount-self-approval-recipients.adapter.ts`; the place read reuses the 057-3 `discount-approval-place.adapter.ts` registration (no new adapter file).
- The CHECK widening and the table arrived as **one** generated file, `0188` (see the migration workflow outcome above); the `2026-10-26` date stays provisional until merge renumbering.
- The 057-6 brief needs **no** aggregate convention (item 8) — only the already-merged contract payload; the plan previously invented one and has dropped it.
- The proposed kind label (task 2) is a proposal, not owner copy.
- Nothing else is left open by design; any genuinely new owner rule would be recorded and stopped, per `CLAUDE.md` §1 5b.
