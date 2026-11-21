# 074 — Admin navigation: three switchable styles

**Status:** design reference for `spec.md` (the spec-kit specification in this folder). The owner decided on 2026-11-21 to ship all three navigation styles and let every user switch between them (`owner-questions.ar.md`, NAV-Q1, NAV-Q6 to NAV-Q8).
**Scope of this spec:** `apps/admin` and `packages/ui`, plus one small account preference (§9). The cashier app `apps/pos` is in the owner's scope (NAV-Q3) but is not specified here: see §10.
**Base:** `origin/main` at `cf70114e2`. The page list below was re-read at that commit.

## 1. Problem

The admin sidebar renders its links as one unlabelled group (`apps/admin/app/(dashboard)/_frame/dashboard-navigation.tsx`). On `cf70114e2` that is about 25 sibling links (23 counted on `e0e0e642e`, plus the two commission links added since).

- The order has no logic: Leave approvals, Weekly schedules, then Home.
- A few icons are reused across most items, so the icon does not tell items apart.
- The sidebar cannot collapse. At 768px and above it always takes 288px.
- List pages have no maximum width; create and edit pages are capped at 576px. Section gaps mix 24, 32 and 48px.
- Editing an employee opens an inline card under the table. It has two tabs (Details, Leave), but the Details tab stacks six unrelated sections: the edit form, salary, bank account, working hours, attendance card and documents (`apps/admin/src/staff/ui/employee-edit-panel.tsx`).
- The same thing is reachable from several places: employee leave (3 places), employee number editing (3), staff app link (2), branch choice (sidebar plus a second picker on 8 pages).

Two defects found while mapping, to fix in the same work:

1. `/staff-app-columns` highlights **Employees**, because the Employees item is active for every path that starts with `/staff`.
2. The Reload button on Weekly schedules uses the key `staff.reload` and reads "Reload employee".

## 2. Fixed by the owner

- Colours, fonts, corner radius and button styles stay exactly as they are (Souk Tiles, `packages/ui/src/styles/theme.css`, `button.tsx`). All three styles share them (NAV-Q7).
- Menus may be merged, split into tabs or given submenus.
- Desktop, tablet and phone are designed together from the start.
- Arabic and English, RTL and LTR.
- Every existing page keeps working. Nothing is removed.
- **All three styles ship, listed by name in Settings.** Any signed-in user switches at any time and the whole frame changes at once. No permission is needed. **The default is C** (NAV-Q1).
- **The choice is saved on the user's account**, so it follows them to another device (NAV-Q6).
- **The three styles are released together**, not one first (NAV-Q8).

## 3. Target grouping

> Extended on 2026-11-21 by `app-map.md`, the one map shared with `lolotam/lovable-pospay` (NAV-Q17), which lists the whole product including pages not built yet and regroups the top level (seven sections). Where this section or §4 differs from `app-map.md`, `app-map.md` wins. The sizes in §4 and the layout rules in §6 are unchanged.

All three styles sort the same navigation-reachable pages into the same families: the 26 mapped on `e0e0e642e`, the two commission pages added since, and the new Appearance page, plus four child pages. They differ in how many levels there are and where each level lives.

| Family | Pages |
|---|---|
| Home | Workspace |
| Sales | Record a visit, Day list, Sell a package |
| Catalog | Services (+ Add service), Categories, Package types (+ Add package type) |
| Team | Employees (+ Create, + Employee detail), Employee numbers, Import employees, Document types |
| Pay | Commission plans, Commission overrides |
| Schedules | Weekly schedules, Schedule settings (split out of the top of Weekly schedules) |
| Attendance | Board, Requests, Exceptions, Monthly report, Statement |
| Leave | Leave approvals, Leave history report |
| Setup | Business identity, Permissions, Alerts, Staff app link, Staff app columns, Authenticator, **Appearance (new)** |

The two commission pages were added to `main` after the prototypes were built, so the prototypes do not show the Pay family.

## 4. The three styles

Prototypes: `prototypes/pospay-nav-a.html`, `-b.html`, `-c.html` (built by `prototypes/build.mjs` from `prototypes/src`).

