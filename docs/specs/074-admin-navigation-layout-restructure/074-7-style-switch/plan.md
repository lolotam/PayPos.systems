# 074-7a — Implementation plan

Spec: [`spec.md`](./spec.md). Tier Medium. One PR. Cap: 4,500 added plus removed lines of code and tests.

## Constitution check

Front end only: `apps/admin` and, for missing keys, `packages/i18n`. A change to `packages/ui` is allowed only to fix a defect that blocks composition, and each one is listed in the PR. No new dependency, API, contract, migration, permission or deploy. Cross-area composition stays in `app/(dashboard)/_frame` (CLAUDE.architecture.md §11.2); nothing with business meaning goes into `src/shared` (§6.4), so the cookie helpers sit beside `src/shared/locale` and the pages sit in their business areas. One React component per file, 60 lines per function, 400 per file. Strings through `packages/i18n`; logical CSS properties only; icons per ADR-0060.

## Work order

Commit after each step, with its tests green.

1. **Read first.** `design.md` §4 to §7, `app-map.md`, `navigation-model.ts`, `navigation-rules.ts`, `nav-types.ts`, every `*-nav-item.tsx`, and the exported props of the `@pospay/ui` navigation and shell parts. Write down, at the foot of this file, which existing read backs each visibility condition and which counts are free.
2. **Cookie and provider** (`src/shared/nav-style/`): parser, server reader, client writer and clearer, `NavStyleProvider`, `useNavStyle`. Unit tests.
3. **Visibility hook** in `_frame`: one boolean per condition, plus business type, country and role. Tests reuse the permission fixtures of the nav-item specs.
4. **View model** in `_frame`: one pure builder per style over a shared visible-page filter. Table-driven tests over all live routes and all three groupings.
5. **Frames**: C first (the default), then A, then B. One rendered test file per frame. Shared account-menu and top-bar actions are built once and reused.
6. **Pages**: Appearance, Approvals inbox, Overview, Under development, each with a rendered test asserting what the user sees.
7. **Gates and guards**, then the size count.

## Size estimate

| Increment | Production | Tests |
|---|---|---|
| Cookie, parser, provider | 120 | 150 |
| Visibility hook | 180 | 220 |
| View model, three builders | 520 | 520 |
| C frame | 300 | 300 |
| A frame | 300 | 280 |
| B frame | 330 | 300 |
| Shared account menu and top-bar actions | 160 | 120 |
| Four page components | 380 | 380 |
| i18n keys | 60 | 0 |
| **Total** | **2,350** | **2,270** |

Total 4,620 is an estimate against a cap of 4,500. If the running count passes 4,000 before step 6, stop and report with the remaining work listed, instead of trimming tests or cutting a frame.

## Drift guard for 7b

Each frame's rendered test mounts it with the real `NAVIGATION_GROUPINGS`, not a hand-made subset, so 7b can mount the same component without rework. Anything a frame needs from 7b (the style value at first paint, the route for Appearance) arrives as a prop or through the provider, never by reading a route that does not exist yet.

## Local gates

`pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test`, `pnpm --filter @pospay/ui test`, `pnpm --filter @pospay/i18n test`. No Playwright locally. The slice is complete only when `ci-gate` is green on the exact head.

## Review

The implementer runs `clean-code-guard` and `test-guard` and fixes what they find (PP-198). The owning session runs one whole-diff review, then MergePilot rounds under the Medium rules, at most three.

## Overlap

- `61-2d` adds the ratings entry for admins. If it merges first, rebase and keep its entry and its permission in the model; its nav-item file is folded in 7b.
- #1206 (#1201) touches `packages/ui` focus code only and does not overlap.
- Any PR that adds an admin page before 7b still adds a `*-nav-item.tsx`; 7b folds it.

## Implementation notes

**Reads behind each visibility condition** (`_frame/menu/use-visibility-conditions.ts`; same hooks and query keys as the `*-nav-item.tsx` files, so no extra request; every guarded condition also needs a ready workspace with a selected business and a signed-in user, as the nav items do):

| Condition | Read | Open when |
|---|---|---|
| `always` | none | always |
| `alert-rules-or-rating-access` | `useAlertRules`, `useRatingSettings` | either `isSuccess` |
| `business-identity-access` | `useBusinessIdentityAccess` | `data === true` |
| `commission-plans-access` (two pages) | `usePlanAccess`, `useCommissionPlanEmployees` | employees `data !== undefined` and access not denied |
| `employee-app-link-access` | `useEmployeeAppLink` | `isSuccess` |
| `imported-refunds-access` | `useImportedRefunds` through `readAccessProof` | `'granted'` |
| `leave-report-access` | `useLeaveReportAccess` | `allowed` |
| `staff-app-columns-access` | `useStaffColumns` | not pending and not error |

