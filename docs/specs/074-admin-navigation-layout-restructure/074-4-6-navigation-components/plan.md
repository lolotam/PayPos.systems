# Implementation plan for 074-4 + 074-5 + 074-6

One component-library PR, three independently reviewable increments. Implementer assignment is OpenCode `opencode/big-pickle`. Record the effective provider settings at launch. The [delivery specification](spec.md) defines the five acceptance stories.

## Baseline and dependencies

Remote main and local origin/main agreed at `68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51`. The planning checkout started at `8c46615f0c893178efbc9b4b963e9d6aff18d8a0`. Inspect the pinned Git objects when reproducing this plan. Start implementation from current main and reconcile overlapping public exports before editing.

| Verified input on the pinned tree | Consequence |
| --- | --- |
| Admin's `_frame/navigation-model.ts` exports NAVIGATION_GROUPINGS, pageEntryHref, resolveMenuEntryForPathname and findTopLevelGroupForPage. The 074-1/2 catalog already has localized collapse/expand, filter and finder labels. | Treat prefiltered, translated inputs as the boundary. Do not import Admin from the UI package or duplicate the route registry. Use representative fixtures in UI tests. |
| Live `_frame/dashboard-sidebar.tsx` calls AppSidebar with title, openLabel, closeLabel, header, navigation and footer. It composes WorkspaceSelector, DashboardNavigation, ThemeSwitch and sign-out. AppSidebar uses a fixed w-72 sidebar from 768px and AppSidebarDrawer below it. AppSidebarItem supports active state and slotted anchors. | Add an opt-in A presentation. Retain the old call signature, dimensions, drawer and focus behavior for existing callers. Leave the Admin frame, its guards, and all existing nav-item tests intact. |
| In packages/ui/src and its public index, the seven planned 074-3 components WorkspaceSwitcher, AccountMenu, NavTabs, Pills, BottomNav, HubCard and PageShell are absent. Existing AppSidebarDrawer uses Radix Dialog, logical placement and anchor dismissal. | No strict 074-3 prerequisite for A rail/group items, B top bar/menu/local list/drawer, or C rail/panel/finder. These can accept children or optional slots and render in isolation. Prefer existing controls and Dialog behavior. |
| A phone More and lower-level tabs, B hub cards and local tablet pills, C phone workspace tabs, shared account/workspace controls and the page frame need the corresponding 074-3 parts for final composition. | B LocalNav supplies a narrow horizontal list or accepts the eventual Pills presentation. Do not implement a standalone Pills. Test the local links now. Defer wiring actual Pills, NavTabs, BottomNav, HubCard and other 074-3 exports to 074-7. If 074-3 lands first, reuse compatible exports after checking signatures. No temporary copies, waiting on unrelated parts, or stub exports. |

The target routes/groupings come from the [Management map](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/074-admin-navigation-layout-restructure/app-map.md). Read the [prototype limitations](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/074-admin-navigation-layout-restructure/prototypes/README.md) alongside design §4 and spec FR-024. Do not port prototype HTML, hash routing, global listeners or hardcoded page arrays. The [parent sequence](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/074-admin-navigation-layout-restructure/pr-sequence.md) assigns routes, persistence and the simultaneous release separately. The combined PR changes only the packaging of steps 4–6.

## Component contracts and work order

1. **A.** Add an opt-in sidebar presentation with labeled collapse/expand, stable group links, icon, optional badge and current ID. Reuse AppSidebarGroup/Item and slotted links. Use CSS current styling that tracks resize without cached pixel offsets. Keep page children mounted. Limit the 600px and 1024px breakpoints to this presentation. On phones leave room for 074-3 BottomNav in the future frame.
2. **B.** TopNav owns open-module and drawer state independently of the current module passed by its caller. MegaMenu renders grouped links with an optional overview href. LocalNav takes the same visible links. Drawer reuses the Radix drawer behavior with 304px width capped to viewport, localized disclosure buttons and scrollable content. Close menus on navigation, Escape or breakpoint transition. No page hub, route resolver, context-strip shell or duplicated account actions.
3. **C.** Keep the selected page/workspace distinct from the workspace being inspected. ContextPanel filters only that workspace's sections. PageFinder takes the entire supplied visible list, trims the query and matches localized names with case-insensitive substring search. Use a labeled Radix Dialog with search input and real links; Enter activates the focused result or first visible match from the input. Handle empty results, updated inputs and unmount cleanup. Bind Ctrl/Cmd+K only while the component is mounted and restore focus after keyboard opening. Existing React, Radix, Input, direction and icon primitives suffice. New search library forecast is zero. If a demonstrable unmet requirement calls for one, document the failing case and options for the manager and obtain the project ADR before introducing it.

**Constitution check.** Reusable React/TypeScript presentation in packages/ui; resolved copy from packages/i18n via caller; icons follow ADR-0060. No app imports, data reads, external search, new packages, redesign, DB, API, migration, security policy or cross-project synchronization. No generation step. Router integration in 074-7 owns link adaptation and focus transfer after route navigation.

**074-7 live-host acceptance (carried forward).** ContextPanel page links stay plain, route-neutral links here: the component does not close itself on selection and leaves modified clicks (new tab, new window) to the browser. At 600–1023px the live Admin host closes the floating panel after a successful same-tab navigation, and must not move focus back to the panel opener once the destination page owns focus.