### A — Sidebar and tabs

- **Level 1:** 6 sidebar entries: Home, Sales, Catalog, Team, Attendance & leave, Setup.
- **Level 2:** a tab row under the top bar.
- **Level 3:** pills under the page title (Employees: List / Numbers / Import / Document types; Reports: Monthly / Statement / Leave history; Staff app: Link / Columns; Pay: Plans / Overrides).
- Closest to today's frame.

### B — Top bar and hubs

- **Level 1:** 6 top-bar modules grouped by task: Today, Sell, Approvals, People, Catalog, Setup.
- **Approvals** (superseded on 2026-11-21 by NAV-Q17: approvals are an inbox under Home in every style, see `app-map.md`) grouped three existing pages (Leave approvals, Attendance requests, Attendance exceptions) under one module with one count. The pages themselves are not merged.
- **Level 2:** a mega menu per module, plus an overview page per module.
- **Inside a module:** a 240px local list beside the page; a pill strip under 1024px.
- No sidebar. The page gets the full width.

### C — Rail and panel (default)

- **Level 1:** 4 workspaces on an 84px icon rail: Front desk, Team, Catalog, Business.
- **Level 2:** a 272px panel listing the workspace's pages under section labels, with a filter field. The panel can be hidden.
- **Page finder** (Ctrl+K) reaches every page by name.
- **Phones:** each workspace opens an index page; pages drill in with a back button.

### Sizes

| Part | A | B | C |
|---|---|---|---|
| Primary nav, ≥1024px | sidebar 264px, collapses to 80px | top bar 64px | rail 84px |
| Secondary nav, ≥1024px | tab row 48px | context strip 56px + local list 240px | panel 272px, hideable |
| Tablet | 600–1023px: rail 80px + tab row | 700–1023px: top bar + pill strip | 600–1023px: rail 84px, panel floats over the page |
| Phone | <600px: top bar 56px + tab row + bottom bar 64px (4 + More; the More sheet lists the other sections with their sub-menus) | <700px: top bar 56px + drawer 304px with accordions; no bottom bar | <600px: context bar 56px with the page finder + bottom tabs 64px (the five workspaces of `app-map.md`) |
| Nav item height | 48px (rail 60px) | 44px | 44px |
| Top-level entries | 6 | 6 | 4 |
| Levels | 3 | 3 (menu, list, page) | 2 + page finder |

### Route map

| Current route | A | B | C |
|---|---|---|---|
| `/` | Home | Today | Front desk › Now |
| `/orders/service-sessions/new` | Sales › Record a visit | Sell › Record | Front desk › Now |
| `/orders/service-sessions` | Sales › Day list | Sell › Review | Front desk › Now |
| `/orders/package-sales/new` | Sales › Sell a package | Sell › Record | Front desk › Now |
| `/catalog`, `/catalog/create` | Catalog › Services | Catalog › Menu | Catalog › Menu |
| `/catalog/categories` | Catalog › Categories | Catalog › Menu | Catalog › Menu |
| `/catalog/package-types`, `…/create` | Catalog › Package types | Catalog › Menu | Catalog › Packages |
| `/staff`, `/staff/create`, employee detail | Team › Employees › List | People › Team | Team › People |
| `/staff/employee-numbers` | Team › Employees › Numbers | People › Team | Team › People |
| `/staff/import` | Team › Employees › Import | People › Team | Team › People |
| `/staff/document-types` | Team › Employees › Document types | People › Team | Team › People |
| `/staff/[employeeId]/leave` | Employee detail › Leave tab | same | same |
| `/commissions/plans` | Team › Pay › Plans | People › Pay | Team › Pay |
| `/commissions/overrides` | Team › Pay › Overrides | People › Pay | Team › Pay |
| `/schedules` | Team › Schedules › Week | People › Time | Team › Planning |
| `/schedules` settings block | Team › Schedules › Shift limits | Setup › Business | Team › Planning |
| `/staff/attendance` | Attendance & leave › Board | People › Time | Front desk › Attendance today |
| `/staff/attendance-requests` | Attendance & leave › Requests | Approvals | Front desk › Attendance today |
| `/staff/attendance-exceptions` | Attendance & leave › Exceptions | Approvals | Front desk › Attendance today |
| `/leave` | Attendance & leave › Leave approvals | Approvals | Front desk › Leave |
| `/staff/attendance-report` | Attendance & leave › Reports | People › Reports | Team › Reports |
| `/staff/attendance-statement` | Attendance & leave › Reports | People › Reports | Team › Reports |
| `/staff/leave-history` | Attendance & leave › Reports | People › Reports | Team › Reports |
| `/business-identity` | Setup › Identity | Setup › Business | Business › Business |
| `/alert-rules` | Setup › Alerts | Setup › Business | Business › Business |
| `/permissions` | Setup › Permissions | Setup › Access | Business › Access |
| `/security/two-factor` | Setup › Sign-in security | Setup › Access | Business › Access |
| `/staff/employee-app-link` | Setup › Staff app › Link | Setup › Staff app | Business › Staff app |
| `/staff-app-columns` | Setup › Staff app › Columns | Setup › Staff app | Business › Staff app |
| `/appearance` (new) | Setup › Appearance | Setup › Access | Business › Access |