**Business type, country, role.** Taken from the ready workspace (`business.business_type`, `business.country`, `company.role_code`). While the workspace is loading, or the API is an older one that omits the optional fields, they are passed as `null` (role as an empty string), which is what `isEntryShownForWorkspace` and `isSoonEntryShownForRole` already do: an entry limited to business types or countries is hidden, an unlimited entry stays, and a not-built entry is hidden except Appearance. No new rule was written. The same rules run for built and not-built entries and feed the menus and the page finder from one id list.

**Counts (FR-026).** None are shown in 7a. No existing read supplies a pending count at no extra request, so the menus carry no counts and the Approvals inbox lists kinds without numbers. Nothing in the model's `count` field is rendered except as the key that marks which pages are approval kinds.

**Open points and deviations**

1. **Cookie module location.** Built in `_frame/nav-style/`, not `src/shared/nav-style/`. `parseNavigationStyle` already does what the cookie parser needs and lives in `_frame`; `src/shared` must not import from `app/`. The server reader, the client writer and clearer, `NavStyleProvider` and `useNavStyle` sit beside it. The area pages therefore take the current style and the setter as props instead of calling `useNavStyle`.
2. **Links.** `@pospay/ui` parts render plain `<a href>` and expose no link slot. `frames/frame-chrome.tsx` is a navigation boundary that wraps every frame-owned navigation part (sidebar, top bar, rail and panel, tabs, pills, bottom bar, local list, and what they draw in portals: sheet, drawer, mega menu, finder, floating panel, account menu). Inside the boundary a plain same-tab click goes to `router.push`; modified clicks, the middle button, `target`/`download` links and other origins (compared by parsed origin, so `//host` and its backslash variant) stay with the browser. React events bubble through portals, so frame-owned portals are covered, while a link the page content draws, even in a portal of its own, is outside the boundary and untouched. No `packages/ui` link prop was added. (Round 2 replaced the earlier «not inside `<main>`» test.)
3. **Routes not built yet.** `/appearance`, `/overview/[group]` and the Authenticator link are written as hrefs in `_frame/frame-routes.ts` only. No route file exists in 7a. The Approvals address is not referenced by any frame in 7a.
4. **Pills.** `Pills` is drawn above the page content inside `<main>`. A frame cannot place it under the page's own title, which each page renders.
5. **Style A phone «More».** A modal bottom sheet: a new `BottomSheet` in `packages/ui` built on the Radix Dialog already used by `module-drawer.tsx`, no new dependency. It is labelled, holds focus, closes on Escape and the close button, and returns focus to the button that opened it (the host passes that button in `openerRef`, taken from the click event of `BottomNav`'s `extra.onPress`). It lists each other section with its sub-menus as direct links (`app-map.md`). Round 2: it also closes when the viewport leaves phone width (`frames/phone-bar.tsx`), because Radix keeps the sheet and overlay in `document.body` after CSS hides the bar.
6. **Style A column width.** The page column follows the fixed sidebar by CSS only (`group-has-[aside[data-collapsed]]:ms-20` from 1024px, `ms-20` from 600px, `ms-66` expanded), so no collapsed state is copied and `CollapsibleSidebar` got no prop. The sidebar header holds the brand only; the workspace switcher, notifications, locale switch and account menu are in the top bar.
7. **Style C panel.** Floating at 600–1023px the panel is open for one pathname only, so a same-tab navigation closes it and a modified click, which does not change the pathname, leaves it open. `ContextPanel` is not told to close on click.
8. **Account menu.** Style choice and theme are entries of the menu, and the current one is marked in the entry text. A failed sign-out shows in the sign-out entry text. Cookie clearing on sign-out and setting on sign-in are 7b.
9. **Role for the soon filter** is `company.role_code` of the selected company; a user with no ready workspace sees no not-built entry except Appearance.
10. **`packages/ui` changes.** (a) `TopNav` gains optional `localNav?: 'stacked' | 'none'` (default unchanged) and, in round 2, optional `resetKey` folded into its session key so the host can close the mega menu and drawer on a route change without remounting the bar. (b) `LocalNav` scrolls the current link into view when the active page or the visible set changes, groups pages under section headings from 1024px, and its link moved to `local-nav-link.tsx`. (c) New `BottomSheet`, with an optional `openerRef`. (d) `BottomNavExtra.onPress` now receives the click event (backward compatible). (e) `PageFinder` gains optional `resetKey` that closes it and clears its search. Tests: `top-nav-local-nav.spec.tsx`, `top-nav-reset-key.spec.tsx`, `page-finder-reset-key.spec.tsx`, `bottom-sheet.spec.tsx`; no existing ui spec changed.
11. **i18n.** Seven keys added in `ar` and `en` (`localNavigation`, `drawerTitle`, `inspectWorkspace`, `hidePanel`, `tabsLabel`, `pillsLabel`, `bottomNavLabel`).
12. **Tests mock internal hooks** (the eleven read hooks in the visibility spec; locale, workspace and session in the frame specs) instead of the API client, because the nav-item specs already cover the API shapes and the frame specs need one fixed workspace. This is a known departure from "mock only at the boundary".


## Correction round 1 (PP-228 review of head a0df5fab4)

**Visibility conditions audited against the nav items** (`menu/use-visibility-conditions.ts` vs the `*-nav-item.tsx` files; each also needs a ready workspace with a business and a signed-in user):

| Condition | Nav item rule on main | Hook now | Result |
|---|---|---|---|
| `alert-rules-or-rating-access` | hidden unless either read `isSuccess` | same | matched; React Query sets `isSuccess` false after a failed refetch |
| `business-identity-access` | hidden on `isPending`, `isError` or `data !== true` | same | **fixed**: the hook ignored `isError`, so a failed refetch kept the entry on stale `true` |
| `commission-plans-access` | hidden unless employees `data` exists and access is not denied; a failed background refetch does not hide | same | matched, deliberately keeps stale data |
| `employee-app-link-access` | `isSuccess` | same | matched |
| `imported-refunds-access` | `readAccessProof === 'granted'` (fresh read after mount) | same | matched |
| `leave-report-access` | `access.allowed` | same | matched |
| `staff-app-columns-access` | hidden while pending or on error | same | matched |

**Approvals inbox (P1-2).** The three kinds are `visible: 'always'` in the model, so the model alone cannot say who may open their pages. `src/staff/api/use-approval-kind-access.ts` probes the same list endpoints the pages read (limit 1, no polling, no new API): leave requests, attendance change requests and attendance exceptions. A kind is listed only when its probe succeeded, so loading, refused (403/404) and failed all hide it. The two attendance kinds also need a branch, taken as the workspace branch or the business's first branch like the routes do; with no branch they are absent. Every kind had a client-side read, so nothing is stopped. `useApprovalKinds` composes it for 7b. The legacy menu is untouched.

**Other changes.** Style C phone tabs open `/overview/<workspace>`. `currentPlace` resolves overview addresses the model itself generates for B and C when the group is visible. Open states that must not survive a route change (More, floating panel, previewed workspace) use `useRouteScopedState`, which resets the stored state on every committed pathname change so Back does not reopen them; the B drawer and mega menu (`TopNav`) and the C finder (`PageFinder`) are remounted by pathname key. Both panel openers (rail and toolbar) are recorded for focus return.

**Still unproven.** No real-browser layout (240px list, rail, column offset, floating panel, `group-has-[aside[data-collapsed]]`); no Playwright. The Tab trap of the sheet is the Radix Dialog behaviour checked only as wrap-around in jsdom. No built page is limited by business type today, so that rule is tested on a hand-made live entry. Remounting `TopNav` and `PageFinder` by pathname resets their focus on navigation; the page that opens next owns focus. The router adapter is tested against a mocked `router.push` that updates a fake pathname, not a real Next navigation.

## Correction round 2 (second PP-228 review of head 3c173cf56)

**Size cap.** Raised to 5,000 added plus removed lines of code and tests for 7a only, by the owner's card of 2026-11-22 («رفع السقف إلى 5,000 (Recommended)»). Nothing was added beyond the fixes below.

**Inbox proof is fresh (P1).** `use-approval-kind-access.ts` now reads with `staleTime: 0`, `refetchOnMount: 'always'` and decides with `readAccessProof(query) === 'granted'`, like the imported-refunds nav item: a kind shows only after a read that completed for the current observer. A cached success from an earlier visit shows nothing while the new read is pending and nothing if it is refused (tested with one shared `QueryClient` across two visits). **Known limitation:** a network error or a 500 also hides the kind, because only a successful read proves the permission; a user with permission who hits a network failure can therefore see the inbox's empty state until the next successful read.

**Open states and the top bar (P2).** The B bar and the C finder are no longer remounted on every route. `TopNav` and `PageFinder` take a `resetKey` that closes their open state, so moving inside one module keeps the same bar element, its scroll and its focus origin. The sheet closes on leaving phone width; the sheet returns focus to the pressed button even if the press did not move focus.

**Style A tabs (acceptance 4).** A sub-menu with a single page gets no pills, so an all-not-built tab now carries the Soon mark itself (`tabMark` in `style-views.ts`). A rendered test walks every sub-menu of style A, and every module of style B through its overview address, and checks the mark on every not-built page.

**Still unproven.** As in round 1, plus: a group of style A that has one sub-menu hides its tab row, so a lone not-built page there would carry no mark; the test found none today.
