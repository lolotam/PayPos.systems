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

*(filled by the implementer)*

## Carry-overs from the 7b reviews (small, in scope)

These three came from the advisory bot reviews of PR #1255 after its single correction round. They are the only behaviour and test changes allowed in 7c.

1. **Not-found cannot recover at the same address.** `_frame/approvals-route.tsx` and `_frame/soon-route.tsx` call `notFound()` when the selected workspace makes the page unavailable. Next's not-found boundary resets on a pathname change only, so after switching to a workspace where the page is unavailable and back to one where it is available, the fallback stays until the next navigation. Remount the two routes when the selected company or business changes (a `key` from the workspace ids at the place the route is rendered is enough). Test for each route: available → switch workspace → not found → switch back at the same address → the page is shown again.
2. **Visible outcome in the empty-group redirect test.** `_frame/overview-route.spec.tsx:87` only checks the mocked `replace('/')`. Assert also what the user sees while redirecting: the loading status, and no overview content.
3. **Release spec wording.** `release-spec.md` «In scope» item 3 still says the layout's `SessionGate` covers the Authenticator page and the session must not be read twice. That instruction was wrong and was reversed in the correction round. Reword it to what shipped: the page has its own server-side gate because a layout is not re-rendered on client navigation. **Do not remove `_frame/two-factor-gate.tsx` or its session read in this cleanup.**