Existing URLs do not change in any style. New routes:

- **Appearance** (`/appearance`): the style and theme choice.
- **Approvals inbox** (`/approvals`): one page under Home listing the kinds of approval that exist, each linking to its existing page (NAV-Q17).
- **Under development** (`/soon/[page]`): one shared page opened by every entry that is not built yet (`app-map.md`).
- **Schedule settings** (today a block at the top of `/schedules`) and **Employee detail** (today an inline card on `/staff`).
- **Overview pages** that only styles B and C use (one per module or workspace). They live under one route, `/overview/[group]`, and are drawn from the navigation model. If the group id is not part of the user's current style (an old link, or the style was switched while on that page), the user is taken to the first page of that group they are allowed to see. An unknown group, or one with no page the user may see, goes to Home.

A URL opened under any style shows the same page. Only the frame around it differs.

## 5. Switching styles

- **Where:** the Appearance page, and the same control in the account menu. Three cards named **A — Sidebar and tabs**, **B — Top bar and hubs**, **C — Rail and panel**, each with a small diagram and one line of description. The current one is marked.
- **Who:** every signed-in admin user. No permission string guards the page or the control.
- **Effect:** choosing a card swaps the frame at once, on the same route, with no full page reload. The page inside the frame may be drawn again, so unsaved input on it is not guaranteed to survive; the Appearance page itself holds no other input.
- **Default:** C, for a user who has never chosen.
- **First paint:** the server reads a `pospay_nav_style` cookie, the same way it reads `pospay_locale` (`apps/admin/src/shared/locale/request-locale.ts`), and renders the right frame. No flash of another style.
- **Shared browsers:** the cookie belongs to the browser, not the person. Signing out clears it, so the next person to sign in on that browser starts from their own saved choice, or from C if they have none.
- **Account:** the choice is also written to the account (§9). On sign-in the account value overwrites the cookie. If the account write fails, the frame still changes, the cookie keeps the choice on this device, and the user sees a message that it was not saved to the account. Saves from one tab are sent one at a time and a waiting save is replaced by the newest choice, so an older choice can never land after a newer one.
- **Other tabs:** a tab that is already open keeps its frame until its next navigation or reload.
- **Theme:** the light, dark and system switch sits on the Appearance page and in the account menu in all three styles, and leaves the sidebar footer (NAV-Q5, answered 2026-11-21). ADR-0059 placed it in the sidebar footer, so an addendum records the move.

One navigation model feeds all three frames: a typed list of pages (label key, route, icon, the condition that shows it, count source) and three groupings of those pages. Each business area exports its own pages; the model is composed in `app/(dashboard)/_frame`, where cross-area composition belongs (CLAUDE.architecture.md §11.2). It does not go in `src/shared`, which must hold nothing with business meaning (§6.4). A page added later is added once and must be placed in all three groupings; a test fails otherwise (§8).

## 6. Page layout rules (all styles)

Numbers come from the existing components, tightened into one rule each.

