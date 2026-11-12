# Plan — row 43-3: reception «من الباقة» (redeem toggle, earliest-expiry suggestion, redemption history)

Spec: [spec.md](spec.md) §5 FR-070, FR-071, Story 8, PK-Q15 (the reception chooses; the screen suggests the package that
expires first), row table §7 (43-3; "Detail query order" rule). Branch `feat/p1-058-43-3-redeem-ui` from `origin/main`
`72152157b` (42-4r, #931). Redeem itself (record/append with a package line) is 43-2 (#841) and is reused unchanged.

## Scope

In:
1. Reception record-service-session screen (row 35, `apps/admin/src/orders/`): on each session line a «من الباقة» toggle.
   On: the paid price and discount inputs are hidden and the line sends `{ service_id, package: { entitlement_id },
   performers }` (the 43-2 `packageSessionLineInput`). The picker lists the selected customer's **usable** packages that
   contain the line's service, each with name, expiry date and the remaining count of that service's component, from the
   42-4r list (`useCustomerPackages`).
2. Earliest-expiry suggestion: the picker preselects the usable package with the smallest `expires_on`, marked «مقترحة».
3. Redemption history (FR-071): the detail's redemptions with their visit dates. Spec row 43-3 and the detail-query order
   rule put this section in 43-3, so the backend part is in this PR: `redemptions[]` in the detail contract and query
   (no migration: `package_redemptions` exists since 0205 and its `(company, business, entitlement, component)` index
   covers the lookup). The screen shows it as a collapsible section under the selected package in the picker.
4. Component tests asserting visible outcomes (PP-7.2); query/contract tests for the redemption history.

Out: the customer packages screen and sale form (row 42-4), extension and refund history (rows 45, 46-3), any change to
the 43-2 writer or `savedServiceLine` (see D9), any migration. No business rule is open: PK-Q15, PK-Q7 and PK-Q17 are
answered (spec §3, `owner-questions.ar.md`); no `TODO(spec)` applies to this row.

## Decisions (none is a business rule)

Revised after the debate ([debate-43-3-astra.md](debate-43-3-astra.md): Astra out of quota, `pospay-advisor` as a
non-binding stand-in; all accepted except finding 3, which is escalated).

- **D1 — draft model.** `SessionDraftLine` gains `from_package: boolean` and `package_entitlement_id: string | null`
  (`createSessionDraft`: false/null). "Toggle on" and "package chosen" are separate so a line with the toggle on and no
  pick can never be sent as a paid line: `package_entitlement_id` is a required field while `from_package` is true, and
  `sessionCommandLines` throws if a package line has no id. Price and discount are left untouched while the toggle is on
  (the paid inputs are hidden, not cleared) and the price `validate` rule returns true while `from_package` is true.
- **D2 — toggle gating.** The toggle can be turned ON only when the visit has a customer (`result.customerId`) and the
  line has a service; turning it OFF is always allowed (a recovered package line after a reload has no customer and must
  not be stuck). The form clears `from_package` and the pick on every line when the customer changes before the first
  save.
- **D3 — candidates.** From the 42-4r list: packages not `used_up` with a component whose `service_id` equals the line's
  service and `remaining > 0`. `!expired` is required when the visit time is "now" (no explicit time); when the visit time
  is explicit (back-dated entry, or an append to a saved visit) expired packages that still have free sessions are listed
  too, marked, because FR-024 judges the visit's date, not today's (the server stays the authority). `remaining` shown is
  the component's remaining minus the picks of the **other** unsaved lines for the same entitlement and service (counts,
  never money); an option at 0 is disabled, and a chosen option at 0 is a validation error.
- **D4 — suggestion.** `suggestPackage(options)` over the reduced options: among non-expired options with `remaining > 0`,
  the smallest `(expires_on, id)`; `null` when none. It seeds the pick only when the toggle turns on with no pick, and
  re-seeds only when the chosen id is no longer an option; a valid user choice is never overridden. No seeding until the
  package list is complete (no next page).
- **D5 — freshness.** One list owner at form level (`SessionDraftLines`) calls `useCustomerPackages` once and pages to
  the end (cap 10 pages) with a visible error and retry; rows receive the items. `customer-packages` and
  `customer-package-detail` are invalidated in `onSettled` of record and append (success, failure or display failure).
- **D6 — history contract.** `customerPackageDetail.redemptions[]` (required; admin and API deploy together):
  `id`, `component_id`, `ordinal` (slot ordinal), `redeemed_at`, `visit_business_date` (`service_sessions.business_date`),
  `reversed_at` (null until row 44). Ordered `ss.occurred_at DESC, s.ordinal DESC, r.id`. A correlated `jsonb_agg`
  subselect inside the one statement (same snapshot), `COALESCE '[]'`, joined through `r.slot_id` and `r.line_id`, with
  `company_id` and `business_id` on every join. No field for who recorded it.
- **D7 — recovery.** `recoverAttempt` rebuilds a package draft (`from_package` true, entitlement from the attempt, no
  price or discount), never a paid line.
- **D8 — display.** No amounts and no money arithmetic. Date-only strings are shown as the ISO text inside `<bdi>`
  (no `new Date()` timezone shift). The toggle is a `Button` with `aria-pressed`.
