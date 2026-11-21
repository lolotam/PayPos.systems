# Research: 42-4 and 46-2a-S — what is on `main`, what is missing, what is held

Pin: `origin/main` = `cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3` (2026-11-21 14:29 +0300, PR #1149 (50-4)).
The planning worktree's own HEAD is `8c46615f0` (2026-11-04), 224 commits behind the pin, so nothing was read
from the checked-out files; every source fact below comes from `git show <pin>:<path>` or `git grep <pin>`.

## 1. Documents read

| Document (at the pin unless noted) | How much |
| --- | --- |
| `AGENTS.md`, `docs/agent-delivery-pipeline.md`, `.specify/PROJECT-OVERRIDES.md` | full |
| `CLAUDE.md` | the worktree copy (2026-11-04) in full, plus the diff to the pin with each changed line cut at 900 characters, so the tails of the long PP-195 and PP-72.2 header paragraphs were read from `owner-decisions.ar.md` instead |
| `.specify/memory/constitution.md` | Core Principles I–VII in full; later sections by heading only |
| `CLAUDE.architecture.md` | §3.1, §11, §12, §15 in full; other sections by heading only |
| `docs/06_Tech_Stack_Architecture_EN.md` | read, lines cut at 700 characters (the long table cells of §1 and §1.1 are truncated) |
| `docs/PRD.md` | **not read** in this session |
| `docs/module-map.md`, `docs/module-map.yaml` | only the rows for `orders → settings` and `settings → identity` |
| `docs/owner-decisions.ar.md` | PP index rows 195–211; items 112 (PP-192), 115 (PP-195), 116 (PP-196), 118 (PP-198), 121–125 (PP-201…PP-208), 128 (PP-211); a grep for `46-2a`, `imported-refunds`, `PK-Q24`, `PK-Q26` |
| spec 058 `spec.md` | summary rows, TD-13, TD-14, PK-Q17/24/26, Story 8, FR-070…FR-072, the permission table, the sub-PR table |
| spec 058 `owner-questions.ar.md` | a grep for PK-Q17/24/26, 45-UI-Q1…Q3, 42-4, 46-2a (headings and answers) |
| `plan-46.md`, `46-2a-g-validation.md`, `46-2a-g-manager-authorization.ar.md` | full |
| `plan-42-4r.md` | scope lines and file table |
| ADR-0010 | the 2026-11-13 addendum heading and its "The write stays out" bullet |
| Local archive `C:\Users\waleed_Mohamed\.t3\task-archives\46-2a\` (not in the repository) | `g-899-merged-receipt.txt`, `dep1-applicability-ffd3351.txt`, `g-final-head-gates.txt`, `planning-37451b2-r1/46-2a-migration-card.ar.md` in full; `46-2a-planning-brief.md` lines 19–308 |
| Skills `speckit-specify`, `speckit-plan`, `docs-guard` | read; the spec-kit scripts were not run (see §7) |

The partial and missing reads are a limitation of this plan. The manager's single review of the plan (pipeline §4)
should weigh it, in particular for `PRD`.

## 2. 42-4 — what already renders

| Fact | Evidence |
| --- | --- |
| The list and detail reads are merged (PR #931 (42-4r)); the detail reader came from PR #818 (42-4b-a) | `apps/api/src/modules/orders/http/customer-packages.controller.ts`, `queries/customer-packages.query.ts`, `queries/package-entitlement-detail.query.ts` |
| Both routes: `@RequireAny(['record:service-sessions:branch','read:service-sessions:branch'], { branch: 'branchId' })` + `@RequiresFeature('orders')` | same controller, lines 22–23 and 44–45 |
| Contract shapes; the only capability field is `can_extend`; no refund history; seller and branch are ids only; no phone | `packages/contracts/src/orders/customer-packages.ts` |
| Admin data hooks exist | `apps/admin/src/orders/api/use-customer-packages.ts` (infinite query, de-duplicates across pages), `use-customer-package-detail.ts` |
| The hooks are used only inside the record-a-visit form: `session-draft-lines.tsx` → `session-package-toggle.tsx` → `session-package-picker.tsx` → `package-redemption-history.tsx` (redemptions, `PackageExtensionHistory`, Extend button on `can_extend`, `ExtendPackageDialog`) | `git grep useCustomerPackages\|useCustomerPackageDetail` in `apps/admin` |
| The sale form and picker are merged (PR #1073 and follow-ups #1077, #1078, #1094, #1100); route `/orders/package-sales/new` | `apps/admin/app/(dashboard)/_frame/package-sale-route.tsx`, `src/orders/pages/package-sale-page.tsx` |
| **No standalone customer-packages screen exists.** No `app/` route and no page file for it | `git ls-tree -r apps/admin/app` |
| `apps/pos` has no package file at all | `git ls-tree -r apps/pos/src \| grep -i package` → empty |
| The day's sessions list returns `customer: { id, name }` per visit and is guarded by `read:service-sessions:branch` | `packages/contracts/src/orders/service-session-day.ts:40`; `apps/api/src/modules/orders/http/service-sessions.controller.ts:44–45`; rendered by `apps/admin/src/orders/ui/service-session-day-visit.tsx` (`visit.customer.name`) |
| The only customer selector is find-or-create, a write under `create:customers:*` | `apps/api/src/modules/customers/http/customers.controller.ts`; `apps/admin/src/orders/ui/session-customer-field.tsx` |

**Decision D-A1 — entry points.** The screen is opened from where the customer is already known: the day list
(a `read`-only holder's path, no side effect) and the selected-customer card of the two forms (a recorder's or
seller's path). *Alternative rejected:* a sidebar entry with its own customer field. It would reuse find-or-create,
which creates a customer on an unknown phone and needs `create:customers:*`, so a `read`-only holder (CP-03) could
not use it. *Alternative rejected:* a new read-only customer search route — a new customers API, outside rows 42-4
and 46-2a.

**Decision D-A2 — address.** `/orders/customers/{customerId}/packages`, the open package in the query string
(`?package={entitlementId}`), so the browser's back button closes the detail. All entry points use a generic
heading without carrying the customer name.

**Decision D-A3 — reuse.** The detail reuses `PackageExtensionHistory` and `ExtendPackageDialog` unchanged. The
redemption rows of `package-redemption-history.tsx` are extracted into a presentational list so both the picker's
`<details>` and the new detail render the same rows; the picker's behaviour and tests stay as they are.

**Decision D-A4 — excluded fields.** Seller, branch and package-type are ids in the contract; showing names needs
a read that does not exist. They are left out (FR-A09) instead of adding an API.

## 3. 46-2a-S — what is shipped and what is missing

| Piece | State at the pin | Evidence |
| --- | --- | --- |
| Column `business_settings.imported_refunds_enabled boolean` (nullable) | shipped, PR #999 (46) | `packages/db/migrations/0223_2026-11-13_package-refunds.sql:15`; `packages/db/schema/settings.ts:50` |
| Settings public reader `readImportedRefundsEnabled(tx, companyId, businessId)` (true only when stored true; plain `SELECT`, no lock) | shipped | `apps/api/src/modules/settings/persistence/read-imported-refunds-enabled.ts`; export in `settings/index.ts:15` |
| Orders port `ImportedRefundsPort` and its use in the refund | shipped | `orders/ports/package-refund.port.ts:97`; `orders/persistence/package-refund.transactions.ts:79`; `orders/use-cases/refund-package/refund-package.usecase.ts:106` |
| Module-map row and ADR-0010 addendum for that read | shipped | `docs/module-map.md:158,419`; `docs/module-map.yaml:50`; ADR-0010 addendum 2026-11-13 |
| Policy knowledge of the code: `IMPORTED_REFUNDS_PERMISSION`, `POLICY_PERMISSIONS`, `deviceForbidden`, DB `OWNER_GRANTED_PERMISSIONS`, human eligibility in `systemRolePolicy` | shipped, PR #899 (46-2a G) | `packages/db/src/permission-policy.ts`, `role-defaults.ts:40–41`, `system-role-policy.ts:17–18,124` |
| Identity owner-only lists (`OWNER_GRANTED_PERMISSIONS`, `OWNER_ONLY_EDIT_PERMISSIONS`) | shipped, PR #899 | `apps/api/src/modules/identity/domain/permission-edit.ts:6–26` |
| The code in the **activation** catalog `PERMISSIONS` | **missing** | `imported-refunds-policy.spec.ts` asserts `PERMISSIONS` does not contain it |
| `ROLE_DEFAULTS['manage:imported-refunds:business']` | **missing** | same spec asserts the key is absent |
| `permissions` row and owner `role_permissions` row in a deployed database | **missing** | no migration inserts the code (`git grep` over `packages/db/migrations`) |
| Arabic / English permission name | **missing** | no entry in `packages/i18n/src/permission-name.ts` or `permission-codes-catalog.ts` |
| A route that writes the switch; a route that reads it for a screen; an audit entry | **missing** | the column is written only by test fixtures (`package-refund.fixture.ts:271`); `settings.controller.ts` has no such route |
| Admin switch | **missing** | no admin file mentions the switch |

**Why a migration is needed (three checks).**

1. `Require` / `RequireAny` take `TenantPermission` from `@pospay/db`
   (`apps/api/src/shared/access.decorators.ts:83–101`), so a route cannot be guarded by the code until it is in
   `PERMISSIONS`.
2. `role_permissions.permission_code` and `permission_overrides.permission_code` reference `permissions.code`
   (`packages/db/schema/identity-access.ts:90–92,191–193`), so the owner's personal grant cannot be stored without
   the `permissions` row.
3. The deploy `migrate` image runs `node scripts/migrate.ts` (`deploy/Dockerfile.api:21`), which imports only
   `migrateDatabase`; `seedReferenceData` is a separate script (`db:seed`). Precedent: `0148` for
   `manage:business-identity:business` and the seed block of `0223` for `refund:packages:branch`.

So the missing activation is **one** data-only migration. The archived card's second schema entry (`M`, the column)
is obsolete because PR #999 shipped the column. The card's "narrow column UPDATE grant" is not needed:
`0023_2026-09-23_settings-rls.sql:16` grants table-level `SELECT, INSERT, UPDATE` to `pospay_app`, no later
migration revokes it, and `packages/db/test/table-grants.ts:31–33` lists exactly those three.

**Tests and comments that assert "not active yet" and must change with the activation.**

- `packages/db/src/__tests__/imported-refunds-policy.spec.ts` — "knows the future policy … without activating".
- `apps/api/src/modules/identity/__tests__/documents-owner-default.spec.ts:166–170` (ODOC-07) — expects 403
  `FORBIDDEN` for this code.
- `apps/api/src/modules/identity/__tests__/imported-refunds-guard.spec.ts` — models the post-activation state with
  synthetic `INSERT`s; those rows now come from the seed.
- Comments saying the code is "future" / "لا يدخل seed" in `permission-policy.ts`, `role-defaults.ts:39`,
  and the doc comment above `systemRolePolicy` in `system-role-policy.ts`.

**Decision D-B1 — write pattern.** Follow the business-identity write
(`settings/use-cases/update-business-identity-names`): `identityAccess.check` (locks the company, the memberships
and the business; `identity/persistence/business-identity-access.ts`) → `findForUpdate` (creates the empty row if
absent, then `FOR UPDATE`) → `recheck` → save → audit, all in one `withTenant` transaction. *Alternative rejected:*
the rating-requests switch pattern (guard only, lock the business row). It has no re-check after the lock, so a
revocation racing a grantee's write could lose; for an owner-only-grant permission that race is the case to close.

**Decision D-B2 — no cache, no event.** The page's read goes to the database through `queries/`; the Redis settings
cache holds the generic settings read, which does not carry this field, so nothing is invalidated. No outbox event:
nothing consumes one.

**Decision D-B3 — navigation gate.** The navigation entry and the page call the guarded GET and hide on 403, as
`alert-rules-nav-item.tsx` does with the rating-settings read. *Alternative rejected:* a second `@Authenticated`
capability route like `settings/identity-capability` — one more route and query for the same answer.

## 4. Owner decisions that bind this delivery

| Id | Decision | Where recorded |
| --- | --- | --- |
| PK-Q17 / PP-16.6 | reception and readers see everything in the list and detail | spec 058 `spec.md` PK-Q17 row; `owner-questions.ar.md` §17 |
| PP-189 (45-UI-Q1…Q3) | extension reason visible to all who see the detail; Extend follows server `can_extend` | `owner-decisions.ar.md` item 109; `owner-questions.ar.md` |
| PK-Q24 (batch 46) | «مقفول لحد ما المالك يشغّله» — off by default, per business; both owners picked it | `owner-questions.ar.md` §24 |
| PK-Q26 (batch 47, final 2026-10-24) | «المالك بس من الأول، ويقدر يدّيها لأي حد (زي هوية النشاط).» — new permission, owner only, owner grants | `owner-questions.ar.md` §26 |

No new feature or business question arises from this plan. The answers above cover every rule in the spec.

## 5. Holds: what is recorded, what is historical, what is open

| Item | Status | Evidence |
| --- | --- | --- |
| **H-1. Migration card for 46-2a** — «هل توافق على تصميم migration … وبشرط إثبات نشر G وتوقف الكتّاب القدام قبل أي seed؟» | **Answer `PENDING` in the only copy found.** No entry for it in `docs/owner-decisions.ar.md` at the pin | local archive `planning-37451b2-r1/46-2a-migration-card.ar.md` (2026-11-07) |
| **H-2. "S remains unauthorized pending migration permission, authorized G deployment and U evidence"** | Manager's own gate, 2026-11-07; never recorded as lifted in the repository | `46-2a-g-manager-authorization.ar.md` (in the repository); local `g-899-merged-receipt.txt` |
| **H-3. U evidence** — proof that every running API image contains PR #899 before the seed exists | "U = UNKNOWN" on 2026-11-07; "No G deployment or old-writer drain proof" | card and `dep1-applicability-ffd3351.txt` |
| PP-124 (2026-11-05), PP-201 (2026-11-20) | The manager merges migration, money and permission PRs after the gates, without a merge card. Production, production data, server, secrets and **HOLD** stay Waleed's | `owner-decisions.ar.md` items 62, 121 |
| This task's brief: one PR for 42-4 + 46-2a-S, "explicitly requested by Waleed" | Relayed by the manager; Waleed's own words were not given to this session and are not in `owner-decisions.ar.md` at the pin | manager message, 2026-11-21 |

Reading of these facts, for the manager to confirm or correct (it is not an owner answer):

- H-1's schema half is moot: the column shipped in PR #999. Its seed half is what this delivery adds.
- The 2026-11-07 authorization covered G only. The owner authorized S development and isolated migration
  testing before U on 2026-11-21, and the manager delegated it. U still governs target migration execution.
- H-3/U proof requires deployed G or a descendant across every relevant replica, plus an inventory confirming
  old requests and writers are drained and no old image can return through scale-out or rollback. Include relevant
  reader/writer images, seed, operator, migration and restore paths. G is the rollback floor once the code is seeded.

**Dependency by stage.**

| Stage | Depends on | Blocked now? |
| --- | --- | --- |
| Implementation and local tests | Medium approved; manager delegated S and isolated local seed tests before U | Authorized |
| Opening the PR, CI, reviews | complete both authorized slices and migration-lane verification | Waits on implementation |
| Final migration numbering, `pnpm db:generate … --custom`, push of the migration | the manager's migration lane; branch up to date with `main` (`pnpm migration-chain:check`) | Waits on the lane only |
| Merge | fresh exact-head `ci-gate`, Medium reviews, independent Sol security review, migration order and parity. If merge triggers a target migration, U must precede it | Waits on applicable gates |
| Staging deploy (DEP-1) | PP-129 snapshot before migrate and H-3/U proof for all images and writer paths above | Waits on authorized rollout and U |
| Production | Waleed's own decision | Not in scope |

The admin screen can be developed independently. The owner chose a single implementation PR, so opening and
merging it waits for both slices. The approved rollout requirements govern when staging can activate the seed.

## 6. Pipeline rules checked

| Rule | Current text | Effect here |
| --- | --- | --- |
| PP-195 | Tiers and review gates | Waleed approved Medium for this delivery. Planning files are eligible for Light publication. |
| PP-195 §4 / PP-196.3 | Independent design advice | Astra 6.2 Medium completed one design round. |
| PP-198 | Medium implementer guards and different-model review | GLM runs the two guards. Sol 6.2 Medium independently reviews the whole diff and runs the security skill for permissions and migration. |
| PP-201 | Manager merges after applicable gates | Target migration waits for U. The owner authorized isolated work before U. |
| PP-204 | Fable 5.2 medium writes spec and plan and stops; the manager opens the GLM 5.3 Flash implementer in the same worktree | This session stops after these files |
| PP-192 rule 3; `CLAUDE.md` §1.1 | slices with a migration or sensitive permission stay on their spec's boundaries; one use case per PR | One PR for two rows departs from both. Source of the exception: the manager's brief. It should be recorded as an owner decision |
| PP-196.4 | every user-visible feature adds or updates its `docs/journey/` file in the same PR | Two journey files planned |
| PP-211 | PR numbers are followed by the task id | Applied in these files |

## 7. Spec-kit application

The `speckit-specify` and `speckit-plan` templates (`.specify/templates/overrides/`) were applied by hand.
`create-new-feature.ps1` and `setup-plan.ps1` were not run: they create a new numbered `docs/specs/NNN-…` folder,
and the brief requires a scoped folder inside `058-packages-sell-redeem`. `.specify/extensions.yml` does not exist
at the pin, so no hook applies. `.specify/feature.json` is untracked and was not written. `data-model.md` and
`contracts/` are not separate files: there is no new entity, and the one new contract is in the spec's Slice
design. The validation guide is [plan.md §7](plan.md#7-validation-guide).