- **Spacing:** 4px unit. Page padding 24px (16px under 768px). Gap between page sections 24px (16px under 768px). Card padding 24px (16px under 768px).
- **Width:** list and board pages max 1200px. Form-only pages max 840px. Both centred.
- **Page header:** h1 24px, one-line description capped at 65 characters, one primary action at the inline end. Further actions are outline buttons before it.
- **Templates:**
  - *List:* header → one card holding filter bar, table, footer with paging.
  - *Form:* header → one card of titled sections on a 12-column grid (fields span 6, short fields 4, long fields 12) → action bar at the card foot, primary last.
  - *Detail:* header → in-page tabs → the tab's cards. The employee card becomes this: Details, Pay, Hours and card, Documents, Leave.
  - *Two-column:* main 2fr + side 1fr from 1024px, stacked below. Used by Record a visit (form + sticky draft summary), Business identity, Permissions.
  - *Board:* header → status columns → table.
- **Tables under 600px:** each row becomes a stacked card. First column is the card title; other cells show their column label above the value.
- **Controls:** buttons 48px (`sm` 44px in tables and toolbars), inputs 48px, nav items ≥44px. Unchanged from `packages/ui`.
- **Workspace selector:** one button showing business and branch, opening Company / Business / Branch. Replaces the three stacked selects.
- **Account menu:** name, Authenticator, Appearance and Sign out.
- **Counts:** pages that hold pending decisions show a count in the navigation.

The page templates do not depend on the style. A page is laid out once.

## 7. Motion and RTL

- Durations from `packages/ui/src/motion.ts`: 200ms in, 150ms out. One easing.
- Animated: active-item indicator, tab underline, menu / drawer / sheet open, page content entering (8px rise). Switching style is not animated.
- `prefers-reduced-motion` turns all of it off.
- Logical properties only (CLAUDE.md §7).
- Mirrored icons: chevrons, back, sign-out, panel toggle. Not mirrored: clock, check, search, numbers.
- Numbers, times and KWD amounts stay LTR inside RTL text.
- Drawers and the rail sit at the inline start: right in Arabic, left in English.

## 8. Acceptance criteria

Each holds in every style unless it names one.

1. Every route in §4's route map is reachable in at most 3 clicks from any page.
2. Exactly one top-level entry is marked current on every route, including `/staff-app-columns` and `/security/two-factor` (which sits outside the `(dashboard)` route group today).
3. Every page of the navigation model appears exactly once in each of the three groupings. A test enforces it, so a new page cannot be added to one style only.
4. At 1280, 820 and 390px wide, no page scrolls sideways; only tables scroll inside their own frame.
5. Every interactive target is at least 44px.
6. Arabic and English both pass 1 to 5.
7. A user with no saved choice sees style C.
8. Choosing a style on the Appearance page changes the frame without a full page reload; the route stays the same.
9. After a reload, and after signing in on another browser, the user sees the style they chose.
10. The first server-rendered frame matches the saved style.
11. A user with no permissions beyond signing in can open Appearance and change the style.
11a. After one user signs out, a second user who signs in on the same browser and has no saved choice sees style C.
12. No colour token, font or button variant differs from `main`.
13. All visible strings come from `packages/i18n`.

## 9. Slice design

This file is the hand-written design reference. The specification itself, `spec.md`, was created with `/speckit-specify` on 2026-11-21 and planned with `/speckit-plan`; where the two differ, `spec.md` wins.

**Front end (most of the work).** No schema, contract, permission or event change. Every condition that hides a nav item today moves into the navigation model as-is.

**Account preference (one small back-end slice).** Saving the choice on the account needs storage and an endpoint. This is the only part with a migration.

- **Data:** one value per user: `nav_style`, one of `A`, `B`, `C`; absent means the default.
- **Where it lives:** a column on `user` (NAV-Q10, answered 2026-11-21). The reasoning that led there: No user preference is stored on the server today: the `user` table has no locale or theme column (`packages/db/schema/identity-auth.ts`), the theme is kept in `localStorage` and the locale in a cookie. A row per membership would make the choice differ per company, which contradicts NAV-Q6. Two shapes fit:
  - **A column on `user`**, reached only through `packages/auth` on the `pospay_auth` role, with an ADR-0003 addendum. No new grant, policy or isolation test. Recommended.
  - **A new table keyed on the user**, read and written through `withUser`, which needs its own policies and a negative isolation test (CLAUDE.md §5).
