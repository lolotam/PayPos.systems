# 074-7 — The switch: delivery spec (7a build, 7b release)

Parent: [`spec.md`](../spec.md), [`design.md`](../design.md), [`pr-sequence.md`](../pr-sequence.md) row 7, [`app-map.md`](../app-map.md). This file narrows row 7 into two PRs. Where it is silent, the parent documents decide.

## Owner decision

Row 7 is delivered as two PRs. Waleed, in the project chat, 2026-11-22, on the card «مهمة 074-7 … نسلّمها إزاي؟»: **«PR-ين: 7a ثم 7b (Recommended)»**. Caps on that card: 4,500 added plus removed lines of code and tests for 7a, and 4,500 for 7b (docs and `.github` counted separately). Tier Medium for both. The three styles still appear to users together, in 7b, so NAV-Q8 holds.

## 7a — Build, nothing visible

After 7a merges a user sees exactly what they see on `main` today: same menu, same routes, same sidebar footer. No new address answers.

In scope:

1. **Menu view model.** Pure functions that turn the navigation model (`_frame/navigation-model.ts`, `@/workspace/model/navigation-rules`) into what each style draws: A groups, tabs and pills; B modules, mega-menu columns and local list; C workspaces, panel sections and page-finder entries. Inputs: style, pathname, the set of visible page ids, the selected business's type and country, the user's role, the locale. Outputs carry resolved labels, hrefs, the current ids at each level and the Soon mark. A group, module, workspace, section or sub-menu with no visible page is absent (FR-010).
2. **Visibility resolution.** One hook that resolves every `NavigationVisibilityCondition` to a boolean using the same reads the `*-nav-item.tsx` files use today, plus the business-type, country and role rules already in `navigation-rules.ts` (`isEntryShownForWorkspace`, `isSoonEntryShownForRole`; do not redefine them). While a read is loading its pages are absent and no group flashes empty. The existing nav-item files stay untouched and live.
3. **Three frame components**, `StyleAFrame`, `StyleBFrame`, `StyleCFrame`, in `apps/admin/app/(dashboard)/_frame/`, composed only from `@pospay/ui` parts (074-3 and 074-4/5/6) at the sizes of `design.md` §4. Each takes `children` and renders the page inside. Links are Next `Link`s. Shared in all three: workspace switcher, account menu (name, Authenticator, Appearance, style choice, theme switch, sign out), notification bell, locale switch. Not mounted by any layout in 7a.
4. **Host duties carried from 074-4/5/6.** The C frame closes the floating context panel (600–1023px) after a successful same-tab navigation and does not move focus back to the opener once the destination owns focus. It passes `visiblePageIds` to `NavRail` and `ContextPanel`. Menus and drawers close on navigation.
5. **Style choice on the device.** `pospay_nav_style` cookie: a pure parser (unknown or missing value gives C), a server reader shaped like `shared/locale/request-locale.ts`, a client writer and clearer, and a `NavStyleProvider` with `useNavStyle()` whose setter updates state and cookie without a reload. Not wired into sign-in, sign-out or any layout in 7a.
6. **Page components, no route files**, each under its business area in `apps/admin/src/**`:
   - Appearance: three named cards (A — Sidebar and tabs, B — Top bar and hubs, C — Rail and panel) with the current one marked and not by colour alone, plus the theme switch.
   - Approvals inbox: the kinds of approval that exist (leave approvals, attendance requests, attendance exceptions), each linking to its page and shown only to a user who may see that page.
   - Overview: the pages of one group for the current style, drawn from the view model with `HubCard`.
   - Under development: the entry's name, one line, a way back to Home; no date, no phase number.
7. **i18n.** Any missing key is added in `ar` and `en` in `packages/i18n`. No hardcoded text.

Out of scope for 7a, all of it 7b: every `page.tsx` or `layout.tsx` change, mounting a frame, removing or editing any `*-nav-item.tsx` or `staff-navigation.tsx`, sign-in and sign-out cookie handling, moving `/security/two-factor`, removing the theme switch from the sidebar footer, redirect rules for `/overview/[group]` and `/soon/[page]`.

Counts in the menu (FR-026): shown only where a read the page already makes supplies them at no extra request. Otherwise omitted in this release, and the plan records which.

## 7b — Release

Everything else in `pr-sequence.md` row 7: the route files (`/appearance`, `/approvals`, `/overview/[group]`, `/soon/[page]`), mounting the frame by style with the server reading the cookie for first paint, folding the 16 `*-nav-item.tsx` files and `staff-navigation.tsx` into the model after their assertions are carried to model tests, sign-in and sign-out cookie handling, `/security/two-factor` inside the frame, the theme switch leaving the sidebar footer, the full rendered test list of `spec.md` «Test plan», and the browser pass of #1192 on the three reference pages. A separate brief is written after 7a merges.

## Permissions, data, API

None changed. No schema, contract, endpoint, event or audit change. Every hide-condition is carried over as it is (BR-006). The account save is step 12.

## Acceptance, 7a

1. For each style, a table-driven test over every live route: exactly one top-level entry is current, and the entry is the one `design.md` §4 «Route map» and `app-map.md` name.
2. Each frame has a rendered test that asserts the visible current item, in RTL and LTR, and that a page hidden by a condition is absent with its empty group.
3. A restaurant-only entry is absent after the selected business changes to a salon, in the menu and in the page finder, for built and not-built entries.
4. Every not-built entry renders the Soon mark with an accessible name in each style.
5. The C frame closes the floating panel after a same-tab navigation; a modified click does not close it.
6. The parser returns C for a missing, empty or unknown value; the setter writes the cookie and re-renders without a reload.
7. Appearance marks the current style and calls the setter; the inbox lists only kinds the user may see; Under development shows the entry name in both languages.
8. `navigation-model.spec.ts`, every `*-nav-item.spec.tsx` and `staff-navigation.spec.tsx` pass unchanged.
9. No colour token, font, radius or button variant differs from `main`.
