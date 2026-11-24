# 074-7b — The switch goes live: delivery spec and plan

Parent: [`spec.md`](../spec.md) (User Stories 1, 2 and 5, «Edge Cases», «Test plan»), [`design.md`](../design.md) §4 to §7, [`pr-sequence.md`](../pr-sequence.md) row 7, [`app-map.md`](../app-map.md). Built on: [`spec.md`](./spec.md) and [`plan.md`](./plan.md) of this folder (7a, what exists and its notes) and [`fix-spec.md`](./fix-spec.md) (7a-fix). Where this file is silent, those decide.

## Owner decision

Row 7's release is delivered in two PRs. Waleed, card of 2026-11-23, «074-7b (إصدار الستايلات الثلاثة) نسلّمه إزاي؟», answer verbatim **«PR-ين: 7b ثم 7c (Recommended)»**. This amends PP-224, which put the removal of the old menu files inside 7b.

- **7b (this slice):** the release itself with all its tests, including the hide-condition assertions carried over from the old menu specs. The old menu files stay in the repository, unmounted and untouched. Tier Medium. Estimate 1,900 added plus removed lines of code and tests; cap 4,500 (PP-224); fixes requested by reviews may go up to 6,750 without a new card (PP-237 as applied on this card); beyond that it returns to the owner.
- **7c (next slice, right after 7b merges):** removes the unmounted files and their specs. Estimate 1,600, cap 3,200 (PP-237).

This answer is recorded as PP-240 in `docs/owner-decisions.ar.md`.

## What changes for a user

After 7b every Admin page is drawn inside one of three frames. The default is C (rail and panel). The user picks A, B or C on the Appearance page or in the account menu, and the frame changes at once without a reload and without changing the address. A reload draws the chosen style first, with no other style shown before it. The menu names the whole Management area: built pages open, not-built entries carry the «Soon» mark and open an Under development page. Home gains a working Approvals inbox. The Authenticator page is drawn inside the frame. The theme switch leaves the sidebar footer and lives on Appearance and in the account menu (ADR-0059 addendum, NAV-Q5).

Until step 12 the choice is kept on the device for the signed-in session only: sign-out clears it and every sign-in clears it, so a user starts on C after each sign-in (NAV-Q12 accepted that saving on the account follows).

## In scope

1. **Mount by style.** `app/(dashboard)/layout.tsx` (server) reads the style with `readRequestNavStyle()` and hands it to the client shell as the initial value of `NavStyleProvider`. `DashboardFrame` draws `StyleAFrame`, `StyleBFrame` or `StyleCFrame` for the current style around the page. Kept from today's `dashboard-frame.tsx`, exactly: the session-error alert above the page, the `allowsLinkedWorkspace` rule for `/orders/customers/[id]/packages`, the `WorkspaceBody` gate around page content, and the `NotificationBell` key and props. `DashboardSidebar` is no longer mounted.
2. **Pages that need no workspace.** `/appearance` and `/security/two-factor` render for a signed-in user whose workspace is loading, empty, in error or not chosen: they bypass the `WorkspaceBody` gate (a named rule next to `allowsLinkedWorkspace`, not a second gate). The frame itself already draws with no workspace.
3. **Route files**, each a thin re-export of a `_frame/*-route.tsx` component in the existing pattern:
   - `/appearance` → `AppearancePage` with the style and setter from `useNavStyle()`.
   - `/approvals` → the approvals inbox (`menu/approvals-inbox-host.tsx` becomes or feeds the route component).
   - `/overview/[group]` → `GroupOverviewPage`.
   - `/soon/[page]` → `UnderDevelopmentPage`.
   - `/security/two-factor` moves to `app/(dashboard)/security/two-factor/page.tsx`, same address, drawn inside the frame with its account-menu entry current. Its gate is kept: an anonymous visitor is redirected to `/login` and a session read error shows the unavailable screen, as today. The gate is the page's own server component (`_frame/two-factor-gate.tsx`), because a layout is not re-rendered on client navigation, so the layout's `SessionGate` alone would not cover a client-side visit.
4. **Address rules** (the workspace and the visibility reads resolve on the client, so while they load the page shows the loading status and neither redirects nor shows not-found):
   - `/overview/<group>`: the group exists in the current style and has a page the user may see → the overview. The group belongs to another style, or the style was just switched → replace the address with the first page of that group the user may see. Unknown group, or nothing visible in it → Home.
   - `/soon/<page>`: unknown id → the app's not-found page. A built entry → forward to its real address if the user may see it, otherwise not-found. A not-built entry hidden from this business type or role → not-found. Otherwise the Under development page with the entry's name.
