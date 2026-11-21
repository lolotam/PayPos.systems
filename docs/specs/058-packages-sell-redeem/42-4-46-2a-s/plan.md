# Implementation Plan: customer packages screen (42-4) and imported-refund switch (46-2a-S)

**Branch**: assigned by the manager at dispatch | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

**Input**: [spec.md](spec.md) and [research.md](research.md) in this folder. Source pin
`cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3`.

## Summary

One PR with two independent halves that share no production file except the i18n catalogs and the admin
navigation file.

- **A (42-4)**: an admin route `/orders/customers/{customerId}/packages` built on the merged hooks
  `useCustomerPackages` and `useCustomerPackageDetail`, linked from the day's sessions list and from the
  selected-customer card of the record-a-visit and sell-a-package forms. No API change.
- **B (46-2a-S)**: activate `manage:imported-refunds:business` (catalog, owner default, one data-only seed
  migration, display name), add `GET` / `PUT /v1/businesses/{businessId}/settings/imported-refunds` with a locked,
  re-checked, audited write in the `settings` module, and an admin switch page.

The refund use case, its route and its tests (PR #999 (46)) are not touched.

## Technical Context

**Language/Version**: TypeScript on Node 24 (`deploy/Dockerfile.api` uses `node:24-alpine`)

**Primary Dependencies**: NestJS (Fastify), Drizzle, Zod, Next.js App Router, TanStack Query, `@pospay/ui`,
`@pospay/i18n` — all existing; **no new dependency**

**Storage**: PostgreSQL; one existing column written; one data-only migration

**Testing**: Vitest (unit, API integration on the task's own Postgres lane, admin component tests)

**Target Platform**: `apps/api`, `apps/admin`, `packages/db`, `packages/contracts`, `packages/i18n`

**Project Type**: modular monolith + admin web app

**Performance Goals**: the switch write and both reads stay inside the 200 ms rule of `CLAUDE.md` §6; no new
measured budget is claimed

**Constraints**: guards keep the connection budget (the route guard completes its own access read first. Use one `withTenant` for the settings mutation and
post-lock authorization recheck, with no nested or parallel transactions); file ≤ 400 lines, function ≤ 60

**Scale/Scope**: see §6 (estimate)

## Constitution Check

| Principle | Check | Result |
| --- | --- | --- |
| I. One vertical slice | Two rows of spec 058 in one PR | **Deviation**, requested through the manager's brief; see Complexity Tracking |
| II. Domain purity and money | No arithmetic added; amounts are display strings from the reads | Pass |
| III. Tenant isolation | No new table; the write runs in `withTenant`; cross-tenant case tested (IRS-04) | Pass |
| IV. Module boundaries | `settings` → `identity` arrow exists (`docs/module-map.yaml:21`); two new imported symbols need their §3 rows; admin code stays in business-area folders; `app/` holds thin re-exports | Pass with module-map rows |
| V. Test-backed delivery | Integration IRS-01…09, query shape + `EXPLAIN`, UI visible-outcome tests | Pass when delivered |
| VI. Arabic-first, RTL | All strings through `@pospay/i18n`; logical CSS only; Phosphor icons through `@pospay/ui` exports | Pass when delivered |
| VII. Documented why | Arabic JSDoc on the new `ports/` methods and any `domain/` export; one line on the use case and the query | Pass when delivered |

Re-check after design: unchanged.

## Project Structure

### Documentation (this folder)

```text
docs/specs/058-packages-sell-redeem/42-4-46-2a-s/
├── spec.md
├── plan.md                      # this file
├── research.md                  # source evidence, decisions, holds
├── pending-manager-items.ar.md  # the hold and process items, in Arabic, for the audit files
└── checklists/requirements.md
```

### Source code (paths marked NEW are proposals; all others exist at the pin)

```text
packages/db/src/access-catalog.ts                       # add the code to PERMISSIONS
packages/db/src/role-defaults.ts                        # ROLE_DEFAULTS[code] = ['owner']; fix the "future" comment
packages/db/src/permission-policy.ts                    # keep the exported names; comments no longer say "future"
packages/db/src/system-role-policy.ts                   # comment only, if it still says the catalog is inactive
packages/db/migrations/<assigned>_imported-refunds-permission.sql   # NEW, custom, data-only
packages/db/migrations/meta/<assigned>_snapshot.json, _journal.json # generated
packages/i18n/src/permission-name.ts, permission-codes-catalog.ts   # display name ar/en
packages/i18n/src/<catalog files>                       # strings for both screens (NEW keys; file per existing convention)

packages/contracts/src/settings/imported-refunds.ts            # NEW
packages/contracts/src/settings/imported-refunds-openapi.ts    # NEW
packages/contracts/src/openapi.ts, openapi-schemas.ts, index.ts # registration
packages/contracts/openapi/openapi.json                        # generated
apps/{admin,pos,menu}/src/shared/api/schema.d.ts               # generated

apps/api/src/modules/identity/persistence/business-permission-access.ts  # NEW: the lock + decision of
                                                        # business-identity-access.ts, parameterised by permission
apps/api/src/modules/identity/persistence/business-identity-access.ts    # becomes two thin wrappers, same exports
apps/api/src/modules/identity/persistence/imported-refunds-access.ts     # NEW: lock… / read… for the new code
apps/api/src/modules/identity/index.ts                                   # two add-only exports

apps/api/src/modules/settings/ports/imported-refunds-access.port.ts      # NEW (check / recheck)
apps/api/src/modules/settings/ports/settings.port.ts                     # StoredSettings.importedRefundsEnabled,
                                                        # SettingsScope.importedRefundsAccess, saveImportedRefunds
apps/api/src/modules/settings/persistence/imported-refunds-access.adapter.ts  # NEW
apps/api/src/modules/settings/persistence/settings-transactions.ts       # COLUMNS + toStored + saveImportedRefunds
apps/api/src/modules/settings/use-cases/set-imported-refunds/set-imported-refunds.ts  # NEW
apps/api/src/modules/settings/queries/imported-refunds.query.ts          # NEW
apps/api/src/modules/settings/http/imported-refunds.controller.ts        # NEW (settings.controller.ts is not grown)
apps/api/src/modules/settings/settings.module.ts                         # wiring

apps/admin/app/(dashboard)/orders/customers/[customerId]/packages/page.tsx   # NEW thin re-export
apps/admin/app/(dashboard)/_frame/customer-packages-route.tsx                # NEW
apps/admin/src/orders/pages/customer-packages-page.tsx                       # NEW
apps/admin/src/orders/ui/customer-package-list.tsx, customer-package-card.tsx,
                        customer-package-detail.tsx, customer-package-components.tsx,
                        package-redemption-list.tsx, customer-packages-link.tsx   # NEW
apps/admin/src/orders/model/customer-package-view.ts                         # NEW pure helpers
apps/admin/src/orders/ui/package-redemption-history.tsx                      # uses the extracted list
apps/admin/src/orders/ui/service-session-day-visit.tsx                       # link beside the name
apps/admin/src/orders/ui/session-customer-field.tsx                          # link in the selected card
apps/admin/src/orders/ui/record-service-session-form.tsx                     # pass business scope into the field

apps/admin/app/(dashboard)/imported-refunds/page.tsx                         # NEW thin re-export
apps/admin/app/(dashboard)/_frame/imported-refunds-route.tsx, imported-refunds-nav-item.tsx  # NEW
apps/admin/app/(dashboard)/_frame/dashboard-navigation.tsx                   # one line
apps/admin/src/settings/imported-refunds/api|pages|ui/…                      # NEW

docs/module-map.md, docs/module-map.yaml      # two settings → identity symbol rows (yaml is generated)
docs/adr/0010-phase-1-ports-and-events.md     # addendum: the write route and its access port
docs/journey/<next>-customer-packages.md, <next>-imported-refunds-switch.md, README.md
```

**Structure Decision**: backend work stays in the standard module shape of `settings` and `identity`; the two
admin features live in `apps/admin/src/orders/` and `apps/admin/src/settings/imported-refunds/`; `app/` holds
routes and thin re-exports only.

## 1. Build order (`CLAUDE.md` §1.3)

| # | Step | Notes |
| --- | --- | --- |
| 0 | Record provider-native token counters (input, output, reasoning, cache) | before any code; again after step 9 and after step 10 |
| 1 | Contract `imported-refunds.ts` + OpenAPI registration | strict object, required boolean |
| 2 | Activation in `packages/db`: `PERMISSIONS`, `ROLE_DEFAULTS`, comments; i18n name | `ROLE_DEFAULTS` is typed on every `Permission`, so typecheck fails until the entry exists |
| 3 | Migration **draft** as a file under this folder (`imported-refunds-permission.draft.sql`), tested on the task's own Postgres | numbering, `pnpm db:generate imported-refunds-permission --custom` and the push wait for the manager's "lane granted"; never hand-edit the journal or a snapshot |
| 4 | Flip the three "not active yet" tests (research §3) | the assertions change meaning, they are not deleted |
| 5 | Identity access: extract `business-permission-access.ts`, wrappers, `imported-refunds-access.ts`, exports | `business-identity-access.ts` keeps its two exported names and behaviour; its existing specs must pass unchanged |
| 6 | Settings: port, adapter, transactions, use case, query, controller, module wiring | §2 |
| 7 | API integration tests IRS-01…IRS-09 | on the task's own lane only |
| 8 | Admin switch page, route, navigation entry, tests | §4 |
| 9 | Admin packages screen, three links, tests | §3 |
| 10 | Implementer runs `clean-code-guard` and `test-guard` and fixes their findings; one report with each finding's status | PP-198. Whether the implementer also runs `waleed-security-reviewer` is open (research §6) |
| 11 | Docs: module-map rows, ADR-0010 addendum, two journey files + README row, canonical amendments of §9 | `pnpm module-map:check` regenerates/validates the yaml |
| 12 | Local gates | §7 |

## 2. Backend design — the switch

**Transaction (one `withTenant`, opened by `SettingsTransactions.run`)**, mirroring
`update-business-identity-names.ts`:

1. `scope.importedRefundsAccess.check(businessId)` — locks the company (`FOR NO KEY UPDATE`), the company's
   memberships (`ORDER BY id FOR UPDATE`) and the business (`FOR SHARE`), then evaluates
   `manage:imported-refunds:business`. `FORBIDDEN` → `ApiError('FORBIDDEN')`.
2. `scope.findForUpdate(businessId)` — existing: creates the empty row if absent, then locks it.
3. `scope.importedRefundsAccess.recheck(businessId)` — decision at the database clock after the waits.
4. If `(before?.importedRefundsEnabled ?? false) === enabled` → return, nothing written.
5. `scope.saveImportedRefunds(businessId, enabled, userId)` — `UPDATE business_settings SET
   imported_refunds_enabled, updated_by, updated_at WHERE company_id, business_id` (the row exists after step 2).
6. `scope.audit.record({ entity: 'business_settings', entityId: businessId, action:
   'settings.imported_refunds_switched', before: { imported_refunds_enabled: <stored or null> }, after: {
   imported_refunds_enabled: enabled } })`.

Rules for the implementer:

- The use case contains no SQL, no `Date.now()`, no arithmetic; it returns `{ imported_refunds_enabled }`.
- `updated_at` uses `now()` in SQL as the sibling writers `saveIdentityNames` and `saveLogoFile` do; no `Clock`
  is needed. If a timestamp is ever taken in the use case it comes from the injected `Clock`.
- `StoredSettings` gains `importedRefundsEnabled: boolean | null`. The generic settings response is built field by
  field in `update-business-settings.ts`, so it does not start returning the flag; IRS-05 asserts that.
- The read (`queries/imported-refunds.query.ts`): one keyed `SELECT imported_refunds_enabled FROM
  business_settings WHERE company_id = … AND business_id = …`, read-only, no `domain/` import, with a one-line
  comment naming the consuming screen. It does not create the row. It may not import the persistence reader of
  the same statement (`queries/` → `persistence/` is not an allowed import); the two stay separate files.
- The controller is new and thin (`imported-refunds.controller.ts`), so `settings.controller.ts` (163 lines at the pin) does
  not grow. Both methods carry `@Require('manage:imported-refunds:business', { business: 'businessId' })`. The
  route-coverage check must list both.
- No Redis cache write or invalidation, no outbox event (research D-B2).
- Device refusal is required as an outcome (IRS-04: a device principal gets 403 on both routes). Which layer
  gives it was not established in this session: spec 058 TD-13 says the guard refuses a session with no user,
  while PR #1078 added an explicit device refusal on a `@Require` route. The implementer reads the access guard
  first and adds an explicit refusal only if `@Require` alone does not produce the 403.

**Effects, stated once**

| Action | Effect |
| --- | --- |
| Enable | Imported refunds become possible for callers who already pass every merged refund rule. Nothing else changes |
| Disable | Refunds of imported packages that start afterwards are refused (`IMPORTED_REFUND_DISABLED`); recorded refunds stay; `SOLD` unaffected |
| Revoke a grantee | Their next read or write is 403; the stored value stays as it is |
| Roll back the API image after the seed | The floor is an image containing PR #899; the seed row and audit rows are never deleted, the journal is never rewound (archived card, 2026-11-07) |

## 3. Admin design — customer packages screen

**Route**: `/orders/customers/[customerId]/packages`; `app/…/page.tsx` re-exports `CustomerPackagesRoute`, which
builds the `SessionServiceScope` from the workspace exactly as `package-sale-route.tsx` does (same "choose
business / branch" prompts, key on company:business:branch:user:customer), reads the segment through `useParams` and validates it with the contract
`id` schema, and renders `CustomerPackagesPage`.

**Detail selection**: `?package=<entitlementId>` in the query string; selecting a card pushes it, closing removes
it. A malformed value shows detail not found without issuing a detail request.

**Heading**: use the generic packages title. Keep customer names out of this route, URL and cache.

**Entry links** (label key e.g. `customerPackages.open`, «باقات العميلة» / "Customer's packages"):

| Surface | File | Shown when |
| --- | --- | --- |
| Day's sessions list, per visit | `service-session-day-visit.tsx` | caller provides the business and branch scope (the list requires `read:service-sessions:branch`) |
| Selected-customer card | `session-customer-field.tsx` (`sessionCustomerCard`) | a customer is selected and the caller passes a business and branch scope; pass it from the record visit parent as the sale form already does |

The link opens in the same tab from the day list and in a new tab from the two forms, so an unsaved form is not
lost. All entries use the generic heading.

**List** (`useCustomerPackages`): loading, empty, 403, 404 and retry states. Keep server ordering, pagination and
all packages, including inactive ones. A used-up package has no remaining available slots. FREE indicates an
available slot, and IMPORTED_USED indicates a slot used before import.

**Detail** (`useCustomerPackageDetail`): states loading / 404 / 403 / failure with retry. Sections: sale facts
(only the non-null ones; never an id, FR-A09), validity and expiry, components with slots, redemption history
(the extracted `PackageRedemptionList`), `PackageExtensionHistory` (unchanged), Extend button iff `can_extend`
opening `ExtendPackageDialog`. Reuse the existing extension mutation's list and detail invalidation.

Reuse query keys and AbortSignal from the existing hooks. Revalidate on entry/focus, and render 403/404 ahead of
cached data. Close detail actions and dialogs on denial or scope/customer changes. Test a preseeded cache and late
old response with the same QueryClient; a stale capability never substitutes for the server's authorization.

**Formatting**: money strings as `package-sale-result.tsx` renders them (`formatKwd` from `@pospay/i18n` inside
`<bdi dir="ltr">`); dates
and instants as `package-extension-history.tsx` does (`<bdi dir="ltr">` for dates, `formatInstant` with
`business_timezone` when present).

**Not built**: sidebar entry, customer search, refund button, refund history, seller or branch names, any POS
file.

## 4. Admin design — switch page

- Route `/imported-refunds`, frame file `imported-refunds-route.tsx` (workspace business required; "choose a
  business" prompt otherwise).
- `ImportedRefundsNavItem` placed after `BusinessIdentityNavItem` in `dashboard-navigation.tsx`; it runs the
  guarded GET (`retry: false`) and renders nothing while pending, on error, or without a business.
- The page reuses the interaction of `rating-requests-switch.tsx`: a labelled `role="switch"` checkbox disabled
  while saving; on success the query data is replaced by the server's answer; on error the query is invalidated so
  the control shows the stored value; an off-state note explains that imported packages cannot be refunded while
  off; 403 on read shows a "not allowed" message with no control.
- Query keys include company, user and business so a workspace change refetches.

## 5. Tests the PR must contain

The scenario ids are defined in [spec.md](spec.md#test-plan). File placement:

| Area | Files (NEW unless noted) |
| --- | --- |
| DB policy | `packages/db/src/__tests__/imported-refunds-policy.spec.ts` (rewritten), `role-defaults.spec.ts`, `system-role-policy.spec.ts`, `seed.spec.ts` (additions) |
| i18n | `packages/i18n/src/__tests__/permission-name.spec.ts` (addition) |
| Contract | `packages/contracts/src/settings/imported-refunds.spec.ts` |
| Identity | `role-default-grants.spec.ts` (addition, as PR #365 did), `imported-refunds-guard.spec.ts` (synthetic inserts replaced by the seeded state), `documents-owner-default.spec.ts` (ODOC-07 special case removed), `apps/api/src/modules/identity/domain/__tests__/imported-refunds-permission-edit.spec.ts` (stays green) |
| Settings API | `settings/__tests__/set-imported-refunds.spec.ts` (IRS-01…05, 07, 09), `set-imported-refunds-races.spec.ts` (IRS-06), `imported-refunds-query.spec.ts` (shape + `EXPLAIN`) |
| Use case unit | `use-cases/set-imported-refunds/set-imported-refunds.spec.ts` with in-memory ports: order check → lock → recheck → save → audit; no-op path; refusal paths |
| Admin packages | `customer-packages-page.spec.tsx`, `customer-package-detail.spec.tsx`, `customer-packages-link.spec.tsx`, `customer-packages-route.spec.tsx`, `model/customer-package-view.spec.ts`; existing `package-redemption-history.spec.tsx` and `session-package-toggle.spec.tsx` stay green |
| Admin switch | `imported-refunds-page.spec.tsx`, `imported-refunds-nav-item.spec.tsx` |

Security scenarios (IRS-04, IRS-06, the cross-tenant case, the device case) use synthetic fixtures on the task's
own database only. No request is sent to staging or production and no exploit tooling is written.

## 6. Estimate (additions + deletions; not measurements)

Basis: `git show --numstat` of analogous merged PRs — #985 (45-ui): 604 production / 821 tests; #741 (59-2
rating switch): 595 / 1,006 / 53 SQL / 24,458 generated; #365 (27h-1a permission): 11 / 43 / 6 SQL / 17,774
generated; #1073 (sale picker): 1,856 / 2,769. Generated sizes measured at the pin: `0235_snapshot.json` 30,797
lines; `_journal.json` entry 7 lines; `openapi.json` 45,155; each `schema.d.ts` 20,723.

| Subsystem | Production | Tests | Docs | SQL | Generated |
| --- | ---: | ---: | ---: | ---: | ---: |
| B: `packages/db` activation + comments | 25 | 110 | — | 8 | 30,810 (one snapshot + journal entry) |
| B: `packages/i18n` permission name + switch strings | 45 | 15 | — | — | — |
| B: contracts + OpenAPI registration | 75 | 60 | — | — | 380 (`openapi.json` + three `schema.d.ts`) |
| B: identity access (extract + new + exports), flipped tests | 110 | 90 | — | — | — |
| B: settings port, adapter, transactions, use case, query, controller, wiring and fixture updates | 330 | 755 | — | — | — |
| B: admin switch page, route, navigation | 290 | 330 | — | — | — |
| A: admin packages screen, model, scoped parent link, redemption-list extraction | 635 | 925 | — | — | — |
| A: `packages/i18n` screen strings | 70 | — | — | — | — |
| Docs: module-map rows, ADR-0010 addendum, two journeys + README, canonical amendments | — | — | 260 | — | 4 (`module-map.yaml`) |
| This spec, plan and supporting files (currently unpublished) | — | — | 1,011 | — | — |
| **Total if the implementation PR carries the planning files** | **1,580** | **2,285** | **1,271** | **8** | **≈ 31,190** |

- Estimate with the planning files: **≈ 5,144 hand-written lines**, **≈ 36,334 including generated files**.
  PP-112 measures the delivery against the final brief. Record the documentation baseline with the actual planning
  files carried by the single PR. Keep required tests.
- The generated figure is dominated by one full schema snapshot that `drizzle-kit` writes even for a custom
  entry (as #365's 17,767-line snapshot shows); it must match the previous snapshot's schema.
- The implementer brief stays under 400 lines (PP-192 rule 4) and points at these files instead of copying them.

## 7. Validation guide

Local gates (the implementer and then the reviewing session run them; a claim is not a result):

```text
pnpm typecheck                            # turbo run typecheck
pnpm lint                                 # turbo run lint (boundaries included)
pnpm lint:docs
pnpm module-map:check
pnpm contracts:openapi                    # regenerate; never hand-edit generated files
pnpm format:check
# the slice's own specs only, on this worktree's Postgres lane (never a shared or staging database)
```

These root scripts exist in `package.json` at the pin. The per-package test commands for the slice's own specs
were not looked up in this session; take them from each package's `package.json` at dispatch. The full `pnpm check` coverage and the API shards are decided by `ci-gate` on the exact head
(PP-113). Playwright E2E is not part of this delivery.

Manual check after a staging release (by DEP-1's owner, not by the implementer): open a customer's packages from
the day list as a reader; as the owner switch imported refunds on, refund an imported package, switch off, see
the refusal.

## 8. Handoff (as the manager's brief sets it, with the open points marked)

1. **Before dispatch (manager)**: record Waleed's Medium exception and explicit isolated-test authority in
   [pending-manager-items.ar.md](pending-manager-items.ar.md). Astra design review is complete. Coordinate the
   migration lane before final numbering and the PR push.
2. **Implementer**: the same GLM 5.3 Flash OpenCode session (`zai-coding-plan/glm-5.3-flash`, variant `high`,
   PP-204) implements, tests, runs `clean-code-guard` and `test-guard`, and records provider-native input,
   output, reasoning and cache counters at three points: before code, after implementation and tests, after the
   guards. Fences: own worktree only, no `.env*`, no `git stash`, no shared database, no staging or live access.
3. **Security review**: independent `waleed-security-reviewer` on Sol 6.2 Medium, as explicitly retained by Waleed for permissions and migration. Include independent whole-diff code review.
4. **One implementation PR**, body naming `42-4` and `46-2a-S`, the tier, the exception, the spec link, the
   checklist (spec, migration, RLS n/a, indexes n/a, tests, i18n, doc comments, docs, journeys) and the Arabic
   feature summary with the permission and migration flags.
5. **Gates**: exact-head `ci-gate` on current main, Medium reviews and disposition, the independent Sol security
   receipt, and ordered migration validation before manager merge. Verify no target migration runs before U,
   including a migration triggered by merge. Staging requires DEP-1, PP-129 snapshot and H-3/U before seed.

## 9. Canonical amendments the implementation PR makes

Listed here so this planning PR rewrites nothing canonical:

- `docs/specs/058-packages-sell-redeem/spec.md`, sub-PR table: mark row **42-4** complete with the PR number; in
  row **46-2a** note that the column, the orders reader, its module-map row and the ADR-0010 addendum shipped in
  PR #999 (46) and the guard in PR #899 (46-2a G), and that this PR (46-2a-S) ships the permission seed, the
  route, the audit and the admin switch.
- `docs/specs/058-packages-sell-redeem/owner-questions.ar.md`: no new question; add the manager's recorded
  decision and manager delegation recorded in this delivery's audit.
- `docs/adr/0010-phase-1-ports-and-events.md`: addendum for the settings write and its identity access symbols.
- `docs/module-map.md` §3 / generated yaml: `settings → identity` rows for the two new symbols.
- `docs/journey/README.md`: two rows.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Two spec rows (a UI screen and a permission-activating settings write) in one PR, against `CLAUDE.md` §1.1 and PP-192 rule 3 | The manager's brief states Waleed asked for one consolidated spec, plan and PR "even if large" | The owner chose one implementation PR. A split would need a new owner decision. |
| A parameterised identity access helper with two callers | Two real implementations today (business identity, imported refunds) share the same lock order; copying it would duplicate about 60 lines of locking code that must stay identical | A copy was rejected for drift risk in a security-relevant lock sequence |
