# 48-3 — commission plan builder screen: implementation plan

> Plan author: Claude Fable 5.2 (medium), 2026-11-20 (PP-196.3). Tier: **Heavy** (PP-196.1, commission money).
> Base: `origin/main` at `b3fd3ffa4`. Branch: `feat/059-48-3-plan-builder`.
> Sources: `spec.md` row 48-3, FR-006, FR-009, FR-010, FR-010a, CM-06, CM-09, D-17, D-35; `owner-questions.ar.md` §§43, 45, 46, 51, 52;
> ADR-0054 §1; merged 48-2 (#730) and 48-2b (#793); `docs/owner-decisions.ar.md` items 112 (PP-192), 113 (PP-193), 116 (PP-196).
> Status: **revision 2, after the one Astra debate round (verdict REJECT on revision 1; every point applied or answered in §8).
> Implementer dispatch is blocked on the size decision (`owner-questions.ar.md` §52).**

## 0. What this row delivers

An individual admin who holds `manage:commission-plans:business` opens `/commissions/plans`, picks an employee (name and
employee number, CS-Q40), sees the plan as three blocks with on/off switches (base, tiers, package sale — never a formula,
D-35), gets the engine's own validation message on the block it concerns before submit, saves a new plan version, and
sees the version history. No backend behaviour changes. No migration, no RLS change, no permission change.

## 1. Size ledger — a decision is needed before implementation

The task brief expects 300–450 lines. The measured history of this row says otherwise, and size is what stopped it twice
(`owner-questions.ar.md` §§45–46), so the ledger comes first.

**Evidence.** The earlier attempt (branch `feat/48-3-plan-builder-screen`, never merged) holds **1,099 committed production
lines in 17 files** under `apps/admin/src/commissions` at checkpoint `ef7879d64`
(`git diff --numstat dd7c42baa feat/48-3-plan-builder-screen -- apps/admin/src/commissions`, tests excluded), plus 118 i18n
lines outside that folder. The figure 1,216 in §45 is the uncommitted cycle-5 candidate, which exists only in the old
worktree. The spec row says 300–450 (+170–230 for the entry and the move off the staff page). The old data layer alone was
212 lines before it handled revoked access correctly.

**This plan's estimate** (hand-written production lines, Prettier-formatted, tests and generated files excluded). These
are estimates from reading, not measured code:

| Part | Files | Lines |
| --- | --- | ---: |
| Engine package | `plan-wire.ts` moved (≈75, not counted) + `validateWireCommissionPlan` and exports | 20 |
| Model | `plan-draft.ts` 185, `plan-check.ts` 25, `plan-messages.ts` 40, `plan-resolver.ts` 60 | 310 |
| Editor UI | `plan-switch-block.tsx` 35, `calc-fields.tsx` 40, `threshold-fields.tsx` 45, `tiers-block.tsx` 60, `plan-builder-form.tsx` 80 | 260 |
| i18n (editor keys) | `commission-plan-builder-catalog.ts` + wiring | 110 |
| **PR 1 total** | | **≈ 700** |
| Data and access | `commission-plans-client.ts` 60, `plan-access.ts` 45, `use-commission-plan-employees.ts` 30, `use-commission-plan-versions.ts` 30, `use-save-commission-plan.ts` 55 | 220 |
| Screen | `commission-plan-employee-picker.tsx` 55, `plan-history-table.tsx` 90, `commission-plan-section.tsx` 80, `commission-plans-page.tsx` 45 | 270 |
| Route and nav | `commission-plans-route.tsx` 25, `commission-plans-nav-item.tsx` 30, `page.tsx` 1, `dashboard-navigation.tsx` +2 | 58 |
| i18n (screen keys) | same catalog | 35 |
| **PR 2 total** | | **≈ 585** |
| **Row total** | | **≈ 1,285** |

Lines already saved in this revision: the request body is the contract value as parsed (no `componentBody`/`tiersBody`
re-shaping, −35), the newest version comes from the history's first page (no separate «latest» query, −25), and the
admin holds no translator (−50).

**Why it does not shrink to 300–450.** The engine's §5.7 table has two calc kinds, three threshold kinds, two modes, two
accumulators and a variable step list; the contract preserves a disabled block's settings; the draft must parse KWD
strings, basis points, session counts and salary multiples without `number` money. That model alone is ≈310 lines. Cutting
it means cutting a combination the validator accepts, which CM-06 forbids. The data layer cannot shrink below what it
takes to close P1-1 and P1-2 (§3.5).

**The decision (for the manager; technical, Waleed only if the manager escalates) — `owner-questions.ar.md` §52.**
PP-192 has two readings here:

1. Rule 1 (600–900 for a slice with no money, no migration and no sensitive permission): this row is a browser screen
   over an already-merged API, so it fits as two PRs.
2. Rule 3 (a money slice stays on its spec row's bounds): the row is tagged Heavy/money, so its bound is 470–680 in
   total and even two PRs do not fit.

This plan does not choose the favourable reading. The decision asked for must name all of these explicitly:

- **Budgets:** PR 1 ≤ 720, PR 2 ≤ 620, row total ≤ 1,340. This is **above** the old total cap of 1,140; the old caps
  (total ≤1140, B1 ≤910) are retired as history or they are not, in words.
- **Correction rounds:** the historical 5/5 stays on record; each PR gets the Heavy cap of the current pipeline (5).
- **Ownership:** under PP-118 this session owns PR 1 through merge; PR 2 needs its own assignment and starts after PR 1
  merges.

**No implementer is dispatched until that answer is recorded in §52.**

## 2. What is lifted from the earlier attempt

`48-3-status.md` on the old branch forbids moving the unfinished bundle without a decision. PP-196.1 is that decision for
the row, and this plan lifts only the following, as reference to re-type on current `main`, never by cherry-pick:

- `model/plan-draft.ts` at `ef7879d64` (the draft shape and the text parsers): reused in substance.
- `model/plan-check.ts`: the per-block validation idea is kept; its hand-copied translator is **dropped** (§3.1).
- The test case list of `plan-check.spec.ts`, `plan-draft.spec.ts` and `plan-builder-form.spec.tsx`.

Not lifted: every hook, the picker, the page, the nav item, the denial/epoch machinery, the cycle-5 patch, and all UI
markup (written before Souk Tiles, ADR-0059, and Phosphor, ADR-0060).

## 3. Design

### 3.1 One validator for the wire shape, in the engine package

The API translates the wire body to the engine's bigint shape with `toEngineCommissionPlan`
(`apps/api/src/modules/commissions/domain/plan-codec.ts`) and then calls `validateCommissionPlan`
(`create-commission-plan-version.usecase.ts:44`). Nothing else imports the translator. The earlier attempt hand-copied
it into the admin app; a drifted copy would make the builder accept what the API refuses on a money rule.

**Decision (Astra's narrower option, §8 point 4).**

- Move the translator unchanged, with its Arabic JSDoc, to `packages/commissions-engine/src/plan-wire.ts`. It stays
  **internal** to the package.
- Add one function beside it: `validateWireCommissionPlan(plan: CommissionPlanWire): CommissionValidationResult`, which
  is `validateCommissionPlan(toEngineCommissionPlan(plan))` and nothing more.
- Export `validateWireCommissionPlan` and the type `CommissionPlanWire` from **both** entries: `src/index.ts` (the API
  imports the root) and `src/validation.ts` (the admin app imports `./validation`).
- The API use case calls `validateWireCommissionPlan(command.input)`; `plan-codec.ts` is deleted and its spec moves to
  the package as `__tests__/plan-wire.spec.ts`, keeping its independent expected `bigint` values.
- `package.json` `exports` does not change. `test:node` is extended: both entries export the same
  `validateWireCommissionPlan`, and `./validation` does **not** export `computePeriod`.

Costs, stated plainly:

- It touches `apps/api` (one import and one call in the use case, one deleted domain file, one moved spec). CLAUDE.md
  §1.4 requires saying so: the reason is one validator path for the API and the browser.
- ADR-0054 §1 says `./validation` «exports only `validateCommissionPlan`, its error codes and the plan types», and
  spec D-17 says the same. Both get a dated addendum in PR 1 naming the one added symbol and its wire type. This is an
  architectural record change, so the PR body flags it for Waleed's merge card.
- No new dependency: the package already depends on `packages/domain` (`parseMoney`).

### 3.2 Folder shape (CLAUDE.architecture.md §11)

```
apps/admin/src/commissions/
  model/   plan-draft.ts  plan-check.ts  plan-messages.ts  plan-resolver.ts
  ui/      plan-switch-block.tsx  calc-fields.tsx  threshold-fields.tsx  tiers-block.tsx  plan-builder-form.tsx
           plan-history-table.tsx  commission-plan-employee-picker.tsx  commission-plan-section.tsx      (PR 2: last three)
  api/     commission-plans-client.ts  plan-access.ts  use-commission-plan-employees.ts
           use-commission-plan-versions.ts  use-save-commission-plan.ts                                   (PR 2)
  pages/   commission-plans-page.tsx                                                                      (PR 2)
apps/admin/app/(dashboard)/commissions/plans/page.tsx          thin re-export                             (PR 2)
apps/admin/app/(dashboard)/_frame/commission-plans-route.tsx   workspace and session passed as props     (PR 2)
apps/admin/app/(dashboard)/_frame/commission-plans-nav-item.tsx                                           (PR 2)
packages/i18n/src/commission-plan-builder-catalog.ts           namespace `commissionPlanBuilder`
```

`apps/admin/package.json` gains `@pospay/commissions-engine` (workspace) and the lockfile is updated by `pnpm install`.
The admin app imports only `@pospay/commissions-engine/validation`; the existing ESLint scope
(`COMMISSIONS_ENGINE_VALIDATION_ONLY_BAN`) and its test `scripts/module-map/commissions-engine.test.mjs` already
enforce it and are not re-added.

### 3.3 Model (PR 1)

- **`plan-draft.ts`** — the form's value type (`PlanDraft`: text fields, never numbers for money),
  `emptyPlanDraft(timeZone, now)` (today in the **business** time zone, every block off), `draftFromVersion(version)`,
  and `toWireCandidate(draft)` which turns the texts into a candidate request body. Parsing only: a text is either a
  well-formed value of its kind or it is reported as a field-reading error (`INVALID_BPS`, `INVALID_MONEY`,
  `INVALID_SESSIONS`, `INVALID_MULTIPLE`) tagged with its block. It decides nothing about which plans are valid.
  A disabled component with an empty calc is sent as `{ enabled: false }`; a disabled one the admin filled keeps its
  settings (the contract allows it, CM-06). KWD text goes through `normalizeKwdInput` from `packages/i18n`.
- **`plan-check.ts`** — `checkPlanBlocks(body)` returns `{ base, tiers, packageSale }`, each a
  `CommissionValidationError | null`. For each block it calls `validateWireCommissionPlan` with the two **other**
  blocks replaced by the literal `{ enabled: false }` — not by flipping their flag, because the engine also checks a
  disabled block's retained settings (`plan-validation.ts:37–47, 72–90`). The engine has no cross-block rule, so:
  some block has an error ⇔ the whole plan is refused, and the first non-null in the order base, tiers, packageSale
  equals the whole-plan code. It contains no rule of its own.
- **`plan-resolver.ts`** — a react-hook-form `Resolver<PlanDraft>` in three steps:
  1. `toWireCandidate(values)`; field-reading errors go to their block.
  2. `createCommissionPlanVersionInput.safeParse(candidate)` from `packages/contracts` (CLAUDE.md §7: the contract's Zod
     schema runs in the form). It refuses, for example, the year `0000` and a malformed salary multiple before any
     `BigInt` or `parseMoney` sees them. Zod issues are mapped to their block by path (`effective_from`, `base`,
     `tiers`, `package_sale`).
  3. `checkPlanBlocks(parsed.data)`; engine codes go to their block.
     The resolver returns `parsed.data` as the value to submit, so the body sent is exactly what was validated.
- **`plan-messages.ts`** — the map from the seven engine codes to `commissionPlanBuilder.*` keys, the map from
  field-reading errors to keys, and `planErrorCode(error)` which reads `details.code` from a
  `COMMISSION_PLAN_INVALID` envelope. Other server codes reuse the existing `commissionPlanErrors` catalog.

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
- **Server refusals.** A 422 `COMMISSION_PLAN_INVALID` carries a code and no path, and `INVALID_CALC` can come from any
  of the three blocks. So: the form re-runs `checkPlanBlocks` on the body it sent; if exactly one block reports that
  same code, the message is shown in that block; otherwise it is shown once at form level. Any other server code is a
  form-level `<p role="alert">`. A server message is cleared as soon as the admin edits the form.
- Logical CSS only, every string through `t(locale, …)`, components from `@pospay/ui`, icons from Phosphor through
  `@pospay/ui`, no closing comments, files under 300 lines, functions under 60.

### 3.5 Data and access (PR 2) — closing P1-1 and P1-2

The earlier review's two P1 findings: **P1-1** a refused or switched identity could still show the previous names;
**P1-2** a 403 seen on one list cursor, a version read or a save did not revoke the rest. Revision 1 of this plan relied
on `resetQueries` and `isSuccess`; Astra showed that is not enough (§8 points 2–3): with `staleTime` 30 s a return to an
identity shows its cached success at once, `isSuccess` stays true during a background refetch, a reset starts a new
fetch (403 → reset → 403), and a running save's callbacks survive a reset.

**Design.**

1. **Identity scope.** Every key starts with `['commission-plans', companyId, businessId, userId]`. The route keys the
   page by `company:business:user` (as `AlertRulesRoute`), so a switch remounts the page with empty local state.
2. **No trust in cached success.** These queries set `staleTime: 0` and `gcTime: 0`: when an identity's last observer
   goes away its entries are dropped, so returning to it starts from nothing and waits for a fresh answer.
3. **One shared access state per identity** (`plan-access.ts`): `{ denied: boolean, generation: number }`, held in the
   query cache under `[...scope, 'access']` (so the nav item and the page read the same value) and never garbage
   collected while either is mounted. Every data query is `enabled: !denied`.
4. **Any 403 closes the scope at once.** A 403 from the employee list (first or later page), a version read or the
   save calls `denyPlanAccess(scope)`: it sets `denied: true` and bumps `generation`, cancels the scope's in-flight
   fetches (the `signal` is passed to `fetch`), and removes the scope's data entries. Because the queries are now
   disabled, nothing refetches by itself — there is no 403 loop. The page clears the selected employee, the draft and
   the held idempotency key; the nav link, the names, the numbers, the picker and the section are not rendered while
   `denied` is true.
5. **Recovery is explicit.** The denied page shows a «try again» button. It sets `denied: false` with a new
   generation; only a **successful first employee page of that generation** shows data again. The old selection is not
   restored.
6. **Late answers are ignored.** A fetch or a save captures the generation it started under; its success or error
   handler does nothing if the generation has changed.
7. **An employee 404 is local:** the section shows `EMPLOYEE_NOT_FOUND` and that employee's version entries are
   removed; the list, the link and the access state are untouched.
8. **Lists.** Employees are one `useInfiniteQuery` (`limit` 50, opaque cursor); versions are one `useInfiniteQuery`
   per employee (`limit` 20). A failed later page shows a local «could not load more» message with a retry, unless it
   is a 403 (rule 4). A `503 COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE` shows its own message, not the empty state.
9. **Save.** One `Idempotency-Key` per (identity, employee, body): kept across a network failure of the same body, new
   when the body or the employee changes (the pattern of `use-cancel-service-line.ts`). On success the first history
   page is refetched and the form is re-based on the stored version.
10. Hooks set `retry: false`; fetches live in `api/`, never in a component; responses are parsed with the contract
    schemas.

### 3.6 Screen (PR 2)

- **Picker:** `NativeSelect` of `name — #employee_number` (the Arabic name when the locale is Arabic and it exists,
  otherwise the English one), a «load more» button while `next_cursor` is not null, and an `EmptyState` when the list
  is empty. No free-text or UUID field.
- **Section (per employee), keyed by identity and employee.** The editor is mounted only after the first history page
  for that employee has **succeeded**: a stored newest version becomes the draft; a successful empty history starts
  `emptyPlanDraft` with the list's `time_zone`. Once mounted, the draft is never replaced by a refetch or by loading
  more history. Changing the employee remounts the section with that employee's own draft; a save still pending for
  the previous employee has its result ignored by the new section (rule 6 and the key).
- **History:** TanStack Table with server pagination (CLAUDE.md §7), newest first: version, effective date,
  whole-period mark, a one-line summary per block (a disabled block that kept settings shows them as off), created
  at; «load more» appends in order.
- **Nav entry** in `DashboardNavigation`, shown only while the first employee page is a success and access is not
  denied, so an admin without the permission sees no link.

## 4. Tests

Every UI test asserts what the user sees (CLAUDE.md §9); a mock-call assertion may sit beside it, never replace it.
PR 2's access tests use a real `QueryClient` and deferred HTTP answers, never a mocked hook.

**PR 1**

| Id | Test | File |
| --- | --- | --- |
| CM-06 (builder half) | The §5.7 product is generated as **`PlanDraft` values** (calc kinds × threshold kinds × modes × accumulators × enabled flags, with: mixed threshold kinds, two equal steps, two descending steps, a disabled component empty and filled, and the validator's boundary values) and each is passed through the **production resolver**. For every draft the resolver refuses exactly when `validateWireCommissionPlan` refuses the same body, the first block error in the order base, tiers, packageSale equals the whole-plan code, and no draft the engine accepts is refused by a parser or by Zod. One case carries two different errors in two blocks and both are reported. | `model/__tests__/plan-resolver.spec.ts` |
| CM-06 | Every one of the seven engine codes has an Arabic and an English message. | `model/__tests__/plan-messages.spec.ts` |
| — | `toWireCandidate`: each parser's accepted and refused texts; disabled-empty → `{ enabled: false }`; disabled-filled keeps settings; `draftFromVersion` round trip. | `model/__tests__/plan-draft.spec.ts` |
| CM-09 | Three blocks render with switches and no formula text; turning tiers on with no step shows the `NO_STEPS` message **inside the tiers block** and the save button is **disabled**; fixing it enables save; a descending step shows `STEPS_NOT_ASCENDING` in the tiers block while base stays clean. | `ui/__tests__/plan-builder-form.spec.tsx` |
| CM-09 | A refused date (year `0000`) and a malformed amount each show a visible message and a disabled save. | same |
| CM-09 | A server `COMMISSION_PLAN_INVALID`: located in its block when one block reproduces the code; shown at form level when it is ambiguous (`INVALID_CALC` with two candidate blocks); cleared after an edit. | same |
| — | The translator spec with its independent `bigint` expectations, moved with the translator; `validateWireCommissionPlan` equals the two-step call; the API create-plan use-case specs still pass. | `packages/commissions-engine/src/__tests__/plan-wire.spec.ts` |

**PR 2**

| Id | Test |
| --- | --- |
| CM-09 | The history lists stored versions newest first; «load more» appends and keeps the order; a disabled block that kept its settings is shown as off with them. |
| FR-010a | The picker shows the Arabic name, the English fallback and the employee number; pages by cursor; an empty list shows the empty state and no option; a 503 cursor error shows its message, not the empty state; with the business in a zone where it is already tomorrow, the default date is the business's day, not the browser's. |
| FR-010a | An accountant-like session (plan list 200) reaches the screen from the link and picks an employee through the plan endpoint only (no `/employees` request is made); a session whose plan list answers 403 gets the denied state on a direct visit and no link. |
| **P1-1** | (a) First page 200 with `next_cursor`; «load more» is pending; the next page answers 403 → name, number, link, picker and section are gone, and the scope's cache holds no employee or version entry. (b) Identity A shown, switch to B, back to A within 30 s → nothing of A is shown until A's fresh first page succeeds; a late answer of A's old request, completed after the switch, changes nothing. |
| **P1-2** | Nav and page mounted together, a second employee's versions cached and another request in flight: a 403 from (i) a version read and (ii) the save each close the whole scope (as above) and clear the selection, the draft and the held key; entries of **another** identity are untouched. While the server keeps refusing, no request loop occurs (request count asserted). «Try again» with a 200 shows the list again with no employee selected. |
| — | Employee 404 → local message, the list and the link remain. Switching from employee A to B while A's save is pending: A's answer does not alter B's form. Save success → the new version is first in the history and the form shows it. Unchanged body after a network failure reuses the idempotency key; a changed body or employee takes a new one. |
| — | Nav item spec: hidden before success, hidden on 403, shown on 200. |

## 5. Steps

**PR 1 — editor (this branch)**

1. `owner-questions.ar.md` §51 (the lifted deferral, done in the plan commit) and the answer to §52 when it arrives.
2. Engine package: move the translator, add `validateWireCommissionPlan`, export from both entries, extend
   `test:node`, move the spec. Rewire the API use case and delete `plan-codec.ts`. ADR-0054 §1 and spec D-17 addenda.
3. Add `@pospay/commissions-engine` to `apps/admin/package.json`; `pnpm install` for the lockfile.
4. i18n catalog `commissionPlanBuilder` (ar/en, the same key set, wired in `catalog.ts`).
5. Model files with their unit tests.
6. Editor UI with its component tests.
7. Local gates, each its own command, in this order:
   `pnpm --filter @pospay/domain build` · `pnpm --filter @pospay/commissions-engine build` ·
   `pnpm --filter @pospay/commissions-engine typecheck` · `… lint` · `… test` ·
   `pnpm --filter @pospay/i18n build` · `pnpm --filter @pospay/contracts build` ·
   `pnpm --filter @pospay/api typecheck` · `pnpm --filter @pospay/api lint` · the API create-plan-version use-case specs
   (they need the database lane; if no lane is free they are left to `ci-gate` and reported as such) ·
   `pnpm --filter @pospay/admin typecheck` · `pnpm --filter @pospay/admin lint` · the admin `src/commissions` specs ·
   `pnpm lint:docs` · `pnpm module-map:check`.

An unmounted editor passes typecheck, lint, `lint:docs` and module-map on its own: no gate checks for unused exports,
and its component tests mount it directly.

**PR 2 — screen (own assignment, after PR 1 merges)**: data and access → picker, history, section, page → route, nav →
P1 and screen tests → journey `docs/journey/61-commission-plan-builder.md` (Arabic and English in the house shape,
README row).

The journey belongs to PR 2 because nothing is reachable before the route exists; PR 1's body says so.

## 6. Acceptance

- CM-06 builder half and CM-09 pass as written in §4; P1-1 and P1-2 are closed by their named tests before the route
  or the nav entry ships (PR 2).
- The admin app imports nothing of the engine but `./validation`; no validation rule is written in `apps/admin`; the
  contract's Zod schema runs in the form.
- No `number` holds money; no hardcoded string; logical CSS only; file and function limits hold.
- Each PR stays inside the budget recorded in §52; a delivery over it stops and returns to the manager.
- `ci-gate` green on the exact head; review findings resolved; merge only on Waleed's card (PP-195).

## 7. Out of scope

Service overrides (49-1, 49-2), statements, any contract, database or permission change, any API behaviour change (the
use case keeps its behaviour and calls the same validation through one function), and a `Switch` component in
`packages/ui`.

## 8. Astra debate — one round, 2026-11-20

Reviewer: Codex `gpt-6.2-astra`, reasoning medium, read-only. The OpenCode lane and the first Codex attempt both failed
on usage limits; the third attempt ran after the Codex reset. **Verdict on revision 1: REJECT** (one P0, seven P1, two
P2). Each point and what this revision does with it:

| # | Sev. | Astra's point | Outcome |
| --- | --- | --- | --- |
| 1 | P0 | The budget still needs a decision. The committed old attempt is 1,099 lines in 17 files, not 1,216 in the folder. PR 2 is under-estimated (old data layer 212). The proposed 700 + 550 exceeds the old 1,140 cap. Drop the step that creates §51. | **Applied.** §1 corrects the evidence, re-estimates with access handling (PR 2 ≈585), states that the new total is above the old cap, and lists what §52 must name (budgets, old caps, rounds, ownership). Two line savings he proposed are taken. §5 no longer creates §51. Still **open by design**: it is the manager's decision. |
| 2 | P1 | `resetQueries` alone does not close P1-1 or P1-2 (30 s `staleTime`, `isSuccess` during background refetch, reset refetches, save callbacks survive). | **Applied.** §3.5 rewritten: shared access state with a generation, immediate close on the first 403, cancel and remove without automatic refetch, explicit recovery, late answers ignored, `staleTime: 0` and `gcTime: 0`. |
| 3 | P1 | The two access tests could pass with the defect present. | **Applied.** §4 PR 2: real `QueryClient`, deferred answers, 403 from next page, version read and save with another request in flight and inactive entries cached; name **and number**; remount and return within 30 s; no request loop; retry does not restore the old selection. |
| 4 | P1 | The API imports the root entry, so exporting only from `./validation` breaks it; D-17 and ADR-0054 also restrict the **symbols** of `./validation`. Narrower option: keep the translator internal and export `validateWireCommissionPlan` from both entries; extend `test:node`. | **Applied — his narrower option adopted.** §3.1. ADR-0054 §1 and D-17 addenda are part of PR 1 and flagged for the merge card. |
| 5 | P1 | Flipping `enabled` does not isolate a block; define CM-06 equivalence on the real form path; keep the codec's independent `bigint` test. | **Applied.** §3.3 (`{ enabled: false }` literals, first-error equivalence) and §4 CM-06 row (product generated as drafts through the production resolver, the listed edge cases, the two-error case). |
| 6 | P1 | Run the contract's Zod schema before the translator and submit `parsed.data`. | **Applied.** §3.3 resolver step 2; tests for a refused date and a malformed amount in §4. |
| 7 | P1 | A server `details.code` cannot always be placed on a block (`INVALID_CALC`). | **Applied.** §3.4 «Server refusals» and its test row. |
| 8 | P1 | Define when the employee draft is replaced. | **Applied.** §3.6 section rules, §3.5 rules 6 and 9, and the A→B pending-save test. |
| 9 | P2 | Complete the FR-010a and CM-09 screen proof; TanStack Table for the history. | **Applied.** §3.6 and §4 PR 2 rows (name fallback, number, business-day default, 503 distinct from empty, plan-only and employees-only sessions, disabled block in history, order after paging). The «employees-only» case is tested as «the plan list answers 403», which is what the browser can observe. |
| 10 | P2 | The gate commands were incomplete (`typecheck lint` in one filter call runs neither script; builds first; engine and API gates). | **Applied.** §5 step 7. The API use-case specs need the database lane; if none is free they are reported as left to `ci-gate`, not as passed. |

No second debate round is authorized (PP-195: one round). Revision 2 has therefore **not** been re-read by Astra; the
manager may ask for a re-check before dispatch.