5. **Model.** `/appearance` and `/approvals` become `live` in the page list; `navigation-model.spec.ts` is updated for it. The shared map source `app-map.shared.mjs` is changed to match and both generated `app-map.md` outputs are regenerated by the existing script (never by hand). Report it so the manager opens the matching docs PR in `lolotam/lovable-pospay`.
6. **Device choice at sign-in and sign-out.** Sign-out clears the cookie after the server confirmed the sign-out, before leaving. Both sign-in paths (password, and the TOTP second step) clear it before entering the dashboard. `src/` may not import from `app/`: the cookie name and `clearNavStyleCookie` move beside `src/shared/locale` (for example `src/shared/nav-style/`), with no business type in that file; the writer, the provider and the server reader stay in `_frame/nav-style/` and import the name. **Auth fence:** in `src/session/**` the only change is the call that clears the cookie. Any other change to the gate, the session calls or the sign-in flow means stop and report, because it changes the tier.
7. **Carried assertions.** Before any old menu file can be removed in 7c, every hide-condition and active-item assertion of the eleven `*-nav-item.spec.tsx` files, `staff-navigation.spec.tsx` and `dashboard-account.spec.tsx` has an equivalent test against the model, the visibility hook or a frame. The five nav items with no spec (`attendance-actions`, `attendance-statement`, `catalog`, `company-employee-numbers`, `package-sale`) get their conditions from their code. The implementation notes carry a table: old assertion → new test (file and name), or «already covered by» with the test name. The old spec files are not edited and stay green.
8. **Suspense.** The frames call `useSearchParams`. The dashboard layout is dynamic (`SessionGate` reads `cookies()`), so no boundary should be needed; the CI production build is the check. If Next requires a boundary, add one whose fallback cannot show another style or an empty frame flash, and say what you did.
9. **Docs in the same PR.** `pr-sequence.md` (the 7b/7c split); ADR-0059 addendum line saying the relocation shipped; a journey file for choosing a style in `docs/journey/` in Arabic and English with the README index (PP-196.4); implementation notes in this file.

## Not in this PR

