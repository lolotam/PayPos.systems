# 074-7c — Remove the old menu files: delivery spec and plan

Parent: [`release-spec.md`](./release-spec.md) (7b, merged), [`pr-sequence.md`](../pr-sequence.md) row 7. Owner decision: PP-240 (7b releases, 7c removes the old menu files right after). Tier Medium. Estimate 1,700 added plus removed lines of code and tests (almost all removed); cap 3,400.

## What changes for a user

Nothing. After 7b the old sidebar menu is mounted nowhere. This slice deletes it and the tests that only exercised it.

## In scope

1. Delete, with their specs, every file that 7b left unmounted and that nothing imports any more:
   - `apps/admin/app/(dashboard)/_frame/*-nav-item.tsx` (all of them, including `ratings-nav-item.tsx` from #1228 and any added since) and `*-nav-item.spec.tsx`;
   - `_frame/staff-navigation.tsx` and its spec; `_frame/dashboard-navigation.tsx`; `_frame/dashboard-sidebar.tsx`; `_frame/dashboard-account.tsx` and its spec;
   - `apps/admin/src/shared/frame/app-frame.tsx` if nothing uses it;
   - session and workspace parts used only by the old sidebar (`EnrolLink`, the sidebar tone of `SignOutButton`, `WorkspaceSelector`, and the like) **only if** a search proves no other importer. `src/session/**` is an auth area: you may delete a file there that has no importer, but you may not change the behaviour of any file that stays. If removing something there needs an edit to a file that stays, leave it and list it.
2. Before deleting a spec, confirm from the table in `release-spec.md` («carried assertions») that each of its assertions has its carried test. A nav item added after that table (check `git log` for `_frame/*-nav-item*` since 7b) gets its assertions carried first, in `carried-hide-conditions.spec.tsx` / `carried-active-items.spec.tsx`, with a row added to the table.
3. The two commission page specs import `CommissionPlansNavItem` (`src/commissions/pages/__tests__/commission-plans-page.spec.tsx`, `commission-overrides-page.spec.tsx`). Rewrite only the lines that render the nav item so the tests keep proving what they proved about the page (the page hidden or shown with the access read), using the visibility hook or the mounted frame instead. Do not weaken or drop an assertion about the page; list each changed assertion with its reason.
4. `two-factor-route.tsx` repeats part of `EnrolPage` because `EnrolPage` draws the old `AppFrame`. If `EnrolPage` is now unused, delete it and its gate (`enrol-gate.tsx`) under the rule of item 1; do not merge code into session files.
5. Remove i18n keys only if the i18n test suite requires unused keys to be removed; otherwise leave the catalogs alone.
6. Docs: `pr-sequence.md` (7c done), the 7c notes at the end of this file.

## Not in this PR

Any behaviour change; any change to the three frames, the menu view model, routes or pages; `packages/ui`; any new feature, refactor or rename; any API, contract, migration, permission or dependency change.

## Acceptance

1. `rg` finds no importer of any deleted file; `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check` pass.
2. `pnpm --filter @pospay/admin test` passes; `navigation-model.spec.ts` and its route-coverage test pass; no carried test was edited except to add rows.
3. `pnpm build` in `apps/admin` passes.
4. The notes list every deleted file, every file left in place with the reason, and every changed assertion.
5. CI: `ci-gate` and `admin document popup · production browser` on the exact head.

## Plan

1. Read `release-spec.md` notes. List candidates and their importers (`rg`), and nav items added since 7b.
2. Carry any missing assertions.
3. Rewrite the two commission spec setups.
4. Delete in small commits (nav items; sidebar and navigation; frame and session leftovers), gates green after each.
5. Docs, gates, guards (`clean-code-guard`, `test-guard` as skills), size.

Stop and report if anything that stays needs a behaviour change, or if code plus tests passes 2,600.

## Implementation notes

**Carried assertions checked before any deletion.** `git log` for `_frame/*-nav-item*` since 7b shows no file added after the carried-assertion table was written; the last addition is `ratings-nav-item` (#1228), whose row the release spec carries («Integration of main after #1228»). Every spec deleted here has its row in that table, including `dashboard-account` (whose `title` assertions are recorded there as not carried on purpose). Nothing was carried afresh and no carried test was edited.

**Deleted (42 files, all by `git rm`, in four commits that each kept the gates green).**

- `dashboard-sidebar.tsx` first (the only mounted-into-nothing importer), then `dashboard-navigation.tsx`, `staff-navigation.tsx` + `staff-navigation.spec.tsx`, then the 17 `*-nav-item.tsx` and their 12 specs, then the session and workspace leftovers. The plan's order (nav items first) was inverted for one reason: `staff-navigation` and `dashboard-navigation` import the nav items, so deleting the importers first keeps `tsc --noEmit` green after every commit.
- Nav items with specs: `alert-rules`, `attendance-board`, `attendance-report`, `business-identity`, `commission-plans`, `employee-app-link`, `imported-refunds`, `leave-report`, `ratings`, `session-day`, `session`, `staff-app-columns`. Nav items with no spec (assertions carried from code in 7b): `attendance-actions`, `attendance-statement`, `catalog`, `company-employee-numbers`, `package-sale`.
- Session and workspace parts whose only importers were the deleted sidebar/enrol page (searches recorded before each deletion): `src/session/ui/enrol-link.tsx`, `src/session/ui/sign-out-button.tsx` (the whole component went, so the «sidebar tone» question disappears with it), `src/session/pages/enrol-page.tsx` + `src/session/pages/enrol-gate.tsx` (item 4 of «In scope»; neither has a spec), `src/shared/frame/app-frame.tsx` (the `apps/pos` hits in the search are pos's own file of the same relative path), `src/workspace/ui/workspace-selector.tsx` + `workspace-selector.spec.tsx`, and `src/workspace/ui/select-field.tsx` + `branch-label.tsx`, which only the deleted selector and its spec imported.

**Left in place, with the reason.**

- `_frame/two-factor-gate.tsx` and its session read — live (R2 of the 7b correction round); untouched.
- `_frame/dashboard-mocks.tsx`, `dashboard-test-support.tsx`, `bell-probe.tsx`, `passthrough-provider.tsx` — live test helpers of the frame specs.
- `src/session/pages/two-factor-page.tsx` (used by `app/login/two-factor/page.tsx`), `guest-frame.tsx` and the rest of `src/session/**` — not old-sidebar parts, importers live.
- `src/session/nav.ts` and `src/workspace/nav.ts` / `nav-types.ts` — the model's source data, consumed by `navigation-model.ts` and the frames.
- Three stale text references that the boundary rules of this slice forbid touching, left for a later docs-cleanup: the Arabic comment «كما في business-identity-nav-item» in `_frame/menu/use-visibility-conditions.ts` (menu production file), the mention of `WorkspaceSelector` in the comment of `_frame/frames/frame-workspace-switcher.tsx` (frames area), and the «(was …-nav-item.spec)» describe names in the carried specs, which are historical labels, not imports.

**i18n:** catalogs untouched — the i18n suite has no unused-key gate, so item 5's condition never fires.

**Commission page specs** (item 3). In `commission-plans-page.spec.tsx` and `commission-overrides-page.spec.tsx` the only change is the import and the two render sites each (`renderScreen` and the identity-switch rerender): `<CommissionPlansNavItem />` became `<VisibleIdsProbe />` (`_frame/menu/visible-ids-probe.tsx`), the test-only renderer of the real `useVisiblePageIds`. The probe lists the two entries as links by the same label keys and routes (`commissionPlanBuilder.navTitle` → `/commissions/plans`, `commissionOverrides.navTitle` → `/commissions/overrides`) because the model entries carry the same condition `commission-plans-access`, computed from the same query keys (`usePlanAccess`, `useCommissionPlanEmployees`) the page uses — so every existing assertion keeps its subject: the denial hidden/reshown-link assertions (`queryByRole('link', { name: …navTitle })` in CM-13, P1-1a, P1-1b, P1-2i, P1-2ii, the 503/403/404/500 shapes, and «nav and page share one access state: deny reaches the nav through the page client» with its `href` check) now assert the model-driven entry; no assertion text was changed, weakened or dropped, and the 22 tests pass.

**Carry-overs.**

1. *Not-found recovery.* `dashboard-content.tsx` now wraps the page in a `Fragment` keyed by `${companyId}:${businessId}` for the two routes that decide «not found» locally (`/approvals`, `/soon/<page>`; constant `REMOUNTS_ON_WORKSPACE_CHANGE`). The key sits in `DashboardContent` — above Next's not-found boundary in the layout's children slot — so a workspace switch remounts the boundary and the route re-decides at the same address. The doc comment states the why. Tests: `approvals-route.spec.tsx` «shows the inbox again after a workspace without it and back, at the same address» and `soon-route.spec.tsx` «shows the Under development page again after a salon without the entry and back at the same address» (new helper `enterWorkspaceAt` in `dashboard-test-support.tsx` picks a selection with distinct ids so the key really changes). Mutation check: replacing the keyed fragment with plain `children` fails exactly those two tests; the restored code passes.
2. *Empty-group redirect test.* `overview-route.spec.tsx` «sends a group with nothing visible to Home» now also asserts the visible outcome while redirecting: the loading status (`role="status"`, `admin.loading`) and no overview content (the team heading absent). No existing assertion changed.
3. *Release spec wording.* «In scope» item 3's parenthetical («the layout's `SessionGate` already does both; do not read the session twice») reworded to what shipped: the gate is the page's own server component (`_frame/two-factor-gate.tsx`) because a layout is not re-rendered on client navigation.

**Gates on head `00611580e` + docs commits** (all real runs): `tsc --noEmit` clean after every commit; `eslint .` in `apps/admin`: 0 errors, 27 warnings (all pre-existing in untouched files; the seven files this slice changed lint clean); `pnpm lint:docs` 0 errors, 30 warnings (pre-existing `TODO` notices); `pnpm module-map:check` ok; `pnpm --filter @pospay/admin test` 386 files / 3,236 tests passing (one earlier run flaked two 5-second timeouts in files this slice never touched — `frames/style-a-frame.spec.tsx` «is on every not-built page…» and `src/orders/ui/session-draft-lines.spec.tsx` «caps draft rows at twenty…»; both pass alone, and the final full run passed everything); `pnpm build` in `apps/admin` passes, every dashboard route still `ƒ` dynamic.

**Size** (`git diff --numstat origin/main...HEAD`, docs excluded): +98 −2,074 = 2,172 added plus removed lines of code and tests, against an estimate of 1,700 and the 2,600 stop threshold (spec cap 3,400). Docs: +69 −4 across the spec copy, this file's notes, `release-spec.md` item 3 and `pr-sequence.md`.

## Carry-overs from the 7b reviews (small, in scope)

These three came from the advisory bot reviews of PR #1255 after its single correction round. They are the only behaviour and test changes allowed in 7c.

1. **Not-found cannot recover at the same address.** `_frame/approvals-route.tsx` and `_frame/soon-route.tsx` call `notFound()` when the selected workspace makes the page unavailable. Next's not-found boundary resets on a pathname change only, so after switching to a workspace where the page is unavailable and back to one where it is available, the fallback stays until the next navigation. Remount the two routes when the selected company or business changes (a `key` from the workspace ids at the place the route is rendered is enough). Test for each route: available → switch workspace → not found → switch back at the same address → the page is shown again.
2. **Visible outcome in the empty-group redirect test.** `_frame/overview-route.spec.tsx:87` only checks the mocked `replace('/')`. Assert also what the user sees while redirecting: the loading status, and no overview content.
3. **Release spec wording.** `release-spec.md` «In scope» item 3 still says the layout's `SessionGate` covers the Authenticator page and the session must not be read twice. That instruction was wrong and was reversed in the correction round. Reword it to what shipped: the page has its own server-side gate because a layout is not re-rendered on client navigation. **Do not remove `_frame/two-factor-gate.tsx` or its session read in this cleanup.**
