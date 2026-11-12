# Plan 057-6 — Row 40: remote approve / reject (spec 057 FR-011…FR-014, FR-017, FR-018, FR-022, D-11, D-17, D-19)

> Task session «rows 39–41», batch 2026-11-11 (PP-168). Branch `feat/p1-057-discount-approval-39-41`, base
> `origin/main` 73dbfc2fd. Status: plan, revised after the Astra debate (`debate-40-astra.md`: findings 1, 4, 5, 6 applied here).

## 0. Where the rows stand (verified 2026-11-11)

| Row | Sub-PR | State on `main` |
|---|---|---|
| 41 | 057-5 consumption in create/append | **merged** (#657, 53d2036e0); 057-5b bindings merged (#595), index fix #911. The old branch `feat/057-5-discount-consumption` (5 commits, 2026-10-25) is the pre-squash history of #657; nothing on it is missing from `main` (its domain/use-case/adapter files exist on `main`: `use-cases/consume-discount-approval/`, `domain/discount-consumption.ts`, `persistence/discount-proposal-consumption.adapter.ts`). Not resurrected. |
| 40 | 057-6 remote approve/reject | **this plan** |
| 39 | 057-7 PIN on the paired device | `plan-39.md`; implemented only after 057-6 merges (PP-118) |

**Dependency 057-3b (not merged).** Spec §7 blocks 057-6 on 057-3b (consumer before writer). `DiscountApprovedByPerformer`
is in `apps/worker/src/outbox/known-event-types.ts` with no consumer, and `apps/worker/src/outbox/deliver.ts` marks such
an event delivered: an owner bell emitted before 057-3b merges is lost for good (SC-003). 057-3b exists only as the
unaccepted snapshot `preserve/057-3b-20261104` (0785d2cef). This PR is therefore built now and **its merge is held
until 057-3b is merged** (merge order is the manager's; reported). The writer imposes no aggregate convention on the
consumer (plan-057-3b item 8); the consumer proves the payload against the stored proposal (`matchesProposals`), so the
payload this writer emits must equal the stored decision exactly.

**Unhold condition (manager, 2026-11-11).** 057-3b is delivered as five sub-slices (3b-1 DB + kind, 3b-2 pure rules,
3b-3 consumer, 3b-4 rule behaviour + admin listing, 3b-5 scale and proofs; `plan-057-3b.md` on
`feat/p1-057-3b-self-approval-bell`). This PR's merge stays held until **all five are merged and the consumer is
verified running on the staging worker**: activation is this writer emitting the event, not the consumer merging
(`debate-057-3b-astra.md` #1–#3). While this writer is live, the worker is **never rolled back below 3b-3**, or an
older worker acknowledges the event with no consumer and the owner bell is lost.

**Prior partial work reused.** Branch `T3-CODE/orders-discount-decision-planner` (fd4c6df54, 2026-11-04, "preserve
bounded discount decision plan delivery") holds a pure `planDiscountDecision` + 269-line spec. It matches FR-011's
order and DA-Q9; it is the reference for the domain step (Kimi adapts it to `main`; tests are rewritten by Agy).

## 1. Migration

**None.** 0162/0166 already grant `UPDATE` on every decision column, the transition trigger allows
`PENDING→APPROVED|REJECTED` with `expires_at` unchanged, the decider FK `(company_id, decided_by,
decided_by_membership_id)` exists, and the `/pending` index exists. The CAS is by primary key.

## 2. Files (CLAUDE.md §1 order)

| # | Layer | File | Change |
|---|---|---|---|
| 1 | contracts | `packages/contracts/src/orders/discount-approval*.ts` | **none** (057-1 shipped `approveDiscountProposalsInput`, `rejectDiscountProposalsInput`, `decideDiscountProposalsResponse`, the OpenAPI paths and `discountApprovedByPerformer`). `pnpm contracts:openapi` must stay byte-identical. |
| 2 | domain | `apps/api/src/modules/orders/domain/discount-decision-plan.ts` (new) | Two pure steps (from fd4c6df54, split per debate #5): `planDiscountStatus(locked, hashes, now)` — per proposal, state at the fresh instant (`proposalState`, not `PENDING` → `DISCOUNT_PROPOSAL_NOT_PENDING`), stored hash = sent hash (`DISCOUNT_PROPOSAL_CHANGED`, 409), for approve **and** reject; then `planDiscountDecision(...)` — approve only: `canApprove` (`DISCOUNT_APPROVER_LIMIT_TOO_LOW` with `limit_bps`, `effective_bps`, proposal id), requester ≠ approver (`DISCOUNT_APPROVER_IS_REQUESTER`), `approverIsPerformer` flag (`boolean`). Reject: none of the three, flag **`null`** (0162 `dp_approver_flag_ck`, debate #4), reason trimmed 1…500 code points (`DISCOUNT_REJECT_REASON_INVALID`). All-or-nothing: first failing proposal throws with its id. |
| 3 | domain | `apps/api/src/modules/orders/domain/discount-approver.ts` (new) | `resolveDiscountApprover(access, selection)`: the 35d D-9 rule with approve codes (denied/none → `FORBIDDEN`; feature off → `FEATURE_DISABLED`; supplied not eligible → `FORBIDDEN`; several and none supplied → `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` with `approver_membership_ids` and their role labels; never the highest limit). |
| 4 | domain | `apps/api/src/modules/orders/domain/discount-decision-records.ts` (new) | `discountDecisionAudits(plan, context)` — one entry per proposal, `discount_proposal.approved` (via, approver user + membership, device `null`, limit source/bps, `approver_is_performer`) or `.rejected` (no reason text); `discountApprovedByPerformerEvent(plan, locked, context)` — `null` when no flag, else the D-19 payload with only flagged proposals (`id`, `service_id`, `name_en`, `name_ar`, `effective_bps`) and the decider labels passed in; `discountDecisionResponse(plan)` FR-018 `{ proposals: [{ id, status, expires_at }] }`. No PIN, phone, customer name, reason in audit/event. |
| 5 | domain | `apps/api/src/modules/orders/domain/discount-decision-error.ts` (new, or inside #2) | `DiscountDecisionError` (codes of #2 and #3); mapped to `ApiError` in the controller. |
| 6 | ports | `apps/api/src/modules/orders/ports/discount-decision.port.ts` (new) | `DiscountApprovalAccessPort` (`lock()`, `read(at)` → `SessionEditFacts`, the 35d shape); `DiscountDecisionRepository` (`lock(ids)` → locked rows of this business **and branch** in ascending id order `FOR UPDATE`, with `status`, `expires_at`, `terms_hash`, `effective_bps`, `requested_by`, `service_id`, `service_name_en/ar`, `occurred_at`, performers `[{ employee_id, snapshot_user_id }]`; `decide(plan, decider)` → CAS `UPDATE … WHERE status='PENDING' AND expires_at > $now` per proposal, returns the count updated); `DiscountDecisionTransaction` (access, discount limit, approver name (`EditorNamePort`), performers (`PerformerCheckPort`), proposals, `idempotent`, `audit`, `emit`); `DiscountDecisionTransactions.run`. Arabic one-line JSDoc per method. |
| 7 | use case | `apps/api/src/modules/orders/use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts` (new) | `DecideDiscountProposalsUseCase.execute({ decision: 'APPROVE'\|'REJECT', input, actor, key, fingerprint })`, channel `REMOTE` (057-7 adds `PIN`). Order (FR-011; debate #1, #5): tx → `idempotent(…)`: **locks first** — `access.lock()` → approve only: `proposals.peek(ids)` (no lock; missing / other branch / other business → uniform `FORBIDDEN`) → `performers.lock(employeeIds of the pre-read rows)` → `proposals.lock(ids)` (revalidated against the pre-read set, else `FORBIDDEN`; reject skips the peek and the performer lock); **then** `now = clock.now()` once, used by every check and the CAS → `planDiscountStatus` (409s) → `access.read(now)` → `resolveDiscountApprover` (403/422) → approve only: `discount.read(membership)` + `performers.read(ids, now)` for current links → `planDiscountDecision` → `approverName.read(user)` → `proposals.decide(...)` (count ≠ n → `DISCOUNT_PROPOSAL_NOT_PENDING`, defensive) → audit → emit (flagged only) → response. On replay: `access.lock()` + `read(now)` + `resolveDiscountApprover` again before returning the stored body (the 057-4b pattern). No arithmetic, no SQL. |
| 8 | persistence | `apps/api/src/modules/orders/persistence/discount-decision-transactions.ts` (new) | `withTenant(company, …, { userId })`; idempotency `COMPANY` scope, operation `decide-discount-proposals`; `appendAuditLogs`; `appendOutboxEvent` with `aggregateType: 'discount_approval_decision'`, `aggregateId` = a fresh UUID v7, `eventType: 'DiscountApprovedByPerformer'`, payload `discountApprovedByPerformer.parse(...)`; error mapping as `discount-request-transactions.ts`. |
| 9 | persistence | `apps/api/src/modules/orders/persistence/discount-decision-writes.ts` (new) | Lock SQL: `SELECT … FROM discount_proposals WHERE company_id AND business_id AND branch_id AND id = ANY($ids) ORDER BY id FOR UPDATE` + one `SELECT` of `discount_proposal_performers` for the locked ids. CAS SQL per proposal: sets `status`, `decided_by`, `decided_by_membership_id`, `decided_via='REMOTE'`, `decided_device_id=NULL`, decider snapshot columns, `decided_at`, approve-only `approved_limit_source/bps`, `approver_is_performer` (`NULL` on reject), reject-only `reject_reason`; `WHERE … AND status='PENDING' AND expires_at > $now RETURNING id`. Never touches `expires_at`. |
| 10 | persistence | `apps/api/src/modules/orders/persistence/discount-approval-access.adapter.ts` (new) | Binds `DiscountApprovalAccessPort` to identity's new functions. |
| 11 | identity (shared, add-only) | `apps/api/src/modules/identity/persistence/service-session-edit-access.ts` | add `lockDiscountApprovalAccess` / `readDiscountApprovalAccess` (same `readLineAccess`, permission `approve:discounts:branch`: DENY on any active membership wins, owner DENY ignored, eligible = covering memberships that themselves grant). |
| 12 | identity (shared, add-only) | `apps/api/src/modules/identity/index.ts` | **one new `export { … } from` line**; no existing line edited. |
| 13 | http | `apps/api/src/modules/orders/http/discount-proposals.controller.ts` | `POST approve` and `POST reject`, `@HttpCode(200)`, `@Require('approve:discounts:branch', { branch: 'branchId' })`, `@RequiresFeature('orders')`, `SessionAdminGuard`, `@Idempotency()`, shared fingerprint, `DiscountDecisionError → ApiError(code, details)`. |
| 14 | wiring (shared, add-only) | `apps/api/src/modules/orders/orders.module.ts` | one factory + one provider line for `DecideDiscountProposalsUseCase`; no existing line edited except the controller constructor's own file. |
| 15 | docs | `docs/module-map.md` §3 | `DiscountApprovalAccessPort` row already listed (057-1); verify, no change expected. |

**Lock order (FR-011, no cycle; fixed by #455, 2026-11-12):** identity access SHARE locks → (approve) unlocked pre-read of the
proposal ids and their performers' employee ids (`proposals.peek`) → performers `FOR SHARE` ascending → proposal rows
`FOR UPDATE` ascending → (approve) the locked set must equal the pre-read set, else uniform `FORBIDDEN` → `now` → settings limit read. The 057-5 consumer takes visit lock → proposals → limit; neither takes an `orders` lock
after a proposal lock. **Connection budget (PP-7.2):** one `withTenant`, the guard's own read is separate as today.

## 3. Tests (Agy) — DP-13…DP-19b

- **Unit (no DB):** `domain/__tests__/discount-decision-plan.spec.ts` (order of refusals, DA-Q9 reject, inclusive
  limit, `OWNER`, `NOT_CONFIGURED`=0, requester case-insensitive, flag from snapshot ∪ current, reason trim/500 code
  points incl. Arabic and emoji, expiry exactly at `now` → not pending, all-or-nothing with the failing id);
  `discount-approver.spec.ts`; `discount-decision-records.spec.ts` (audit and event contain no PIN/phone/customer/reason;
  event only with flagged proposals; `null` without).
- **Integration (real Postgres, ADR-0006):** `apps/api/src/modules/orders/__tests__/decide-discount-proposals*.spec.ts`
  — DP-13 owner approves 3000 bps remotely (`decided_via='REMOTE'`, device `NULL`, `expires_at` unchanged, audit row,
  no event); DP-14 reject with reason, second decide → 409; DP-14b expired at the fresh instant → 409; DP-15 race of
  two approvers on one row → one 200, one 409; DP-16 batch of 3 with one decided / one over limit → whole batch refused,
  nothing changed; DP-17 limit too low (details), `NOT_CONFIGURED`, owner; DP-18 requester approves own → 403 even as
  owner; DP-19 performer approver → flagged + one `DiscountApprovedByPerformer` with only flagged proposals, none when no
  flag; DP-19b relinked performer (snapshot) and later-linked user (current); D-11 two eligible memberships → 422 with
  ids, supplied ineligible → 403; route branch ≠ proposal branch / foreign id → uniform 403; terms hash mismatch → 409
  `DISCOUNT_PROPOSAL_CHANGED`; idempotent replay returns the stored 200 with no second write and rechecks authority;
  DENY on another membership excludes; feature off → 403 `FEATURE_DISABLED`; **debate #1** decide waits on a held
  employee row lock while the injected clock passes `expires_at` → 409, nothing written; **debate #4** a reject stores
  `approver_is_performer` `NULL` and succeeds without a reason; **debate #5** an already-decided proposal with two
  eligible memberships and none chosen → 409, not 422; race with 057-5 consumption on one approved row (consume vs a
  second decide) → exactly one wins.
- **HTTP:** controller spec for both routes (guard declared, Zod refusal, error mapping).
- **RLS negative:** no new table (existing tests cover `discount_proposals`).

## 4. Size estimate (PP-112 / §14) — refuse > 2×

| Category | Lines |
|---|---|
| Production (domain ~200, ports ~90, use case ~130, persistence ~170, identity ~30, http ~60, wiring ~15) | **~700** |
| Tests (unit ~350, integration ~550, http ~100) | **~1000** |
| Docs (this plan, debate file) | ~250 |

Spec §7 estimated 380–520 hand-written lines for 057-6 including tests, before this module's port + adapter +
replay-recheck shape was known. **The PP-112 baseline for this PR is this plan's per-category estimate, not spec §7's
(debate #6); the deviation is reported to the manager.** Refusal threshold: production > 1400, tests > 2000.

## 5. Out of scope

PIN/device routes and `DiscountPinApproverPort` (057-7), the owner-bell consumer (057-3b), screens (057-8a), the edit
path (057-9). No change to the 057-3 consumer, the 057-5 consumption, contracts or migrations.
