# 48-3 — commission plan builder screen: implementation plan

> Plan author: Claude Fable 5.2 (medium), 2026-11-20 (PP-196.3). Tier: **Heavy** (PP-196.1, commission money).
> Base: `origin/main` at `b3fd3ffa4`. Branch: `feat/059-48-3-plan-builder`.
> Sources: `spec.md` row 48-3, FR-006, FR-009, FR-010, FR-010a, CM-06, CM-09, D-17, D-35; `owner-questions.ar.md` §§43, 45, 46;
> ADR-0054 §1; merged 48-2 (#730) and 48-2b (#793); `docs/owner-decisions.ar.md` items 112 (PP-192), 113 (PP-193), 116 (PP-196).
> Status: **plan written, Astra debate pending, implementer dispatch blocked on the size decision in §1.**

## 0. What this row delivers

An individual admin who holds `manage:commission-plans:business` opens `/commissions/plans`, picks an employee (name and
employee number, CS-Q40), sees the plan as three blocks with on/off switches (base, tiers, package sale — never a formula,
D-35), gets the engine's own validation message on the block it concerns before submit, saves a new plan version, and
sees the version history. No backend behaviour changes. No migration, no RLS change, no permission change.

## 1. Size ledger — a decision is needed before implementation

The task brief expects 300–450 lines. The measured history of this row says otherwise, and size is what stopped it twice
(`owner-questions.ar.md` §§45–46), so the ledger comes first.

**Evidence.** The earlier attempt (branch `feat/48-3-plan-builder-screen`, checkpoint `ef7879d64`, never merged) committed
1,216 production lines in `apps/admin/src/commissions` plus 118 i18n lines, against the spec row's 300–450 (+170–230 for the
entry and the move off the staff page). Its redesign estimate was still about 1,149.

**This plan's estimate** (hand-written production lines, Prettier-formatted, tests and generated files excluded):

| Part | Files | Lines |
| --- | --- | ---: |
| Model | `plan-draft.ts` 185, `plan-check.ts` 35, `plan-messages.ts` 40 | 260 |
| Editor UI | `plan-switch-block.tsx` 35, `calc-fields.tsx` 40, `threshold-fields.tsx` 45, `tiers-block.tsx` 60, `plan-builder-form.tsx` 80, `plan-resolver.ts` 45 | 305 |
| i18n (editor keys) | `commission-plan-builder-catalog.ts` + wiring | 110 |
| **PR 1 total** | | **≈ 675** |
| Data | `commission-plans-client.ts` 75, `use-commission-plan-employees.ts` 25, `use-commission-plan-versions.ts` 30, `use-save-commission-plan.ts` 45 | 175 |
| Screen | `commission-plan-employee-picker.tsx` 55, `plan-history-table.tsx` 85, `commission-plan-section.tsx` 70, `commission-plans-page.tsx` 45 | 255 |
| Route and nav | `commission-plans-route.tsx` 25, `commission-plans-nav-item.tsx` 30, `page.tsx` 1, `dashboard-navigation.tsx` +2 | 58 |
| i18n (screen keys) | same catalog | 30 |
| **PR 2 total** | | **≈ 520** |
| **Row total** | | **≈ 1,195** |

Moved, not written: the wire→engine translator (≈75 lines) moves from `apps/api` into `packages/commissions-engine` (§3.1).

**Why it does not shrink to 300–450.** The engine's §5.7 table has two calc kinds, three threshold kinds, two modes, two
accumulators and a variable step list; the contract preserves a disabled block's settings; the draft must parse KWD
strings, basis points, session counts and salary multiples without `number` money. That model alone is ≈260 lines. Cutting
it means cutting a combination the validator accepts, which CM-06 forbids.

**The decision (for the manager; technical, Waleed only if the manager escalates).** The brief says «if it grows past the
PP-192 limit, split into two PRs». PP-192 has two readings here:

1. Rule 1 (600–900 for a slice with no money, no migration and no sensitive permission): this row is a browser screen
   over an already-merged API, so it would fit as **two PRs of ≈675 and ≈520**. This is the split this plan proposes.
