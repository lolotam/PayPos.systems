# Plan 057-3b — The owner bell for a self-performed discount approval (DA-Q3, D-19, DP-19c)

> **Status:** implemented and merged (3b-1…3b-5 on main), deployed on the staging worker (main `3a7fa437e`, 2026-11-12).
> The text below is the original plan, refreshed 2026-11-11 against main (stacked on #929 head `9afcb73`). The preserved snapshot `preserve/057-3b-20261104` (`0785d2cef`, built on
> `5e3c42b`, 2026-10-26) is **reference only, not accepted code**: its migration `0188` is dropped and regenerated.
> **Spec:** [spec.md](spec.md) §6 row 057-3b, DP-19c, D-19, FR-014 · **Owner answers used:** DA-Q3, DA-Q10, DA-Q11
> ([owner-questions.ar.md](owner-questions.ar.md)) — no new owner question.
> **Why now:** 057-6 (row 40, branch `feat/p1-057-discount-approval-39-41`) emits `DiscountApprovedByPerformer`, already
> in the worker's `KNOWN_EVENT_TYPES`; it is held until this consumer exists, or the owner bell is lost (spec §6 order).

## Goal

A worker `orders` consumer `orders.discount-self-approval-notice-v1` consumes `DiscountApprovedByPerformer`, proves the
event against the stored proposal facts, claims one row per source event in a new tenant ledger
`discount_self_approval_notices`, resolves recipients from the effective alert rule of a new kind
`DISCOUNT_SELF_APPROVED` (master switch + its own rule; default `owner`, `IN_APP`, branch-scoped, the approving owner
not excluded — DA-Q10), and appends `DiscountSelfApprovalNoticeRequested` in groups of ≤ 100 — once per event,
replay/concurrency/rollback safe, inside the consumer's single `withTenant` transaction.

## Refresh against main (2026-11-11)

