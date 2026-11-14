# Plan — 058 row 45, part 3 (45-ui-2): extension reason and the capability-gated «تمديد» button

Base: `origin/main` f067b04dd. Branch `feat/p1-058-45-ui-2`. Authority: PP-189 (45-UI-Q1 option 1, 45-UI-Q2 option 1, 45-UI-Q3 option 1, answered 2026-11-14). No migration. Owner-question files are not edited here (PR #1042 records the answers).

## 1. What changes

### Q1 — reason in the extension history (read-only)

- `apps/api/src/modules/orders/queries/package-entitlement-detail.query.ts`: `extensionProjection()` adds `'reason', x.reason`. JSDoc on the statement/reader updated: the history now carries the reason (PP-189, 45-UI-Q1).
- `packages/contracts/src/orders/customer-packages.ts`: `customerPackageExtension` gains `reason: z.string().optional()`. Optional, not required, for the same version-skew reason #985 round 1 gave `extensions` a default: a new admin must parse an older API. The admin hides the line when absent.
- FR-044 is unchanged: the reason stays out of audit, events and logs. The read returns it in the response body only. Nothing logs it.

### Q2 + Q3 — `can_extend` on the 42-4 package-details read

- Contract: `customerPackageDetail` gains `can_extend: z.boolean().default(false)`. Fail closed: an older API without the field hides the button.
- **Branch:** computed on the route `branchId` (the acting branch). That is the branch the POST `/businesses/:businessId/branches/:branchId/packages/:entitlementId/extensions` guards (`use-extend-package.ts` posts to `scope.branchId`). It is not `sold_branch_id`, which is nullable for imports and is not what the server checks.
- **Predicate:** mirrors `ExtendPackageUseCase` exactly: `!denied && eligible.length > 0 && feature`, from `readPackageExtensionAccess` (`extend:packages:branch`). It also mirrors `SessionAdminGuard`: when the request principal is not `kind === 'user'`, `can_extend` is `false` and the access read is skipped.
- **Adapter:** `packageExtendCapability(tx, companyId, userId, businessId, branchId, at)` in `apps/api/src/modules/orders/persistence/session-edit-access.adapter.ts`, next to `sessionCancelCapability`. It is an unlocked read (no `lockPackageExtensionAccess`), so the details screen never waits on the company row. It calls only the `identity` index (an existing arrow).
- **Port:** a detail-only `CustomerPackageDetailReads extends CustomerPackageReads` with `canExtend(tx, scope, at): Promise<boolean>`, declared in the detail query file. The list handler and its reads stay untouched.
- **Handler:** `CustomerPackageDetailQueryHandler` takes the injected `Clock` (already passed to `customerPackageProviders`) and calls `canExtend` inside its existing `withTenant` transaction, after `place` and the detail read. One transaction, no nesting, nothing concurrent added (§6 connection budget). The capability is a non-throwing boolean: a detail read never fails because of it.
- **Controller:** passes `request.principal?.kind === 'user'` to the handler.
- **Wiring:** `orders.module.ts` `customerPackageProviders` binds `canExtend` and passes `clock`.
- **Server 403:** unchanged.
- OpenAPI description of `customerPackageDetail` gains one clause: `can_extend` is a display hint for the acting branch; the POST stays authoritative.

### Admin

- `apps/admin/src/orders/ui/package-redemption-history.tsx`: the `canExtend` prop is removed (no caller passes it). The button shows only when `detail.data.can_extend` is true.
- `apps/admin/src/orders/ui/package-extension-history.tsx`: each row shows `t('packageExtension.historyRowReason')` with the reason inside `<bdi dir="auto">` when `extension.reason` is present. It is free text in either language.
- `packages/i18n/src/catalog-package-extension.ts`: `historyRowReason` in en ("Reason: {reason}") and ar ("السبب: {reason}").

### Generated (repo commands only, never edited by hand)

- `pnpm contracts:openapi` → `packages/contracts/openapi/openapi.json`.
- `pnpm --filter <app> api:generate` for admin, pos and menu `src/shared/api/schema.d.ts`, then `api:check`.

## 2. Tests

Stale "no reason" assertions shipped by #985 are flipped in the same commit (§3.1):

- `packages/contracts/src/orders/customer-packages.spec.ts` ("rejects a leaked reason"): the reason now parses; `can_extend` defaults to `false`; a non-boolean `can_extend` is rejected.
- `apps/api/src/modules/orders/__tests__/package-entitlement-detail-extensions.spec.ts` (`not.toContain(reason)`): the response now carries the reason. Result shape is asserted on the extended projection. The existing EXPLAIN assertion runs on the changed statement.
- `apps/admin/src/orders/ui/package-extension-history.spec.tsx` ("no reason or money text"): the reason is visible; the row is hidden when absent; money text is still absent.

New:

- API integration (HTTP spec on a private lane, reusing `customer-packages.fixture.ts` / `package-extension.fixture.ts` users):
  - a read-only caller (`read:service-sessions:branch`) gets `can_extend: false`;
  - an `extend:packages:branch` holder gets `true`;
  - the same holder on another branch of the business gets `false`;
  - an extend holder with `record:service-sessions:branch` and no read permission gets `true` (the reason Q3 chose option 1);
  - an explicit DENY on `extend:packages:branch` gets `false`.
- Admin component (`package-redemption-history.spec.tsx`): the «تمديد» button is visible when `can_extend` is true and absent when false. The assertions are on screen state (PP-7.2).

## 3. Sizes (hand-written lines, estimate)

| Category | Lines |
| --- | --- |
| Production: API query, handler, port, adapter, controller, wiring | ~45 |
| Production: contract, OpenAPI description, i18n | ~8 |
| Production: admin UI | ~10 |
| Tests: contract | ~15 |
| Tests: API integration (shape and capability) | ~90 |
| Tests: admin component | ~45 |
| This plan | ~75 |
| **Total** | **~290** |

Generated `openapi.json` and the three `schema.d.ts` files are excluded from the count.

## 4. Lanes (PP-186)

- **Production:** Grok CLI `grok-4.7-build-fast` first (Kimi quota is out). Then Kimi CLI `k3.1-pro`, then MiniMax-M3.1-Flash (opencode).
- **Tests:** Agy `gemini-3.8-flash-high`, falling back to Kimi or MiniMax.
- **Fence on every run:** `.env*` stashed outside the worktree; HEAD, `git stash list` and `git status --porcelain` snapshotted before and after. The brief bans git, network, `.env*`, `.git`, out-of-worktree paths, `F:\Dev\Temp`, reformatting and line-squashing.
- **Size:** a delivery over 2× its brief is refused.

## 5. Gates

- **Local:** full `pnpm typecheck`, lint, `pnpm lint:docs`, `pnpm module-map:check`, the contracts and admin specs, and the three API specs on a private lane (`node scripts/test-db/lane.mjs up <lane>` after building `@pospay/db^...`).
- **Guards:** `clean-code-guard` on production code and `test-guard` on tests before commit.
- **Done:** only when `ci-gate` is green on the exact head.