2. Rule 3 (a money slice stays on its spec row's bounds): the row is tagged Heavy/money, so its bound is 470–680 in
   total and even two PRs do not fit. The §45 caps (total ≤1140, B1 ≤910) and the 5/5 correction history were never
   cancelled by a card; PP-196.1 lifts the deferral and does not mention them.

This plan does not choose the favourable reading. **No implementer is dispatched until the manager confirms reading 1
(two PRs, new measured budgets of 700 and 550, the §45 caps and the 5/5 record retired as history) or names another
shape.** Under PP-118 this session owns PR 1 through merge; PR 2 needs its own assignment.

## 2. What is lifted from the earlier attempt

`48-3-status.md` on the old branch forbids moving the unfinished bundle without a decision. PP-196.1 is that decision for
the row, and this plan lifts only the following, as reference to re-type on current `main`, never by cherry-pick:

- `model/plan-draft.ts` at `ef7879d64` (the draft shape and the text parsers): reused in substance.
- `model/plan-check.ts`: the per-block validation idea is kept; its hand-copied translator is **dropped** (§3.1).
- The test case list of `plan-check.spec.ts`, `plan-draft.spec.ts` and `plan-builder-form.spec.tsx`.

Not lifted: every hook, the picker, the page, the nav item, the denial/epoch machinery, the cycle-5 patch, and all UI
markup (written before Souk Tiles, ADR-0059, and Phosphor, ADR-0060).

## 3. Design

### 3.1 One translator, in the engine package (headline question for the debate)

The API translates the wire body to the engine's bigint shape with `toEngineCommissionPlan`
(`apps/api/src/modules/commissions/domain/plan-codec.ts`) and then calls `validateCommissionPlan`. The earlier attempt
hand-copied that translator into the admin app with a «keep in sync» comment. A drifted copy would make the builder
accept what the API refuses (or the reverse) on a money rule, and it is the kind of re-implementation the row forbids.

**Proposal.** Move the translator, unchanged, to `packages/commissions-engine/src/plan-wire.ts` and export
`toEngineCommissionPlan` and `CommissionPlanWire` from the existing `./validation` entry point. The API use case imports
it from `@pospay/commissions-engine`; `plan-codec.ts` and its spec move with it (the spec becomes a package test).

Costs, stated plainly:

- It touches `apps/api` (one import in `create-commission-plan-version.usecase.ts`, one deleted domain file and its
  spec). CLAUDE.md §1.4 requires saying so: the reason is to keep one translator.
- ADR-0054 §1 gets a dated addendum: the `./validation` entry also exports the wire translator. The package `exports`
  map does not change (`.` and `./validation`), so `test:node` and the ESLint scopes stay as they are.
- `packages/commissions-engine` already depends on `packages/domain` (`parseMoney`), so no new dependency.

**Alternative (kept if the debate rejects the move).** A copy in `apps/admin/src/commissions/model/` plus a parity test
in `packages/commissions-engine` cannot exist, because neither side may import the other's copy. That is why the copy is
the worse option, not an equal one.

### 3.2 Folder shape (CLAUDE.architecture.md §11)

```
apps/admin/src/commissions/
  model/   plan-draft.ts  plan-check.ts  plan-messages.ts  plan-resolver.ts
  ui/      plan-switch-block.tsx  calc-fields.tsx  threshold-fields.tsx  tiers-block.tsx  plan-builder-form.tsx
           plan-history-table.tsx  commission-plan-employee-picker.tsx  commission-plan-section.tsx      (PR 2: last three)
  api/     commission-plans-client.ts  use-commission-plan-employees.ts  use-commission-plan-versions.ts
           use-save-commission-plan.ts                                                                    (PR 2)
  pages/   commission-plans-page.tsx                                                                      (PR 2)
apps/admin/app/(dashboard)/commissions/plans/page.tsx          thin re-export                             (PR 2)
apps/admin/app/(dashboard)/_frame/commission-plans-route.tsx   workspace and session passed as props     (PR 2)
apps/admin/app/(dashboard)/_frame/commission-plans-nav-item.tsx                                           (PR 2)
packages/i18n/src/commission-plan-builder-catalog.ts           namespace `commissionPlanBuilder`
```

`apps/admin/package.json` gains `@pospay/commissions-engine` (workspace). The admin app imports only
`@pospay/commissions-engine/validation`; the existing ESLint scope (`COMMISSIONS_ENGINE_VALIDATION_ONLY_BAN`) and its
test `scripts/module-map/commissions-engine.test.mjs` already enforce it and are not re-added.

### 3.3 Model (PR 1)

- **`plan-draft.ts`** — the form's value type (`PlanDraft`: text fields, never numbers for money), `emptyPlanDraft(timeZone, now)`
  (today in the **business** time zone, every block off), `draftFromVersion(version)`, and `toWireInput(draft)` which
  returns either a `CreateCommissionPlanVersionInput` or field-reading errors (`INVALID_DATE`, `INVALID_BPS`,
  `INVALID_MONEY`, `INVALID_SESSIONS`, `INVALID_MULTIPLE`) tagged with the block they belong to. Parsing only: a text is
  either a well-formed value of its kind or it is not. It decides nothing about which plans are valid.
  A disabled component with an empty calc is sent as `{ enabled: false }`; a disabled one the admin filled keeps its
  settings (the contract allows it, CM-06). KWD text goes through `normalizeKwdInput` from `packages/i18n`.
- **`plan-check.ts`** — `checkPlanBlocks(wire)` returns `{ base, tiers, packageSale }`, each a
  `CommissionValidationError | null`. It calls `validateCommissionPlan(toEngineCommissionPlan(...))` once per block
  with the other two blocks switched off, so the engine's first-error-wins order cannot hide a second block's error.
  It contains no rule of its own.
- **`plan-messages.ts`** — the map from the seven engine codes to `commissionPlanBuilder.*` keys, the map from
  field-reading errors to keys, and `planErrorCode(error)` which reads `details.code` from a
  `COMMISSION_PLAN_INVALID` envelope. Other server codes reuse the existing `commissionPlanErrors` catalog.
- **`plan-resolver.ts`** — a react-hook-form `Resolver<PlanDraft>` that runs `toWireInput` then `checkPlanBlocks` and
  puts one message per block in `errors.base | errors.tiers | errors.packageSale | errors.effectiveFrom`.

### 3.4 Editor UI (PR 1)

- `plan-switch-block.tsx` — one block: the existing switch pattern (`<input type="checkbox" role="switch">` + `Label`,
  as `alerts-master-switch.tsx`), the block title, its children, and its error as `<p role="alert">` inside the block.
  `packages/ui` gets no new component in this row.
- `calc-fields.tsx` — calc kind (`NativeSelect`: percentage / fixed amount) and one `Input`.
- `threshold-fields.tsx` — threshold kind and value for one step.
- `tiers-block.tsx` — mode, accumulator, the step list with add and remove.
- `plan-builder-form.tsx` — `useForm({ resolver, mode: 'onChange' })`, the effective date, the whole-period checkbox,
  the three blocks, and the save button. **Save is disabled while the form is invalid or a save is pending.** The
  form takes `initial`, `onSubmit(body)`, `pending` and `serverError` as props, so PR 1 is testable with no network.
- Logical CSS only, every string through `t(locale, …)`, components from `@pospay/ui`, icons from Phosphor through
  `@pospay/ui`, no closing comments, files under 300 lines, functions under 60.

### 3.5 Data and access (PR 2) — closing P1-1 and P1-2 by removing the race

The earlier review's two P1 findings were: **P1-1** a refused or switched identity could still show the previous names;
**P1-2** a 403 seen on one list cursor, a version read or a save did not revoke the other cursors. The earlier design
patched this with a per-cursor denial flag and an epoch. This plan removes the shape that made it possible:

1. **One cache entry per list.** Employees are one `useInfiniteQuery` (`limit` 50, opaque cursor); versions are one
   `useInfiniteQuery` per employee. There are no sibling per-cursor entries to revoke.
2. **One key prefix per identity:** `['commission-plans', companyId, businessId, userId, …]`. The route also keys the
   page by `company:business:user` (as `AlertRulesRoute`), so a workspace or user switch remounts with empty state.
3. **Data is rendered only from a query whose current status is success.** After a failed refetch TanStack keeps the
   old `data` but `isSuccess` is false; the picker, the history and the nav link all read `isSuccess ? data : null`.
4. **Any 403 revokes the prefix.** A 403 from the employee list, a version read or the save calls
   `queryClient.resetQueries({ queryKey: prefix })`: in-flight fetches are cancelled, the entries return to their
   initial state (no data) and active ones refetch. The nav item and the page observe the same entries, so both hide
   together; a later authorized response shows them again. The held idempotency key is dropped.
5. **An employee 404 is local:** the section shows `EMPLOYEE_NOT_FOUND`; the list and the link stay.
6. Hooks set `retry: false`. The save keeps one `Idempotency-Key` for an unchanged body across a network failure and
   takes a new one when the body changes (the pattern of `use-cancel-service-line.ts`). Fetches live in `api/`, never
   in a component. Responses are parsed with the contract schemas.

The behaviour of `resetQueries` on in-flight and inactive entries is confirmed against the TanStack Query v5 docs
before dispatch, and the P1 tests below prove it on the real client.

### 3.6 Screen (PR 2)

- Picker: `NativeSelect` of `name — #employee_number` (Arabic name when the locale is Arabic and it exists), a «load
  more» button while `next_cursor` is not null, and an `EmptyState` when the list is empty. No free-text or UUID field.
- Section (per employee): the builder form, started from the newest stored version or from `emptyPlanDraft` with the
  list's `time_zone`; the history table (newest first, version, effective date, whole-period mark, a one-line summary
  per block, created at) with «load more».