| Checked | Result |
|---|---|
| Dependencies 057-1, 057-2, 057-3 (#523), 62-1 (#467), 62-3 (#503), A-0 (#462) | all on main |
| Contract `discountApprovedByPerformer`, template `discount_self_approved` rev 1, `DiscountSelfApprovalNoticeRequested` in the notifications source events, `DiscountApprovedByPerformer` in `KNOWN_EVENT_TYPES` | present, unchanged |
| `ALERT_KINDS` / `ALERT_KINDS_SQL` / contract `alertKind` / `setAlertRulesInput.max(14)` / admin `LISTED_ALERT_KINDS` | 14 kinds; `DISCOUNT_SELF_APPROVED` absent everywhere |
| 057-3 sibling (domain, ports, use case, repository, fixture), price-edit rule-following bell, `bellDelivery`, `AlertRulesPort` adapter, `maxPercentText` export, `inApp.editor_generic` | present |
| Place read | reuse `discount-approval-place.adapter.ts` (module map line 422) — no new place file |
| Recipient read | per-feature adapter, as every bell on main (`price-edit-recipients.adapter.ts`, lines 414–415): new `discount-self-approval-recipients.adapter.ts` over `identity.branchManagerRecipients(…, roles)` + `tenancy.companyOpen`, two new `reads` lines. The late-notice `branch-manager-recipients.adapter.ts` is typed to its own ports and is not reused |
| Migration number | highest on main `0217`; #929 adds `0218`; this slice generates `0219` (provisional until merge order) |
| Worker orders drift since the snapshot base | 56 files changed (package import, etc.); the snapshot is re-derived, never cherry-picked |

## Settled design (carried from the snapshot plan's reviewed revision, still valid)

- **Ledger table** `discount_self_approval_notices`: `company_id`, `id`, `business_id`, `source_event_id`, `decided_at`,
  `recipient_count int CHECK ≥ 0`; PK `(company_id,id)`; `UNIQUE (company_id, source_event_id)`
  (`…_source_event_key`); FKs to `companies` and `(company_id,business_id)` → `businesses`, with its index;
  `source_event_id` is **not** an FK to `outbox`. `ENABLE` + `FORCE` RLS, `_select`/`_insert` policies on
  `app_company_id()`, `REVOKE ALL … FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher`, `GRANT SELECT, INSERT TO
  pospay_app` — the 0172 shape. Same migration widens the `alert_rules_kind` CHECK to 15 kinds (expand-only, no data).
- **Kind** `DISCOUNT_SELF_APPROVED`: `managersInApp` defaults `enabled true, recipientRoles ['owner'], IN_APP, no
  timing`; contract enum identical to `ALERT_KINDS`; `setAlertRulesInput` `max(15)` (required: a full save of 15 rows).
- **Source proof before claim** (`matchesProposals`): every flagged id exists in this company/business/branch with the
  stored immutable facts equal to the event (`service_id`, `effective_bps`, `decided_by`, `decided_via`,
  `approver_is_performer IS TRUE`), exact count, status `APPROVED` or `CONSUMED`. Labels stay the event's
  decision-time snapshot. No envelope aggregate convention is imposed on 057-6.
- **Use case order:** domain assert → `matchesProposals` (false ⇒ `DISCOUNT_SELF_APPROVAL_EVENT_INVALID`, nothing
  claimed) → `companyOpen` (closed ⇒ consume without claim) → `bellDelivery(rule)` → `clock.now()` → recipients by the
  rule's roles → `branchPlace` → `claim(ON CONFLICT DO NOTHING)` with `sourceEventId = envelope event.id` → lost claim
  returns → zero recipients / no `IN_APP` / no branch ⇒ recorded once, no bell → one outbox append per ≤ 100 group.
- **Parameters:** branch name, approver label (fallback `inApp.editor_generic`), first flagged service, largest percent
  via the sibling's `maxPercentText` — max computed in `domain/`, never in the use case.
- 057-3's request bell stays always on (DA-Q11); this PR does not touch its consumer.

## Size and the proposed split

The snapshot is ~620 production and ~2016 test lines; 057-3 (#523, same pattern) landed at 844 / 1697. One PR cannot
meet the 300–420 target, so 057-3b splits into five sub-slices (estimates exclude generated files: drizzle snapshot and
journal, `openapi.json`, `schema.d.ts`).

| Sub-slice | Content | Prod | Tests | Migration | Depends on |
|---|---|---|---|---|---|
| **3b-1 DB + kind** | migration `0219` (ledger + RLS + grants + CHECK widening) 40, schema TS 22, allowlist + inventory 3; kind in `packages/domain` 6, contract enum + `max(15)` 2, i18n 2; tests: RLS negative spec ~160, domain default-rule asserts ~25, one enum-parity test ~30 | ~75 | ~220 | yes, stacks on #929 | — |
| **3b-2 Pure rules** | `domain/discount-self-approval-notice.ts` ~145 (assert, groups, parameters; reuse `maxPercentText`), `ports/discount-self-approval-notice.port.ts` ~115, narrow `DiscountApprovalNoticePlace.branchPlace` to `Pick<…,'companyId'\|'businessId'\|'branchId'>` with its JSDoc ~5 (debate #4); exhaustive unit tests, no DB | ~265 | ~150 | no | — |
| **3b-3 Consumer** | use case ~97, handler ~32, repository (`claim`, `matchesProposals`, outbox) ~77, recipients adapter ~12, `orders.module.ts` ~39, `main.ts`/`index.ts` 3, module-map `reads` + generate 5; tests: fixture/data ~250 (reusing the 057-3 proposal seeding), core spec ~170 (DP-19c default rule incl. the approving owner, non-owner manager out, no customer data, once/replay, malformed, zero recipients, closed company, null place, rollback, `CONSUMED` accepted), mismatch matrix as one `it.each` ~50 | ~265 | ~470 ⚠ | no | 3b-1, 3b-2 |
| **3b-4 Rules + admin** | admin `LISTED_ALERT_KINDS` + page test (visible editable row) ~55; alert-rule spec ~170: manager added, kind off, branch off, master off, master `NULL`, no `IN_APP`, zero-count replay retention; 057-3 always-on guard ~45 | ~5 | ~270 | no | 3b-3 |
| **3b-5 Scale + proofs** | groups `[100,1]` + overlapping-membership dedupe ~70; concurrency A (deliverer) and B (two connections, `ON CONFLICT`) ~170; `EXPLAIN` of the claim (conflict arbiter, `NOTHING`) and `matchesProposals` (a unique index keyed on `company_id` + `id`, no seq scan under the default planner at a realistic tenant volume; the planner may pick `dp_pk` or another unique key that leads with those columns) ~110; full inbox delivery through the in-app consumer ~90 | 0 | ~440 ⚠ | no | 3b-3 |

Totals ≈ 610 production / 1550 test lines (snapshot 620 / 2016; 057-3 #523 844 / 1697). ⚠ = above the 420 target
by ≤ 50; the alternative is a sixth slice for the mismatch matrix and the `EXPLAIN` proofs.

- 3b-1 and 3b-2 run in parallel; 3b-3 needs both; 3b-4 and 3b-5 need 3b-3.
- **Activation is 057-6 emitting the event, not 3b merging** (debate #1–#3): the deliverer acknowledges a known event
  with no consumer, so 057-6 stays held until 3b-1…3b-5 are merged **and** the consumer is deployed to the staging
  worker and verified; no worker rollback below 3b-3 while 057-6 is live.
  **Unheld 2026-11-12:** 3b-1…3b-5 are on main, staging has run main `3a7fa437e` since 14:32 Kuwait, the worker bundle
  registers `orders.discount-self-approval-notice-v1` for `DiscountApprovedByPerformer` and worker `/ready` returns 200
  with the dispatcher up. Standing constraint: once 057-6 is live, never roll the staging worker back below 3b-3
  (#946, `61ab48c91`). Before then nothing emits the event, so the
  kind being unlisted in admin until 3b-4 harms no one.
- Fewer PRs is possible (3b-2 into 3b-3 ≈ 530 prod / 620 tests) at the cost of the size target.

## Per sub-slice gates (local, PP-113)

Typecheck and lint of the touched packages, `pnpm lint:docs`, `pnpm module-map:check` (3b-3: `module-map:generate`
first), the sub-slice's own specs on a private lane (`lane.mjs`). 3b-1 also: `pnpm db:generate
discount-self-approval-notices` from the root (parent, migration lane final step only), `privileges.spec.ts`,
`pnpm contracts:openapi` and both `api:generate`. 3b-4: admin component tests assert what the user sees (§9).
`ci-gate` on the exact head decides done.

## Lanes (PP-168 / PP-175.2)

Kimi (`k3.1-pro`) implements production code; Agy (`gemini-3.8-flash-high`) writes tests and the migration SQL edits;
env-stash fences as COMMON.md; Astra DB review mandatory on 3b-1 (`packages/db`). Briefs carry per-category sizes and
are sent to the manager before dispatch.

## Out of scope

057-6 writer (its own branch), 057-7, 057-9, any change to the 057-3 consumer beyond the guard test, UI beyond the
kind listing.