- **API:** `GET` and `PUT /v1/me/preferences`, session-only (`@Authenticated()`), personal to the caller. The write declares where its check lives (PP-7.1). No `Idempotency-Key`: no money or stock effect.
- **Contract:** a Zod schema in `packages/contracts`.
- **Events:** none. **Audit:** none. The owner approved a recorded exception to CLAUDE.md §8 for a user changing their own navigation style (NAV-Q16, answered 2026-11-21); it is written into CLAUDE.md §8 in step 0b.
- **Tests:** integration tests for read, write and the default; a test that one user cannot read or write another user's preference.

Navigation counts (pending leave, attendance requests, open exceptions) are shown in the prototypes as examples. Whether the existing list endpoints can supply them cheaply is not verified; if not, counts are dropped from the first release rather than adding an endpoint here.

**Test plan, front end:** per PR in `plan.md`. Table-driven over the three groupings: every route appears exactly once, and exactly one top-level entry is current on every route. One rendered test per style that asserts the visible current item. One switch test (the visible frame changes, the cookie is written), one default-C test, and a check that every label key in the model exists in both languages. Page tests do not depend on the style.

## 10. The cashier app

The owner chose "admin and cashier" (NAV-Q3). `apps/pos` has no navigation menu today: its screens change by state (`apps/pos/src/app`). Its people sign in with staff sessions bound to a device (ADR-0019, ADR-0027), which are not admin user accounts, and it is local-first. So three styles for the cashier app need their own page inventory, their own prototypes and an answer to where a staff member's choice is stored. An employee only may be linked to a user account, so "saved on the account" has no settled meaning for PIN and OTP staff yet. That is a separate spec, `TODO(spec)`, opened after this one is agreed (NAV-Q3, NAV-Q11). Nothing in this spec changes `apps/pos`.

## 11. Open questions

Recorded in `owner-questions.ar.md`. None is open. Answered on 2026-11-21: NAV-Q4 (each project keeps its `--primary` value), NAV-Q11 (a cashier's style is kept on the device, one value per employee), NAV-Q2 (`lovable-pospay` has its own spec in its own repository), NAV-Q5 (one place for the theme switch in all three styles), NAV-Q9 (the owner alone), NAV-Q10 (a column on `user`), NAV-Q12 (styles first, account saving follows), NAV-Q14 (not-built entries by business type and role), NAV-Q15 (social media management listed as Soon), NAV-Q16 (no audit entry; recorded exception).

## 12. Decisions this spec sits under

- ADR-0059 (Souk Tiles tokens and theme switch placement) and ADR-0060 (icons). ADR-0059 needs an addendum for §5.
- ADR-0003 (identity tables) for §9.
- PP-193.1 / PP-193.2 (look-and-shape decisions, `docs/owner-decisions.ar.md`). The 2026-11-21 answer replaces "one sidebar" with "the user chooses"; it needs its own PP entry.
- A `docs/journey/` step is owed with the first PR (PP-196.4). Not written yet.

## 13. Research

Practitioner guidance, not formal studies: sidebars suit many sections and deep hierarchy, top bars suit three to six areas; tabs suit a few long sections, accordions suit many short ones and phones; avoid nested tabs; navigation bar on compact widths, rail on medium and wider; mirror directional icons in RTL but not media, checks or numbers; keep the selected master item marked in list-detail layouts.

- https://www.nngroup.com/videos/tabs-vs-accordions/
- https://www.nngroup.com/articles/tabs-used-right/
- https://developer.android.com/develop/adaptive-apps/guides/build-adaptive-navigation
- https://developer.android.com/design/ui/large-screens
- https://m2.material.io/go/design-bidirectionality
- https://firefox-source-docs.mozilla.org/code-quality/coding-style/rtl_guidelines.html
- https://design.workday.com/globalization/rtl-and-bidi