- Nav entry in `DashboardNavigation`, shown only while the employee query is a success (the existing
  `AlertRulesNavItem` rule), so an admin without the permission sees no link.

## 4. Tests

Every UI test asserts what the user sees (CLAUDE.md §9); a mock-call assertion may sit beside it, never replace it.

**PR 1**

| Id | Test | File |
| --- | --- | --- |
| CM-06 (builder half) | The full product of the §5.7 table (calc kinds × threshold kinds × modes × accumulators × enabled flags, with the boundary values the validator distinguishes): for each plan, `checkPlanBlocks` reports an error exactly when `validateCommissionPlan(toEngineCommissionPlan(plan))` does, with the same code. Generated in a loop, not hand-picked. | `model/__tests__/plan-check.spec.ts` |
| CM-06 | Every one of the seven engine codes has an Arabic and an English message. | `model/__tests__/plan-messages.spec.ts` |
| — | `toWireInput`: each parser's accepted and refused texts; disabled-empty → `{ enabled: false }`; disabled-filled keeps settings; `draftFromVersion` round trip. | `model/__tests__/plan-draft.spec.ts` |
| CM-09 | Three blocks render with switches and no formula text; turning tiers on with no step shows the `NO_STEPS` message **inside the tiers block** and the save button is **disabled**; fixing it enables save; a descending step shows `STEPS_NOT_ASCENDING` in the tiers block while base stays clean. | `ui/__tests__/plan-builder-form.spec.tsx` |
| CM-09 | A server `COMMISSION_PLAN_INVALID` with `details.code` shows the same message on its block. | same |
| — | Translator spec moved with the translator; api use-case spec still green. | `packages/commissions-engine/src/__tests__/plan-wire.spec.ts` |