Removing or editing any `*-nav-item.tsx`, `staff-navigation.tsx`, `dashboard-navigation.tsx`, `dashboard-sidebar.tsx`, `dashboard-account.tsx`, `src/shared/frame/app-frame.tsx` or their specs (7c); the two commission page specs that import `CommissionPlansNavItem` (7c); saving the choice on the account, the delayed-save and failed-account-read tests of the parent test plan (step 12); Employee detail (10b), Schedule settings and branch pickers (11b); the Next `Link` prefetch slot (#1227, open); the offline states of the approvals inbox (#1239, open); any `packages/ui` change unless a defect blocks mounting (listed with its reason); any colour, font, radius or button-variant change; any API, contract, migration, permission or dependency change.

## Acceptance

Rendered tests assert what a user or a screen reader gets, in LTR and RTL where direction matters.

1. Default is C; a missing, empty or unknown stored value shows C; the server-rendered frame matches the stored choice (a test of the layout or shell with each initial value).
2. One test per style: the visible current item on a real route, through the mounted `DashboardFrame`.
3. Switching style from Appearance and from the account menu changes the visible frame, keeps the address, does not reload, and writes the cookie.
4. A user with no permissions, and a user with no ready workspace, can open Appearance and switch.
5. Sign-out clears the device choice only after a successful sign-out; a failed sign-out keeps it. Each sign-in path clears it before entering the dashboard; the next user starts on C.
6. `/overview/<group>` and `/soon/<page>`: every branch of rule 4 above, including the loading state, a style switch while on an overview only the old style has, a restaurant-only entry after the workspace changes to a salon (menu, page finder and direct link), and a built entry's old `/soon/...` address.
7. The Approvals inbox route lists each kind the user may see and opens its page.
8. The Authenticator page is drawn inside the frame with its entry current; the anonymous redirect and the unavailable screen still apply.
9. At 390px, style A: a page in a section behind More is reached in three taps from another section.
10. The session-error alert, the linked-workspace rule and the notification bell behave as on `main` (carry or keep their existing tests).
11. The carried-assertion table is complete (requirement 7), and every old spec still passes unchanged.
12. `navigation-model.spec.ts` passes with `/appearance` and `/approvals` live; label keys exist in `ar` and `en`.
13. `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test`, and `pnpm --filter @pospay/ui test` / `@pospay/i18n test` if touched. CI: `ci-gate`, `build` and `admin document popup · production browser` on the exact head. Read every `apps/admin/e2e/*.pw.ts` first and report any selector that depends on the old sidebar.

Tests do not import production constants to assert against them, do not name a constant «token» or «secret», keep one React component per file (helpers included) and 60 lines per function.

## Real-browser pass

Nothing built since 074-4-6 has been seen in a browser, and this PR turns it on for every user. The checks collected on issue #1192 are a release condition. They run on the first complete delivery of this branch, before the PR's bot rounds, by the owning session; the implementer does not run Playwright locally. List in your report anything you expect that pass to find.

## Plan

1. Read: this file, 7a `spec.md` and `plan.md` notes, `fix-spec.md` notes, `dashboard-frame.tsx`, `workspace-body.tsx`, the three frames, `nav-style/*`, the four page components, `use-sign-in.ts`, `use-verify-totp.ts`, `use-sign-out.ts`, `apps/admin/e2e/*.pw.ts`.
2. Cookie move and sign-in/sign-out calls, with tests.
3. Mount by style in the layout, shell and frame; the no-workspace rule; tests 1 to 4 and 10.
4. Routes and address rules; tests 6 to 8.
5. Model, map source and generated maps.
6. Carried assertions and their table.
7. Docs, gates, guards (`clean-code-guard`, `test-guard` as skills), size.

Estimate: 650 production, 1,150 tests, about 100 removed. Stop and report if code plus tests passes 3,000 before step 7.

## Implementation notes

**What was mounted, and how.** `app/(dashboard)/layout.tsx` is now an async server component: it reads the style with `readRequestNavStyle()` and passes it to `DashboardShell`, which wraps the page in `NavStyleProvider` (initial value) and `WorkspaceProvider`. `DashboardFrame` picks `StyleAFrame`, `StyleBFrame` or `StyleCFrame` from `useNavStyle()` and draws `DashboardContent` inside it. `DashboardContent` keeps, exactly: the session-error alert above the page, the `allowsLinkedWorkspace` rule and the `WorkspaceBody` gate. The `NotificationBell` key and props are the ones in `frames/frame-actions.tsx` (copied from the old frame in 7a: same `companyId:userId` key, same three props) and are now tested through the mounted frame. `DashboardSidebar` and `AppFrame` are no longer mounted by the dashboard.

**No-workspace rule.** `dashboard-content.tsx` holds two named patterns side by side: `LINKED_WORKSPACE_PAGE` (as before) and `NO_WORKSPACE_PAGE` (`/appearance` and `/security/two-factor`). A page matching `NO_WORKSPACE_PAGE` is drawn without `WorkspaceBody`; every other page is still held back (tests: loading shows the loading status, choose shows the prompt).

**Routes added** (each a one-line re-export of a `_frame/*-route.tsx`): `/appearance`, `/approvals`, `/overview/[group]`, `/soon/[page]`, and `/security/two-factor` moved to `app/(dashboard)/security/two-factor/page.tsx` (the old `app/security/two-factor/page.tsx` is deleted). The Authenticator route renders the body of `EnrolPage` (password step, QR, code) inside the frame through `TwoFactorRoute`; it does not read the session again — the session gate is the page's own server component (`_frame/two-factor-gate.tsx`), which redirects anonymous visitors and shows the unavailable screen, because a layout is not re-rendered on client navigation. `EnrolPage` could not be reused because it draws `AppFrame` and `src/session/**` is fenced, so its ~15 lines are repeated in `two-factor-route.tsx`; 7c removes `EnrolGate` and `EnrolPage` together with `AppFrame`.

**Address rules and their tests** (pure resolvers in `menu/overview-target.ts` and `menu/soon-target.ts`; rendered tests in `overview-route.spec.tsx` and `soon-route.spec.tsx`; plus `menu/address-targets.spec.ts`):

| Rule | Test |
|---|---|
| overview, group in the current style and visible: show it | overview-route.spec «shows the overview of a group that belongs to the current style» |
| overview, group of another style: replace with its first visible page | «replaces the address of a group that only another style has…»; address-targets.spec «replaces a group of another style…» |
| overview, style switched on an overview the new style lacks: replace | «follows a style switch made on an overview only the old style has» |
| overview, unknown group or nothing visible: Home | «sends an unknown group to Home…», «sends a group with nothing visible to Home» (both files) |
| overview, loading: loading status, no redirect, no not found | «waits while the workspace loads…» (the gate shows the status; the route only ever sees a ready workspace) |
| soon, unknown id: not found | soon-route.spec «shows not found for an id nobody published» |
| soon, built entry: forward if visible, else not found | «forwards the old address of the built entry…» (appearance, approvals-inbox), «forwards a built child entry to its parent list»; visibility branch in address-targets.spec |
| soon, not-built entry hidden by business type or role: not found | «shows not found for an entry the user's role was not planned for»; address-targets.spec «hides a restaurant-only entry from a salon» |
| soon, otherwise: Under development with the name | «opens the Under development page with the name of a not-built entry» |
| restaurant-only entry after the workspace becomes a salon (menu, finder, direct link) | the two tests of «a restaurant-only entry after the workspace changes to a salon» |

*Loading and conditional reads.* The route runs only when the workspace is ready (the gate covers loading). Reads behind a visibility condition are not awaited. That is safe today because (1) every built entry with an old `/soon/` address is `visible: 'always'` (test in address-targets.spec), and (2) no group of any style, for any of 14 roles, differs between «every read closed» and «every read open» (test «never loses a group of the <role>…»). If either test fails later, a loading flag is needed.

**Model.** `appearance` and `approvals-inbox` are `state: 'live'`, `visible: 'always'`, with `route` and `formerSoonId` (so `/soon/appearance` and `/soon/approvals-inbox` forward). **Audience (follow-up after review):** a live entry may now carry `roles` (optional field of `LiveNavigationPageEntry`, applied in `visiblePageIds`; absent means every role). `approvals-inbox` keeps the four manager roles the app map gave it (owner, general manager, business manager, branch manager), so becoming built does not widen who sees it; Appearance has no `roles` and stays visible to every signed-in user, with or without a workspace. A role list was chosen over a new visibility condition because the audience is fixed by the app map and needs no read (a condition would have meant three probes on every page). `/approvals` itself stays reachable by address; the page lists only the kinds the user may open. The map is unchanged (its Roles column already said managers), so it was not regenerated. Tests: `approvals-entry-roles.spec.tsx` (each style's menu, 4 managers shown and 6 other roles hidden; the page finder; the manager is found and the others are not) and three groups in `menu/visible-page-ids.spec.ts` (managers listed, others and no role hidden, Appearance listed for every role with no workspace data). Removing the role check fails 29 of them. `plannedRoute`, `PlannedStep7Route`, the `ALL_COMPANY_ROLES` list and the Appearance branch of `isSoonEntryShownForRole` were removed (nothing used them any more). `app-map.shared.mjs`: both rows' 074 state `N` to `L`; `app-map.md` regenerated with `node docs/specs/074-admin-navigation-layout-restructure/app-map.shared.mjs` (32 Live, 0 New, 96 Soon). **For the manager:** the copy in `lolotam/lovable-pospay` needs its matching docs PR (run the script with that file's path to regenerate it); that repository was not touched.

**Sign-in and sign-out.** `src/shared/nav-style/nav-style-cookie.ts` holds `NAV_STYLE_COOKIE`, `navStyleCookieAttributes` and `clearNavStyleCookie` (no business type in it). `_frame/nav-style/nav-style-cookie.ts` keeps `writeNavStyleCookie` and re-exports the name and the clearer (the 7a spec imports them from there and is unchanged). Auth fence: in `src/session/api/` only `use-sign-out.ts`, `use-sign-in.ts` and `use-verify-totp.ts` changed, one import and one call each. Tests: `src/session/api/nav-style-clear.spec.tsx` (7 tests: cleared after a confirmed sign-out, kept when it fails; cleared after password sign-in, kept at the TOTP hand-off and on a wrong password; cleared after the second factor, kept on a refused code). Mutation check: removing the clear call from sign-out fails the sign-out test.

**Carried assertions** (old files untouched and still green). 36 old `it` blocks (an `it.each` counts as one) became 56 new tests in `menu/carried-hide-conditions.spec.tsx` (31; the real read hooks behind `useVisiblePageIds`, mocked at the API client like the old specs) and `menu/carried-active-items.spec.tsx` (25). «Already covered by» is not used.

| Old spec | Old blocks | New tests (file, describe) |
|---|---|---|
| alert-rules-nav-item | 4 | hide-conditions «alerts and notifications» (4; one is `it.each` 500/403) |
| attendance-board-nav-item | 1 | active-items «marks only the attendance entry of /staff/attendance…» and the style A pill test; its address by the route coverage test of navigation-model.spec |
| attendance-report-nav-item | 1 | same for `/staff/attendance-report` (now listed under Reports › staff reports by the app map, not Attendance) |
| business-identity-nav-item | 4 | hide-conditions «business identity» (5; «loading or failed» split in two) |
| commission-plans-nav-item | 6 | hide-conditions «commission plans and overrides» (4: pending, 403 after one request, success shows both after one request — with the old spec's cache-key assertion that the successful employees page is stored under the plan-employees key for the scope, restored in 7c, no business; the old «entry» and «both links» pairs merged because one probe feeds both entries) |
| employee-app-link-nav-item | 2 | «staff app link» (2) |
| imported-refunds-nav-item | 5 | «imported refunds» (4) and «after a business switch or a refetch» (2); «pending» and «403» split |
| leave-report-nav-item | 4 | «leave history report» (4) |
| session-day-nav-item, session-nav-item | 1 + 1 | active-items «marks the day list only on its own path and the reception entry only on its own», «links the day list and the reception entry…», style A pill test |
| staff-app-columns-nav-item | 3 | «staff app columns» (3) |
| staff-navigation | 3 (one `it.each` of 5) | active-items «marks only the attendance entry of <path>…» (5), «keeps the live attendance entries adjacent…», «marks employee numbers…», «does not mark the employee list on the staff app link page» |
| dashboard-account | 1 | active-items «the account block»: name, email, `dir="ltr"`, `truncate`, no raw id. **Not carried:** the `title` attributes (the account menu in `packages/ui` draws none; it caps its width and truncates) |
| attendance-actions, attendance-statement, catalog, company-employee-numbers, package-sale (no spec) | – | conditions read from code: all unconditional (test «keeps the entries that had no read behind them visible with every read closed»); active rules for exceptions, requests, statement, report, employee numbers, the three catalog prefix rules and package sale are in active-items |

*Behaviour that changed on purpose.* The attendance report and statement used to follow the attendance entries in the flat sidebar; the owner's app map now puts them under Reports › staff reports. The board, requests and exceptions entries are adjacent in the Attendance sub-menu in the model's order (board, requests, exceptions), not the old order (board, exceptions, requests). The tests state the new placement.

**Existing assertions changed** (all in `navigation-model.spec.ts`, because the model changed): the route-coverage test no longer reads `app/security/two-factor/page.tsx` or appends `/security/two-factor` by hand (the page is now under `(dashboard)`), and ignores the two frame-owned host routes `/overview/[group]` and `/soon/[page]`; the app-map test no longer expects two «planned» entries and now expects `fresh === 0` with `appearance` and `approvals-inbox` among the live rows; the Appearance test expects a live entry visible without a workspace instead of a soon entry visible to every role. No other existing assertion changed. Test support (`frames/frame-test-support.tsx`) gained `replace`, `useParams`, `notFound` and a stable router object (production Next returns a stable router; a new object per render made an effect run twice).

**`apps/admin/e2e` (updated after review).** Every `*.pw.ts` and helper was read. The old tests found the company switch by `#workspace-company` (the old sidebar's `WorkspaceSelector`) and opened its drawer with «shell.openNavigation» below 768px. They now go through one new helper, `e2e/workspace-switcher-ui.ts`, style-independent (see the correction round, T4); it uses the switcher the three frames share:
1. Trigger: `xpath=//button[@aria-haspopup="dialog"][not(ancestor::nav)]` that has visible text, first match. The trigger has no fixed accessible name (its name is the business and branch, or «Choose a company» before a choice), so a role/name locator is not possible; Radix `Popover.Trigger` sets `aria-haspopup="dialog"`, and the only other dialog trigger in the chrome, the page finder in C, is icon-only (no text). The frame chrome comes before `main` in the page order in all three styles, so `first()` never picks a dialog button drawn by page content. In B the module buttons are excluded because they sit inside `nav`. A jsdom test (`dashboard-frame.spec` «the workspace switcher that the browser tests open», styles A, B and C) pins this contract.
2. Dialog: `getByRole('dialog', { name: t(locale, 'adminNav.workspacesLabel') })` (the popover's `aria-label`).
3. Field: `dialog.getByRole('combobox', { name: t(locale, 'admin.companyLabel') })` (a Radix Select trigger labelled by its `<label>`; the same query is used by `packages/ui/src/__tests__/workspace-switcher.spec.tsx`).
4. Choice: `root.getByRole('option', { name: companyName, exact: true })`, as before.
5. Close: `dialog.press('Escape')` then `toBeHidden()`, because the popover is modal and would block the page.
`chooseCompany` in `session-ui.ts` now delegates to it; `employee-document-popup.pw.ts` uses it in `chooseStaff` (with the locale passed, after waiting for `html[lang]`) and at the company B switch; `service-session-access.pw.ts:72` asserts `expectCompanyInSwitcher` (the company combobox shows the name) in place of `toContainText` on `#workspace-company`; the sandbox diagnostic counts dialog triggers instead of `#workspace-company`. No spec asserts anything about the old sidebar itself. Not run (Playwright is not run locally); `tsc -p tsconfig.e2e.json` and `eslint e2e` are clean. CI on the exact head is the check.

**`packages/ui`:** no change. **`packages/i18n`:** no change (every key already existed).

**Suspense.** `pnpm build` in `apps/admin` (Next 16.3.7, webpack) succeeds on this head: type check passes and every dashboard route, the five new ones included, is `ƒ` (dynamic), as expected from `SessionGate` reading cookies. No `Suspense` boundary was needed or added.

**Open points for the manager**
1. The Approvals entry's audience was settled after review: it stays limited to the four manager roles (see Model). The map's Roles column and the model now agree.
2. The Under development, Approvals and overview pages (the three pages that are new in 7a) draw plain links outside `FrameChrome`, so a click on one of their links is a full page load. This is not a change for existing pages: on `main` the pages' own links already use `next/link` where they have links (`employees-page`, `services-page`, `package-types-page` and others) and the old sidebar used `next/link`, so nothing that was soft is now hard; the new pages simply never had a soft path. Wrapping them in `FrameChrome` is a small follow-up.
3. Switching style remounts the page (the frame component type changes), so focus is lost after pressing a style card or menu item (it lands on `body`).
4. `ApprovalsInboxHost` (a 7a test helper) now duplicates `ApprovalsRoute`; it stays because its spec uses it. 7c can point the spec at the route and delete it.
5. A user with no workspace who opens the old `/soon/appearance` address sees the workspace gate message, not Appearance (only `/appearance` itself bypasses the gate).
6. The Authenticator and Appearance entries of the account menu carry the word «Current» in their text on their own page (`AccountMenuEntry` has no `current` field and `packages/ui` was not changed).

**What I expect the real-browser pass to find:** the Radix select inside the modal popover in the new e2e helper (focus and portal order); a hydration warning or a first-paint jump from the media-query hooks the frames use (the server renders the desktop layout); focus lost after a style switch (open point 3); the 240px B list and the A column offset (`group-has-[aside[data-collapsed]]`) at real widths; the C floating panel at 600 to 1023px; the Authenticator panel's width inside `main`.

**Sizes** (`git diff --numstat origin/main...HEAD`, docs excluded): 2,217 added plus removed lines of code and tests (production +317 −101 = 418; tests and test helpers +1,769 −30 = 1,799), against an estimate of 1,900 and a cap of 4,500. Docs: +141 −5. `origin/main` has moved on since the branch point (`920cbf766`); the branch was not rebased.

**Gates run on head** (see the report): typecheck (`tsc --noEmit` and the e2e project) clean; `eslint .` in `apps/admin` 0 errors; `pnpm lint:docs` 0 errors; `pnpm module-map:check` ok; `pnpm build` in `apps/admin` ok; `vitest run` in `apps/admin`: 3,091 tests, every file passes alone; a full parallel run shows 1 to 5 five-second timeouts per run in files this slice did not touch (a different set each run), none when rerun alone.


## Correction round (the one round, after the independent review and the real-browser pass of head `2298e8c87`)

**From the browser.**

| Item | Fix | Proof |
|---|---|---|
| B1 P0, style B at 390px, phone navigation button 16px under the switcher | `ModuleDrawer` trigger is `shrink-0` (`packages/ui`, defect that blocks mounting); in `style-b-frame.tsx` the TopNav cell is `min-w-[3.75rem] flex-1` and the end of the bar (`FrameBarEnd`) is `min-w-0`, so the end gives way, not the button | `module-drawer-regressions.spec` «never lets a crowded top bar shrink…» and `top-bar-layout.spec` «the phone navigation button of style B» (structure only) |
| B2 P1, top bar wider than the screen at 360 to 1100px, account trigger 16px | New `frames/frame-bar-end.tsx` shared by `FrameTopBar` (A, C) and style B: the workspace switcher is the flexible item (`min-w-0 max-w-56 flex-[1_1_10rem]`, its text truncates), the actions are one `shrink-0` group (bell, language, account menu at `size-11` plus `shrink-0`), and the end block wraps (`flex-wrap justify-end`) so the actions drop to a second line when the width is short instead of overflowing. The header got `py-2` for the wrapped case. No colour, font or radius change | `top-bar-layout.spec` (6 tests: A, B, C on a phone, structure only) |
| B3 P1, page title squeezed on phone (#1234) | `PageHeader` (`packages/ui`): the title block has a 14rem basis (`flex-[1_1_14rem]`) instead of 0, so when the actions leave it less than 14rem they wrap below it. Pages with `PageHeader` actions looked at in code: `employees-page` (two actions), `enrol-page` (the `actions` prop of `AppFrame`, not `PageHeader`); every other `PageHeader` user passes no `actions` or one `action`, which only wraps earlier when the title has under 14rem left | `page-header.spec` «keeps the title block a basis of its own…» |

**From the review.**

| Item | Result | Test |
|---|---|---|
| R1 address rules decided before the reads settled | Fixed. New `useVisibilitySettled` (`menu/use-visibility-settled.ts`, pure part `visibility-settled.ts`) is true when the workspace is not loading, the identity read has answered, and no read behind a visibility condition is still on its first answer (a success that already decides, a 403 and any other error count as answered). The two routes show the loading status until then. The query hooks moved from `use-visibility-conditions.ts` into `use-visibility-reads.ts` so both hooks share them (the 7a spec of the conditions hook is unchanged and green) | `address-reads-settled.spec.tsx`: owner on C at `/overview/setup` with the identity read late: loading, no replace, then the address ends at `/business-identity` (the old code replaced with a not-built page at once); refused read ends on a not-built page; unknown `/soon/<id>` shows loading, then not found. Mutation: forcing «settled» fails the first and third |
| R2 Authenticator gate on client navigation | Fixed. `app/(dashboard)/security/two-factor/page.tsx` re-exports `_frame/two-factor-gate.tsx`, an async server component: `readSession()`, anonymous → `redirect('/login')`, error → `SessionUnavailable`, else `TwoFactorRoute`. Only existing `src/session` exports are used; nothing under `src/session/**` changed for it | `two-factor-gate.spec.tsx` (3 tests) |
| R3 `/approvals` by address ignored the role rule | Fixed. `ApprovalsRoute` calls `notFound()` when `approvals-inbox` is not among the visible pages (same source as the menu, the finder and `/soon/approvals-inbox`); the workspace gate runs before it, so the role is known | `approvals-route.spec` «by its direct address» (4 managers open, 4 other roles get not found) |
| R4 failed sign-out not announced | Fixed. `FrameActions` owns `useSignOut()` and renders `role="alert"` with «admin.unexpected» at the end of the top bar (`basis-full`, in the wrapped end block), in every style and on the Authenticator page; the menu entry keeps its failure text; the cookie is untouched on failure | `sign-out-failure.spec.tsx` (5 tests, real hook, `session-calls` mocked) |
| R5 long name or email unreadable | Fixed in `packages/ui` `AccountMenu`: `title` on the name and the email | `account-menu.spec` «carries the full name and email as titles…» |

**Test gaps.** T1 `soon-route.spec` now asserts `replace` was called with `/orders/service-sessions` and that the address is that. T2 `nav-style-clear.spec` records the cookie inside the `loadPage` mock: it must already be cleared at the navigation (mutation: clearing after `loadPage` fails the sign-out test). T3 `carried-hide-conditions.spec` finds entries as links by name and checks `href` (the probe now renders the same name and address as the menus), and `carried-active-items.spec` has 13 name-and-href checks for the nav items' entries. T4 the e2e trigger is now `xpath=//button[@aria-haspopup="dialog"][not(ancestor::nav)]` with visible text, `first()`: it excludes the style B module buttons (inside `nav`) and the icon-only buttons, so it works in A, B and C; the jsdom contract test now runs the same predicate over the three styles.

**`packages/ui` changes in this round** (all backward compatible; ui suite green): `ModuleDrawer` trigger `shrink-0` (B1); `PageHeader` title basis (B3, #1234); `AccountMenu` `title` on name and email (R5).

**Real-browser re-check list (jsdom cannot prove layout; these are not browser-verified).**
1. Style B at 390 and 360px, `/staff`: the «Open navigation» button is 44×44 at x≈8, nothing overlaps it, a tap opens the drawer and not «Workspaces»; the switcher and the actions sit on the right and may use a second line.
2. All three styles at 360, 390, 600, 640, 700, 820, 1024 and 1100px, LTR and RTL: `document.documentElement.scrollWidth === innerWidth`; the account-menu trigger is 44×44 and fully on screen; the language button is not cut; the workspace switcher text truncates with an ellipsis; at 1024px in C the bar does not exceed the page.
3. `/staff` at 390px in A, B and C, English and Arabic: the «Employees» / «الموظفون» title is on its own full-width line with the two buttons below it (it was 52px and 42px wide).
4. Sign-out with the network blocked: an alert «Unexpected error» appears at the end of the top bar after the menu closes, in each style, and on `/security/two-factor`.
5. Account menu with a very long name and email: the text is cut and the full text shows as a tooltip.
6. `/overview/setup` in style C with the owner on a slow network: loading status, then the address ends at `/business-identity`, never `/soon/branches`; `/soon/no-such-page` shows loading and then the not-found page.
7. `/security/two-factor` after the session cookie is removed in another tab and a client-side navigation to it: redirected to sign-in.
8. `/approvals` typed by hand as a cashier: not found; as a branch manager: the inbox.

## Integration of `main` after #1228 (ratings, row 61)

**What #1228 added to navigation.** The entry `ratings-and-reviews` is now `live` (`route: '/ratings'`, `formerSoonId`, `visible: 'ratings-access'`, no role list), a new visibility condition `ratings-access` in `NavigationVisibilityCondition`, the read `useRatingsAccess` (one row, `staleTime: 0`, refetch on mount), `ratings-nav-item.tsx` with its spec, `ratings-route.tsx`, `app/(dashboard)/ratings/page.tsx`, and the `src/ratings/**` page. It also edited the generated `app-map.md` by hand (Ratings row Soon to Live) without the shared source.

**Conflict 1, `menu/use-visibility-conditions.ts`.** Kept this branch's structure (`conditionsOf` over `use-visibility-reads.ts`) and carried the new read into it: `useRatingsAccess` is a field of `VisibilityReads`, `'ratings-access': open && readAccessProof(ratings) === 'granted'` is in `conditionsOf`, and `readAccessProof(ratings) === 'pending'` is in `visibilityReadsPending`, so `useVisibilitySettled` waits for the first ratings answer (a grant, a 403 or any error counts as answered). The merged 7a spec of the conditions hook (it mocks `@/ratings/api/use-ratings-access`) passes unchanged.

**Conflict 2, `app-map.md`.** Not hand-merged. `app-map.shared.mjs` was changed so the row `Customers / Ratings and reviews` is `L` (074 state) and `app-map.md` was regenerated with the script (33 Live, 0 New, 95 Soon). **For the manager:** #1228 edited `app-map.md` only; the matching change to the shared source is in this PR, and the `lolotam/lovable-pospay` copy needs its docs PR.

**Placement.** The model puts Ratings in Customers › Customers (style A: group Customers, tab Customers, pill; B: module Grow; C: workspace Customers). `ratings-entry.spec.tsx` renders the three styles for four roles that get the read and four that do not: the entry is a link to `/ratings` with `aria-current` when granted and absent when not, and the page finder finds it only when granted.

**Carried from `ratings-nav-item.spec.tsx`** (the file itself is untouched; 7c folds it): its three blocks, four cases, are in `menu/carried-hide-conditions.spec.tsx`, describe «ratings and reviews»: link shown with name and `href` `/ratings` once the one-row list read succeeds and the call asks for `limit: 1`; hidden while pending; hidden on 403 and on 500. `/soon/ratings-and-reviews` forwards to `/ratings` only after the read is granted (`address-reads-settled.spec`), which replaces the earlier test that every aliased entry was `visible: 'always'` (no longer true, and no longer needed since the address rules wait for the reads). The earlier «no group changes between closed and open reads» test was removed for the same reason: with `ratings-access` a group can now depend on a read, which `useVisibilitySettled` handles.

| Old spec | Old blocks | New tests |
|---|---|---|
| ratings-nav-item | 3 (one `it.each` of 403 and 500) | hide-conditions «ratings and reviews» (4) |