- **D9 — escalated, not in this PR.** A saved package line shows price/net and an Edit button in the saved view
  (`savedServiceLine` has no package marker). Fixing it needs a response field on the 43-2 writer and the day reads and a
  decision on the visit total; reported to the manager (debate finding 3).

## Files (CLAUDE.md §1 order) and implementer

| # | Layer | File | Kind | Who |
|---|---|---|---|---|
| 1 | contract | `packages/contracts/src/orders/customer-packages.ts` | add `customerPackageRedemption` and required `redemptions` on the detail; export in the schemas list | Kimi |
| 2 | generated | `packages/contracts/openapi/openapi.json`, `apps/{admin,pos,menu}/src/shared/api/schema.d.ts` | regenerated by me | Claude |
| 3 | query | `apps/api/src/modules/orders/queries/package-entitlement-detail.query.ts` | add `redemptions` projection (D6) | Kimi |
| 4 | i18n | `packages/i18n/src/service-session-catalog.ts` (ar/en) | keys for toggle, picker, suggestion, history, states | Kimi |
| 5 | model | `apps/admin/src/orders/model/session-drafts.ts` | `from_package`, `package_entitlement_id`; `createSessionDraft` | Kimi |
| 6 | model | `apps/admin/src/orders/model/session-package-options.ts` | new: candidates, in-form reduction, `suggestPackage`, `clearPackagePicks` | Kimi |
| 7 | model | `use-session-recording.ts` (`sessionCommandLines`), `session-recording-result.ts` (`recoverAttempt`) | package line emitted and recovered (D1, D7) | Kimi |
| 8 | api | `use-record-service-session.ts`, `use-append-service-session-lines.ts` | invalidate package queries in `onSettled` (D5) | Kimi |
| 9 | ui | `session-package-toggle.tsx`, `session-package-picker.tsx` | new: toggle, picker, suggestion, states | Kimi |
| 10 | ui | `package-redemption-history.tsx` | new: history section from the detail hook | Kimi |
| 11 | ui | `session-draft-lines.tsx`, new `session-draft-line-row.tsx`, `record-service-session-form.tsx` | list owner, row extraction, hide price/discount, clear picks on customer change | Kimi |
| 12 | tests | `packages/contracts/src/orders/customer-packages.spec.ts` | redemptions shape | Agy |
| 13 | tests | `package-entitlement-detail-query.spec.ts` (+ http spec case, 42-4r exact-key assertions, `use-customer-package-detail.spec.tsx` fixtures) | redemptions list, order, reversed, no cross-customer leak; `EXPLAIN ANALYZE` index use on the three new tables, no seq scan, 200 ms on a large fixture | Agy |
| 14 | tests | `session-package-options.spec.ts` | candidates, reduction, expired rule, suggestion tie | Agy |
| 15 | tests | `session-package-toggle.spec.tsx`, `package-redemption-history.spec.tsx`, `session-draft-lines-package.spec.tsx`; recovery case in `session-recording-result.spec.ts` | visible outcomes | Agy |

Admin paths are under `apps/admin/src/orders/{api,model,ui}`; API tests under `apps/api/src/modules/orders/__tests__`.
Shared files are edited add-only where possible.

## Size estimate (changed lines, PP-112/§14; refuse a delivery above 2x)

| Category | Estimate |
|---|---|
| Production (contracts 25, query 45, i18n 45, admin model 130, admin ui 330, hooks 20) | 595 |
| Tests (contracts 30, query 160, model 110, ui 360, recovery 40) | 700 |
| Generated | not counted |
| Docs (this plan, debate record) | not counted |

## Gates

Typecheck, lint, `pnpm lint:docs`, boundaries, `pnpm module-map:check`; contracts and admin tests; the detail query
spec on a private DB lane; `api:check` for admin/pos/menu. Full `pnpm check` and shards are decided by `ci-gate`.

## Review round 1 (PP-131.2)

Four accepted findings, fixed in one commit.

1. **Remaining-sessions arithmetic (P1).** The subtraction "component remaining minus the sessions held by the other unsaved lines, floored at 0" is now `remainingAfterDraftPicks` in `packages/domain/src/packages/package-draft-remaining.ts` (Arabic JSDoc, exhaustive unit tests, exported from the domain index). Admin `model/session-package-options.ts` keeps the mapping, filtering and the per-entitlement pick count (counting picks is selection bookkeeping, not a rule) and calls the domain function.
2. **Summary on package lines (HIGH).** `SessionDraftSummary` handles `from_package` before any money parsing: the row shows the «من الباقة» label, it is excluded from the total, and it never shows a price error. A package-only visit shows `0.000` (the existing sum-of-nothing convention; no new money rule).
3. **Reselecting the same customer (MEDIUM).** D2 is refined: typing in the customer fields emits `onChange(null)` on every keystroke, so a `null` selection never clears picks. Picks are cleared only when a resolved non-null customer id differs from the last known non-null id (a ref seeded from and synced with `result.customerId`, so a cold-recovered draft keeps its picks when the same customer is resolved again).
4. **Page cap (MEDIUM).** `complete` is true only with no next page. `PackageList.truncated` (next cursor left after 10 pages) disables the earliest-expiry suggestion and shows the `packageListTruncated` note; manual choice from the shown packages stays possible.
