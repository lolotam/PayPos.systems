# 49-2 — per-service commission override screen: implementation plan

> Plan author: Claude Fable 5.2 (PP-204: plan only; the implementer is GLM 5.3). Date: 2026-11-20.
> Tier: **Heavy** (commission money: the screen writes the rule that prices a line). Base: `origin/main` at `995361e6c`.
> Sources: `spec.md` row 49-2, Story 3 (CM-11…CM-13), FR-010, FR-010a, FR-011…FR-013; `owner-questions.ar.md` §41
> (CS-Q39 = PP-104.1), §43 (CS-Q40), §52; ADR-0054 §1 and §4; merged 49-1 (#762), 48-2b (#793), 48-3 (#1104, #1114);
> issue #1115 (the nav probe); `docs/owner-decisions.ar.md` items 112 (PP-192), 113 (PP-193), 118 (PP-198).
> Status: **revision 1, not debated.** Three questions are `PENDING` (`owner-questions.ar.md` §§57–59). Nothing here is
> implemented. The ids CS-Q49, CS-Q50, 49-2-DELIVERY-1, the section numbers 57–59 and the journey number 98 are
> provisional: other spec-059 sessions allocate from the same sequences, and the manager confirms them.

## 0. What this row delivers

An individual admin who holds `manage:commission-plans:business` opens «عمولة خاصة للخدمات», picks an employee with the
same picker as the plan builder, sees one row per service of the business with that employee's **current** override
(or «no special commission»), opens an edit dialog on a row, chooses one of the four rule kinds (CS-Q39: `FOLLOW_PLAN`,
`ZERO`, `PCT`, `FIXED`, nothing else) with a start date, saves a new insert-only override, and sees that service's
override history in the same dialog.

## 1. The exact API gap — the screen cannot be built on 49-1 alone

49-1 shipped `POST` and `GET /v1/businesses/{businessId}/employees/{employeeId}/commission-overrides`. Two facts, both
read from `main`, block a screen built only on them:

1. **The list carries `service_id` and no service name** (`packages/contracts/src/commissions/service-overrides.ts`),
   and it lists only services that already have an override. The screen needs every service, by name, to show the
   table and to create a first override.
2. **A default holder of the plan permission cannot read services.** `packages/db/src/role-defaults.ts`:
   `manage:commission-plans:business` is `['owner', 'accountant']`; `read:services:business` and
   `read:package-types:business` are `managers` = `['owner', 'general_manager', 'business_manager']`, and
   `record:service-sessions:branch` is the managers, the branch manager and the cashier. The accountant therefore gets
   403 from all three service lists on `main`: `GET …/services`, `GET …/package-types/service-options` and the session
   form's branch-scoped `service-options`.

This is the 48-2b situation again (FR-010a gave the plan screens their own employee list because the accountant has
no employees permission). The plan therefore adds one **read** endpoint owned by `commissions` before the screen.
What it may show of a service was a who-sees-what question, answered by Waleed as **CS-Q49 = name + the service's own
commission + its price** (§57, PP-206.1); closed services are listed with a «closed» mark and stay editable (**CS-Q50**,
§58, PP-206.2). Abu Salem's picks on batch 97 are pending; if his pick differs, it replaces these (follow-up).

A third constraint shapes the table: the 49-1 list is ordered by `(service_id, created_at DESC, id DESC)` over
current and history rows together and has no current-only filter, so «the current override of each service on this
page» cannot be read from it without walking every history page. The new endpoint answers that in one request.

## 2. Size ledger and sub-PR split — a decision is needed before dispatch

The spec row says 200–320 lines. That figure assumed the service list existed and predates 48-3. On `main` the
48-3 files that carry the access rules this screen inherits (`api/*.ts`, `pages/*.tsx`, the board, section, picker,
denied state, history table and server messages) are 875 lines by `wc -l`, against a PR 2 cap of 750.

| PR | Content | Production lines (hand-written) | Tests |
| --- | --- | --- | --- |
| **49-2a** | Backend read: the override screen's service list (contract, catalog reader, query, HTTP, wiring) | ≈330, cap **380** | ≈450 |
| **49-2b** | Admin data and model, unmounted: client, hooks, access keys, draft model, rule text, i18n catalog | ≈450, cap **500** | ≈520 |
| **49-2c** | Admin UI: table, dialog, section, page, route, nav entry, journey | ≈540, cap **620** | ≈560 |

Total ≈1,320 against 200–320. Generated files (`openapi.json`, `apps/admin/src/shared/api/schema.d.ts`) and the
journey page are not counted. PP-192 allows 600–900 only for slices with no money; this row is Heavy, so each PR
stays inside rule 3's range and the split is three PRs, merged in order a → b → c. **The caps are PENDING as
49-2-DELIVERY-1 (§59, technical, manager).** A delivery over its cap stops and returns to the manager (PP-112).

49-2b is unmounted on purpose, as 48-3 PR 1 was: it passes typecheck, lint, `lint:docs` and module-map alone, and its
hook tests mount it through a real `QueryClient`.

## 3. Design

### 3.1 49-2a — `GET …/employees/{employeeId}/commission-override-services` (FR-013a, new)

- **Path:** `GET /v1/businesses/{businessId}/employees/{employeeId}/commission-override-services`.
  Query (strict): `cursor?` (a service id, as `package-types/service-options` uses), `limit` 1…100, default 50.
- **Response** `CommissionOverrideServiceList`:
  `{ items: [{ service_id, name_ar, name_en, closed_at, current_override }], next_cursor }`, where `current_override`
  is `{ id, rule, effective_from, created_at } | null`. `rule` is `serviceCommissionRuleView` (the catalog rule shape
  49-1 already reuses). `null` means no eligible override today; the screen must never render it as `ZERO` or as
  `FOLLOW_PLAN` (CM-12: no row means the line's own saved snapshot).
  CS-Q49 (PP-206.1): each item also carries `service_rule` (the service's own current commission rule) and
  `price` (the service's current price in KWD, the catalog's money shape: string with 3 decimals). Duration and
  category are never returned. The 49-2a budget grows by ~15 lines for `price`.
  CS-Q50 (PP-206.2): closed services are listed with `closed_at`, and their override stays editable.
  The 49-1 write accepts a closed service today: its service check is `readSessionServices(...).length > 0`
  (`app.ts`), which does not filter `closed_at`.
  Items come in service-id order, as every service list on `main` does; there is no search and no name ordering
  (a name order would need a new index, so it is out of scope).
- **Guard:** `@Require('manage:commission-plans:business', { business: 'businessId' })`, `@RequiresFeature('commissions')`,
  an individual login (a device → 403). Inside the same `withTenant(companyId, tx => …, { userId })` the read rechecks
  in the 49-1 refusal order through `CommissionServiceOverrideListReads`: uniform 403, then `FEATURE_DISABLED`, then
  `EMPLOYEE_NOT_FOUND`. One guard transaction, no nested or second transaction (CLAUDE.md §6 connection budget). It is
  **not** gated on the `catalog` feature or on any services permission: that is the point of the endpoint.
- **Reads, no cross-context join.** `queries/commission-override-services.query.ts` runs two statements on the one `tx`:
  1. the page of services through a reader bound at `app.ts` — a new catalog export `readCommissionOverrideServices(tx,
     companyId, businessId, { cursor, limit })`, keyset `id > cursor ORDER BY id LIMIT limit + 1`, the same shape and
     index as `packageServiceOptionsStatement`;
  2. the current override of each returned service id (≤100) from `commission_service_overrides`, with the **same
     eligibility rule as the list's `is_current`**: `effective_from <= business today` and latest by `(created_at, id)`.
     Business today is `(CURRENT_TIMESTAMP AT TIME ZONE tz)::date` on the same transaction, as the list does.
  The read-side interface gains one method (`services`); the adapter is bound at `app.ts`. Module-map: one new row
  (`commissions` | the read-side interface | `catalog`, no import arrow), worded like row 181. ADR-0054 §4 gets a
  one-line addendum; no new ADR (the pattern is recorded there).
- **Migration: none expected, decided by `EXPLAIN`.** Statement 1 is the statement
  `package-types/service-options` already runs: it walks `services_pkey (company_id, id)` in order and filters
  `business_id`, so it needs no Sort, but in a company with several businesses it reads the other businesses' rows
  too. Statement 2 is covered by `commission_service_overrides_employee_service_idx (company_id, business_id,
  employee_id, service_id, created_at DESC, id DESC)` from migration 0196. The `EXPLAIN` test decides: a Sort, a
  sequential scan, or a statement 1 read that the reviewer judges unbounded on representative multi-business data
  **stops the PR and returns to the manager** (an index would need the migration lane); the implementer does not add
  a migration on their own.
- **Docs in the same PR:** `spec.md` FR-013a and the sub-PR table rows 49-2a/b/c; `docs/module-map.md`; OpenAPI
  registration (`service-overrides-openapi.ts`) and the regenerated client schema.

### 3.2 Folder shape (CLAUDE.architecture.md §11.2)

Everything lives in `apps/admin/src/commissions/{api,model,ui,pages}`; `app/` holds the route re-export and the frame
composition only. `commissions` may import **types** from `catalog`, never its components or hooks, so
`ServiceRuleFields` / `ServiceRuleValueField` are **not** reused; the dialog has its own small rule fields. The rule
kind labels reuse the existing i18n keys `catalogServices.ruleFollowPlan|ruleZero|rulePct|ruleFixed` (keys are in
`packages/i18n`, not in the catalog area). No engine import is needed: the engine's `/validation` entry has no
override validator, and the contract's Zod schema is the only validation (ADR-0054 §1 stays untouched).

### 3.3 Data and access (49-2b) — inherits 48-3 §3.5

The screen shares the plan builder's identity scope, access state and employee list; it adds no second probe (#1115).

1. **Keys** in `plan-access.ts`: `planOverrideServicesKey(scope, employeeId)` and
   `planOverrideHistoryKey(scope, employeeId, serviceId)`, both under the existing `PlanScope`.
   `denyPlanAccess` additionally removes `[...scope, 'override-services']` and `[...scope, 'override-history']`.
2. **Services table data:** `useCommissionOverrideServices(scope, employeeId)` — `useInfiniteQuery`, `limit` 50,
   `staleTime: 0`, `gcTime: 0`, `retry: false`, `enabled: !denied && !gone`, the generation check on every answer,
   403 → `denyPlanAccess`, 404 → local «employee not found» (the list and the link stay).
3. **History:** `useCommissionOverrideHistory(scope, employeeId, serviceId)` — the 49-1 list with `service_id` and
   `limit` 20, enabled only while the dialog for that service is open; same access rules.
4. **`is_current` is the server's.** The UI shows the mark the list returns and never derives «current», «upcoming»
   or «ended» from dates (the contract comment forbids it).
5. **Save:** `useSaveCommissionOverride(scope, employeeId, memory)`. The endpoint is idempotent only by key, and a
   duplicate row can never be removed, so the unresolved attempt `{ key, fingerprint }` is remembered **per
   `employeeId:serviceId`** in the page's own map, with 48-3's corrected rule 9: the same body reuses the key until a
   save with that key succeeds; a different body takes a new key; closing the dialog or switching employee does not
   drop it; it is cleared by a success, by a 403 that closes the scope, or by an identity change.
6. **After a successful save nothing is prepended.** The `POST` answer has no `is_current`, and a save can change
   which row is current. The two lists are refreshed differently:
   - the **history** of that service is reset and read again from its first page (a new row shifts every later page);
   - the **services table** is refetched in place with `invalidateQueries`: its pages are keyed by service id, a save
     does not move them, so the loaded pages stay on screen during the refetch and «load more» rows are kept.

   A save dated in the future therefore leaves the table row unchanged and adds a history row without the «current»
   mark. A late answer after a generation change does nothing.

7. **The open dialog is section state**, `useState<string | null>` holding the service id in
   `commission-overrides-section.tsx`, not table state: the table may refetch under it without closing it, and the
   dialog takes its service row from the current table data by id.
8. Fetches live in `api/`, parse with the contract schemas, and check `response.ok` before the body (the 403-with-empty-body
   rule of `commission-plans-client.ts`).

### 3.4 Model (49-2b)

- `override-draft.ts`: `OverrideDraft = { kind, bps: string, amount: string, effectiveFrom: string }` (strings only).
  `overrideDraft(current, timeZone, now)` starts from the row's current override when one exists, otherwise kind
  `PCT` with an empty value (so nothing can be saved by accident); `effectiveFrom` is always
  `localDate(now, timeZone)`, the business's day from the employee list's `time_zone`, never the stored row's date.
  `toOverrideBody(draft, serviceId)` builds the candidate and returns
  `createCommissionServiceOverrideInput.safeParse(candidate)` plus field read errors (`INVALID_DATE`, `INVALID_BPS`,
  `INVALID_MONEY`). It reuses `parseBps` and `parseKwd` from `plan-draft.ts` (exported for this; Arabic-digit input
  works the same). A `PCT` above 10000 or an amount outside the contract is refused by Zod and shown as the field error.
  `FOLLOW_PLAN` and `ZERO` send `{ kind }` only.
- `override-rule-text.ts`: one display line per rule. `FIXED` → `formatKwd(parseMoney(value))`, with `formatKwd` from
  `@pospay/i18n` and `parseMoney` from `@pospay/domain` (both packages, already used this way in the admin app): KWD
  with 3 decimals, no `number` holds money.
  `PCT` → the bps as a percent string built with integer arithmetic (`1500` → `15.00%`). The other two → their labels.
- `override-messages.ts`: server refusal → message. Known codes, all already keys of the `errors` catalog
  (`commissionPlanErrors`, `catalogServiceErrors` and the base list in `ar.ts` / `en.ts`): `EMPLOYEE_NOT_FOUND`,
  `SERVICE_NOT_FOUND`, `COMMISSION_EFFECTIVE_FROM_PAST` (shown under the date field), `COMMISSION_PERIOD_CLOSED`,
  `FEATURE_DISABLED`; anything else through `envelopeMessage`. No new error key is added.

### 3.5 Screen (49-2c)

- **Route** `/commissions/overrides`: `app/(dashboard)/commissions/overrides/page.tsx` re-exports
  `_frame/commission-overrides-route.tsx`, which keys the page by `company:business:user` (as the plans route).
- **Nav:** `CommissionPlansNavItem` renders a second `AppSidebarItem` under the same condition and the same probe, so
  no new request per page (#1115 is not made worse). Sidebar tokens and the icon come from `@pospay/ui` only (PP-193).
- **Page** `CommissionOverridesPage`: `PageHeader`, then the denied state (`CommissionPlansDenied`, reused) or the board.
- **Board:** `CommissionPlansBoard` takes a render prop for the selected employee's section instead of mounting
  `CommissionPlanSection` itself; the plans page passes the plan section, this page passes the overrides section. The
  picker, the cursor-error message and the «load more» behaviour are therefore the same code on both screens.
- **Section** (keyed by employee): the services table once the first page has succeeded; a failed first page shows
  its refusal; `EmptyState` when the business has no service.
- **Table** (TanStack Table in `DataTableFrame`, server pagination by «load more»): service name (Arabic when the
  locale is Arabic and it exists, else English), a «closed» `Badge` when `closed_at` is set (CS-Q50),
  the service's price (KWD, 3 decimals via packages/i18n) and its own rule (CS-Q49), the employee's current override as rule text with its start date, or
  «no special commission», and an «edit» button.
- **Dialog** (`ModalDialog` from `@/shared/ui/modal-dialog`), one service: react-hook-form with the resolver from
  `toOverrideBody`; a kind `NativeSelect` with exactly four options; a value `Input` (`dir="ltr"`, KWD normalised on
  blur) only for `PCT` and `FIXED`; a date `Input`; save disabled while invalid or pending; the server refusal shown
  until the next edit; below the form, the history of this service (rule text, start date, created at in the business
  timezone, the server's «current» mark, «load more»). After a successful save the dialog stays open on the refreshed
  history and the form is re-based on the saved rule. There is no delete, no reset-to-service and no whole-period
  control (FR-012, CS-Q39).
- All strings through `t()`; logical CSS only; tokens and components of `packages/ui` only — no new colour, font or
  library.

## 4. File-by-file change list with line budgets

**49-2a (backend)**

| File | Change | Lines |
| --- | --- | --- |
| `packages/contracts/src/commissions/override-services.ts` | new: query, item, list schemas with Arabic comments | 60 |
| `packages/contracts/src/commissions/service-overrides-openapi.ts`, `index.ts`, `__tests__/openapi-schema-names.commissions.ts` | register the path and schemas | 50 |
| `apps/api/src/modules/catalog/persistence/commission-override-services.reader.ts` + `catalog/index.ts` | new reader, exported | 40 |
| `apps/api/src/modules/commissions/queries/commission-override-services.query.ts` | new: the two statements, the mapper, the read-side method with Arabic doc | 120 |
| `apps/api/src/modules/commissions/http/commission-override-services.controller.ts` | new thin controller | 55 |
| `commissions.module.ts`, `persistence/commission-service-override-list-readers.ts`, `apps/api/src/app.ts` | wiring and the root binding | 40 |
| `docs/module-map.md`, `spec.md` (FR-013a, table), ADR-0054 §4 line | docs | — |

**49-2b (admin data and model)**

| File | Change | Lines |
| --- | --- | --- |
| `api/commission-overrides-client.ts` | new: three calls | 90 |
| `api/plan-access.ts` | two keys, two removals in `denyPlanAccess` | +15 |
| `api/use-commission-override-services.ts` | new | 50 |
| `api/use-commission-override-history.ts` | new | 45 |
| `api/use-save-commission-override.ts` | new | 90 |
| `model/override-draft.ts` | new | 80 |
| `model/plan-draft.ts` | export `parseBps`, `parseKwd` | +2 |
| `model/override-rule-text.ts`, `model/override-messages.ts` | new | 45 + 35 |
| `packages/i18n/src/commission-override-catalog.ts` + `catalog.ts` wiring | new catalog `commissionOverrides`, ar and en with the same key set | 100 |

**49-2c (admin UI)**

| File | Change | Lines |
| --- | --- | --- |
| `ui/commission-overrides-section.tsx` | new | 85 |
| `ui/override-services-table.tsx`, `ui/override-services-columns.tsx` | new | 70 + 80 |
| `ui/override-edit-dialog.tsx` | new | 90 |
| `ui/override-rule-fields.tsx` | new | 70 |
| `ui/override-history-list.tsx` | new | 60 |
| `ui/commission-plans-board.tsx`, `pages/commission-plans-page.tsx` | render prop for the section | ±20 |
| `pages/commission-overrides-page.tsx` | new | 45 |
| `app/(dashboard)/commissions/overrides/page.tsx`, `_frame/commission-overrides-route.tsx`, `_frame/commission-plans-nav-item.tsx` | route, frame, second nav item | 1 + 28 + 15 |
| `docs/journey/98-commission-service-overrides.md` + README row | journey, Arabic and English in the house shape | — |

Every file stays under 300 lines and every function under 60 (CLAUDE.md §3).

## 5. i18n keys — catalog `commissionOverrides` (ar and en, identical key set)

`navTitle`, `pageTitle`, `colService`, `colServiceRule` (CS-Q49), `colOverride`, `colEffectiveFrom`, `colCreatedAt`,
`noOverride`, `closedBadge` (CS-Q50), `edit`, `dialogTitle`, `ruleKind`, `bpsLabel`, `amountLabel`, `effectiveFrom`,
`save`, `saving`, `saved`, `cancel`, `historyTitle`, `historyEmpty`, `currentBadge`, `loadMore`, `couldNotLoadMore`,
`emptyTitle`, `emptyBody`, `errorInvalidDate`, `errorInvalidBps`, `errorInvalidMoney`, `errorSaveFailed`.
Reused, not duplicated: the four `catalogServices.rule*` labels, `commissionPlanBuilder.deniedTitle|deniedBody|tryAgain`,
`admin.chooseBusiness`, and the `errors.*` messages named in §3.4. The Arabic wording of «عمولة خاصة للخدمة» follows
`owner-questions.ar.md` §41.

## 6. Permissions

No permission, role default or grant changes. Read and write both need `manage:commission-plans:business` (FR-010,
CM-13) plus the `commissions` feature and an individual login. The new endpoint widens **what that permission
shows** (service names, and the service rule if CS-Q49 says so) and nothing else; that is the reason CS-Q49 is asked.
The UI hides nothing by itself: authorization is the server's, and a 403 anywhere closes the whole scope.

## 7. Tests

Every UI test asserts what the user sees (CLAUDE.md §9); a mock-call assertion may sit beside it. Access tests use a
real `QueryClient` and deferred HTTP answers, never a mocked hook (48-3 §4).

**49-2a** (`apps/api/src/modules/commissions/__tests__/commission-override-services-*.spec.ts`, real Postgres)

| Id | Test |
| --- | --- |
| FR-013a | An accountant (plan permission, **no** `read:services:business`) gets 200 with service names; the same session still gets 403 from `GET …/services`. |
| FR-013a | A manager with services read but without the plan permission → uniform 403; a device → 403; feature off → `FEATURE_DISABLED`; unknown or deleted employee, or one of another business → `EMPLOYEE_NOT_FOUND`; refusal order as the 49-1 list. |
| CM-12 | `current_override` equals the row the 49-1 list marks `is_current` for the same fixture: a future-dated row is not current; two rows on one date → latest `(created_at, id)`; no row → `null`, never `ZERO`. Evaluated on the business's day in a zone where it is already tomorrow. |
| — | Pagination: `limit + 1`, `next_cursor`, a second page continues with no repeat; malformed cursor → `VALIDATION_FAILED`; an extra query key → 400; exact item keys (no price, duration or category). |
| — | Tenant isolation: another company's services and overrides never appear (0 rows); another business's services never appear. |
| — | `EXPLAIN ANALYZE` on representative data with a second business in the same company: no Sort and no sequential scan in either statement; statement 2 reads through `commission_service_overrides_employee_service_idx`; the rows statement 1 reads are reported in the PR body. |
| — | Contract spec: the schemas and the OpenAPI names. |

**49-2b**

| Id | Test | File |
| --- | --- | --- |
| CM-12 | `toOverrideBody`: each of the four kinds builds the exact wire body; `PCT` 0 and 10000 accepted, 10001 and `1e3` refused; `FIXED` `12.5` → `"12.500"`, Arabic digits accepted, a negative or over-long amount refused; a bad date refused; no fifth kind exists in the type. | `model/__tests__/override-draft.spec.ts` |
| — | Rule text: `FIXED "1234.500"` shows `1,234.500`; `PCT 1500` shows `15.00%`; both languages for the two label kinds. | `model/__tests__/override-rule-text.spec.ts` |
| — | Save hook: the same body after a network failure reuses the key, including after another service's save; a changed body takes a new key; success reads that service's history again from page 1 and refetches the loaded table pages without emptying the table (two loaded pages stay visible and are both requested again), and clears the attempt; 403 closes the scope and clears the map; a late answer after a generation change changes nothing. | `api/__tests__/use-save-commission-override.spec.tsx` |
| P1-2 | A 403 from the services table (first and later page), from the history and from the save each close the whole scope: the plan employees, versions, override services and history entries are all gone, another identity's entries are untouched, and the request count shows no loop. | `api/__tests__/override-access.spec.tsx` |
| — | Both catalogs have the same keys. | i18n catalog spec |

**49-2c**

| Id | Test |
| --- | --- |
| CM-11 | Pick an employee, open «صبغة», choose percentage `1500`, keep today, save: the row then shows `15.00%` with today's date, the history shows the new row first with the «current» mark, and the request body is `{ service_id, rule: { kind: 'PCT', value: 1500 }, effective_from }`. |
| CM-12 | The kind select offers exactly four options; the value field is absent for «follow plan» and «zero»; a service with no override shows «no special commission», not zero and not «follow plan»; a fixed amount is shown as KWD with three decimals. |
| CM-13 | A yesterday date refused by the server (`COMMISSION_EFFECTIVE_FROM_PAST`) shows its message at the date field and keeps the typed values; `COMMISSION_PERIOD_CLOSED` shows its message; both disappear after an edit. |
| CM-13 | A session whose plan list answers 403 sees no nav entry and the denied state on a direct visit; an accountant-like session reaches the screen and no `/services` request is made. |
| — | Table: Arabic name with English fallback; «load more» appends in order; a failed later page shows the local message with a retry; an empty business shows the empty state; an employee 404 shows the local message and keeps the picker. |
| — | The «current» mark comes from `is_current`: a future-dated row with `is_current: false` is not marked current even when it is the newest row. A save dated next month leaves the table row as it was, shows the new history row without the mark, and keeps the dialog open. |
| — | Switching employee while a save is pending: the answer does not alter the new employee's table or dialog. Nav item spec: both links hidden before success and on 403, both shown on 200, one probe request only. |

## 8. Steps and local gates

Per PR, in the CLAUDE.md §1 order (contract → query → HTTP → tests; model → hooks → UI → route). Local gates, each its
own command: build `@pospay/domain`, `@pospay/i18n`, `@pospay/contracts`; then typecheck and lint of the packages the
PR touches; the PR's own spec files; `pnpm lint:docs`; `pnpm module-map:check`. 49-2a's API specs need a database
lane (one at a time per cluster); with no free lane they are left to `ci-gate` and reported as such, never as passed.
No Playwright and no full `pnpm check` locally (PP-113). A slice is «implementation complete, pending `ci-gate`» until
`ci-gate` is green on the exact head. The implementer runs `clean-code-guard`, `test-guard` and, as Heavy,
`waleed-security-reviewer` (PP-198); the session runs one `/code-review` on the whole diff.

## 9. Stop line

- **No dispatch** of any PR before §59 (size) is answered. **No dispatch of 49-2a** before §57 (CS-Q49) is answered:
  it fixes the response shape. §58 (CS-Q50) blocks only the closed-service filter and badge; the rest of 49-2a may be
  built with all services listed.
- The implementer stops and returns to the manager when: a PR exceeds its cap; `EXPLAIN` asks for an index (a
  migration); any contract change to the 49-1 `POST` or list seems necessary; a rule not written here is needed.
- Out of scope: any change to `apps/worker` (55-2c is working there), the engine, the 49-1 write path, permissions or
  role defaults, a fifth rule kind, deleting or resetting an override, the estimate screen (50-5), the nav-probe
  redesign of #1115, and any refactor of 48-3 beyond the board's render prop and the two exported parsers.
- Merge: `ci-gate` green on the exact head, findings resolved, and the Heavy merge rule in force at merge time.