**PR 2**

| Id | Test |
| --- | --- |
| CM-09 | The history lists stored versions newest first; «load more» appends the next page. |
| FR-010a | The picker shows name and employee number; pages by cursor; an empty list shows the empty state and no option; the default date is today in the list's `time_zone`, not the browser's. |
| **P1-1** | List 200 with `next_cursor` → «load more» pending → refetch of the list answers 403 → the late page resolves → link, names and section stay hidden. Company A names never appear after a switch to company B. |
| **P1-2** | Nav and page mounted together; a save answers 403 → no employee option, no section, no link; an authorized retry shows them again. |
| — | Employee 404 → local message, the list and the link remain. Save success → the new version is first in the history. Unchanged body after a network failure reuses the idempotency key; a changed body takes a new one. |
| — | Nav item spec: hidden before success, hidden on 403, shown on 200. |

## 5. Steps

**PR 1 — editor (this branch)**

1. Record the lifted deferral in `owner-questions.ar.md` (new §51 after §46, citing PP-196.1 / owner-decisions item 116,
   Waleed's words verbatim).
2. Move the translator to the engine package; export from `./validation`; rewire the API use case; move the spec;
   ADR-0054 §1 addendum.
3. Add `@pospay/commissions-engine` to `apps/admin/package.json` (lockfile updated by `pnpm install`).
4. i18n catalog `commissionPlanBuilder` (ar/en, same key set, wired in `catalog.ts`).
5. Model files with their unit tests.
6. Editor UI with its component tests.
7. Local gates: `pnpm --filter @pospay/commissions-engine test`, `pnpm --filter @pospay/admin typecheck lint`,
   the admin commissions specs, the api create-plan specs' typecheck, `pnpm lint:docs`, `pnpm module-map:check`.

**PR 2 — screen (own assignment)**: data hooks → picker, history, section, page → route, nav → P1 and screen tests →
journey `docs/journey/61-commission-plan-builder.md` (Arabic and English in the house shape, README row).

The journey belongs to PR 2 because nothing is reachable before the route exists; PR 1's body says so.

## 6. Acceptance

- CM-06 builder half and CM-09 pass as written in §4; P1-1 and P1-2 are closed by their named tests before the route
  or the nav entry ships (PR 2).
- The admin app imports nothing of the engine but `./validation`; no validation rule is written in `apps/admin`.
- No `number` holds money; no hardcoded string; logical CSS only; file and function limits hold.
- `ci-gate` green on the exact head; review findings resolved; merge only on Waleed's card (PP-195).

## 7. Out of scope

Service overrides (49-1, 49-2), statements, any API, contract, database or permission change, and a `Switch` component
in `packages/ui`.

## 8. Astra debate

Pending. Each point and its answer are recorded here after the round.