## File and size estimate

Estimated added or materially rewritten lines, before implementation. Paths below are relative to `packages/ui/src/`. Filenames for new components are proposed. Each numeric entry corresponds to the file at the same position. Counts budget distinct increment responsibilities; shared edits are counted once.

| Increment | Production file(s) | Prod | Test file(s) under __tests__ | Test | Generated | Docs |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| A | app-sidebar.tsx, app-sidebar-content.tsx, app-sidebar-item.tsx, app-sidebar-group.tsx | 70+30+40+20 | app-sidebar.spec.tsx | 110 | 0 | 0 |
| B | top-nav.tsx, mega-menu.tsx, local-nav.tsx, module-drawer.tsx, app-sidebar-drawer.tsx | 90+85+60+90+20 | top-nav.spec.tsx, module-drawer.spec.tsx | 105+85 | 0 | 0 |
| C | nav-rail.tsx, context-panel.tsx, page-finder.tsx | 65+105+150 | nav-rail.spec.tsx, context-panel.spec.tsx, page-finder.spec.tsx | 45+75+125 | 0 | 0 |
| Shared | navigation-presentation.ts (input types), index.ts (exports) | 35+15 | navigation-fixtures.tsx | 40 | 0 | 0 |
| Browser coverage (proposed test harness files; locate alongside existing browser tests at implementation) | — | 0 | navigation-components.fixture.tsx, navigation-components.browser.spec.ts | 35+80 | 0 | 0 |
| **Implementation total** | A 160, B 345, C 320, shared 50 | **875** | A 110, B 190, C 245, shared 155 | **700** | **0** | **0** |

875 production lines fall within the preliminary 750–1,100 range. Reusing a merged primitive can lower the actual count. No minimum or padding. Planning docs are separate from implementation churn; the manager can attach these two files to the same final PR and record their actual diff separately. Do not split the final PR to match the increments.

## Verification and handoff

| Gate | Evidence required |
| --- | --- |
| A regression and opt-in | Keep existing desktop and mobile AppSidebar tests; test both sides of legacy 768px, new 600/1024 transitions, current marker after collapse/resize, accessible group names and retained focus/content. |
| B | Test module current vs open, overview/page href, scrollable short-window menu, local list/strip, 699/700 and 1023/1024 transitions. From a different module at 390px, open drawer, expand group, follow named destination. Check Tab/Shift+Tab containment and Escape focus return. |
| C | Test case-insensitive English and Arabic queries in both directions, open by keyboard and touch, scope of panel vs finder, hidden panel traversal, no results, changed visibility during search, selection href, dismissal and focus restoration. Distinguish current from previewed workspace. |
| Responsive geometry | Use an isolated real-browser component fixture for 390/820/1280px, RTL/LTR, long Arabic labels and short viewport height. Measure overflow, target bounds and logical side. DOM unit tests alone cannot prove CSS geometry. Run any required Playwright evidence in CI under the repository's CI-only rule. Full dashboard rollout tests belong to 074-7. |
| Local green | Install locked dependencies with the repo toolchain. Run root pnpm typecheck, pnpm lint (includes boundaries), pnpm lint:docs, pnpm module-map:check and pnpm --filter @pospay/ui test. Run existing Admin navigation-model and sidebar-consumer tests as regression coverage. Record actual commands, exit codes and SHA. |
| Medium review and merge | Implementer runs clean-code-guard and test-guard and fixes findings; owning session on a different model runs one whole-diff /code-review. Follow Medium MergePilot rules, up to three rounds, PP-202 documented timeout exception and PP-208 optional CodeRabbit. Resolve blocking findings and preserve exact-head ci-gate, tested base freshness and coordinated order. No deploy in this assignment. |

**Approved tier.** Waleed approved Medium on 2026-11-22 for this navigation bundle and 34-pre-2: «اعتمد Medium للحزمتين (المقترح). كل حزمة في PR مستقل بعد توفر خاناتها.» The navigation bundle has one PR for 074-4, 074-5 and 074-6.

## Implementation evaluation receipt

The manager's assignment additionally specifies an independent defensive review on a named head by Codex `gpt-6.2-sol` with medium effort using waleed-security-reviewer and review-agent. Return confirmed findings to the same Big Pickle implementer for correction and tests, then recheck the affected scope on the new head as needed. The delivery session owns PR monitoring and the manager owns merge. The planning run used Codex `gpt-6.2-astra`, medium.

The owning session records estimates above before launch and actuals at first local green and at correction completion. Keep the receipt with the implementation handoff. Capture each attempt's provider, requested and actual model, variant/effort or unavailable, start/end times, failure category, retry or provider change and outcome. Report active minutes to first local green and subsequent active correction minutes separately, subtracting queue, CI, reviewer, approval and other idle waits. Preserve wait intervals so the calculation can be checked.

Record base and exact head, per-file additions/deletions by production, test/fixture, generated and documentation with per-variant totals and shared counted once. Record local and CI checks, guard and review receipts, deduplicated findings by severity P0/P1/P2/P3 and disposition, attempts and provider failures, input/output/cached tokens and cost with currency when exposed. Use “unavailable” for missing telemetry. Implementation has not started; this plan claims no measured runtime, check result or cost.
