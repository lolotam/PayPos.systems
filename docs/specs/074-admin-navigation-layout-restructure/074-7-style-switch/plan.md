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
2. **Links.** `@pospay/ui` parts render plain `<a href>` and expose no link slot. One same-tab click adapter (`frames/frame-links.tsx`) at the frame root turns a plain click on a navigation link into `router.push`, skips modified clicks, the middle button, `target`/`download` links and anything inside `<main>`, and catches menus drawn in portals. No `packages/ui` link prop was added.
3. **Routes not built yet.** `/appearance`, `/overview/[group]` and the Authenticator link are written as hrefs in `_frame/frame-routes.ts` only. No route file exists in 7a. The Approvals address is not referenced by any frame in 7a.
4. **Pills.** `Pills` is drawn above the page content inside `<main>`. A frame cannot place it under the page's own title, which each page renders.
5. **Style A phone «More».** `@pospay/ui` exports no sheet and a new dependency is not allowed, so «More» opens a plain region above the bottom bar (`frames/more-sheet.tsx`) that lists the other sections with their sub-menus. It closes when the route changes. It is not modal and has no focus trap.
6. **Style A column width.** The page column follows the fixed sidebar by CSS only (`group-has-[aside[data-collapsed]]:ms-20` from 1024px, `ms-20` from 600px, `ms-66` expanded), so no collapsed state is copied and `CollapsibleSidebar` got no prop. The sidebar header holds the brand only; the workspace switcher, notifications, locale switch and account menu are in the top bar.
7. **Style C panel.** Floating at 600–1023px the panel is open for one pathname only, so a same-tab navigation closes it and a modified click, which does not change the pathname, leaves it open. `ContextPanel` is not told to close on click.
8. **Account menu.** Style choice and theme are entries of the menu, and the current one is marked in the entry text. A failed sign-out shows in the sign-out entry text. Cookie clearing on sign-out and setting on sign-in are 7b.
9. **Role for the soon filter** is `company.role_code` of the selected company; a user with no ready workspace sees no not-built entry except Appearance.
10. **`packages/ui` changes (pre-approved by the owning session after the browser review):** `TopNav` gains optional `localNav?: 'stacked' | 'none'` (default unchanged) so style B draws `LocalNav` beside the page; `LocalNav` scrolls the current link into view when the active page changes (guarded where `scrollIntoView` is absent). Tests: `packages/ui/src/__tests__/top-nav-local-nav.spec.tsx`. No existing ui spec changed.
11. **i18n.** Seven keys added in `ar` and `en` (`localNavigation`, `drawerTitle`, `inspectWorkspace`, `hidePanel`, `tabsLabel`, `pillsLabel`, `bottomNavLabel`).
12. **Tests mock internal hooks** (the eleven read hooks in the visibility spec; locale, workspace and session in the frame specs) instead of the API client, because the nav-item specs already cover the API shapes and the frame specs need one fixed workspace. This is a known departure from "mock only at the boundary".
