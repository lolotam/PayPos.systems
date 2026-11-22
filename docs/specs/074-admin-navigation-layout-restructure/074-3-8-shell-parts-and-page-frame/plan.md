# Implementation plan for 074-3 + 074-8

One Medium PR, four increments reviewed in order. The owner approved 074-3 and 074-8 together. The [delivery specification](spec.md) defines the stories and requirements.

## Baseline

| Item | Value |
| --- | --- |
| Implementation base | `origin/main` at `a32a6a211b383657cd65e180cd8a2c4aa3e9e666` (PR #1176, 34-pre-2). Start from current `main` and re-read the files below before editing |
| Planning checkout | Started at `8c46615f0c893178efbc9b4b963e9d6aff18d8a0`, which is not an ancestor of `main`. Every fact below was read from the fetched `origin/main` objects, not from that checkout |
| 074-4 + 074-5 + 074-6 candidate | `d6fa408415502eeb018f419566049bc61481d33a`, branch `T3-CODE/pospay-074-4-6-navigation-components`, merge base `aa1c79569`. Read through shared git objects only; its worktree was not touched |
| Open PRs checked | #1186 (32b-2 + 32b-3). Under `apps/admin`, `packages/ui` and `packages/i18n` it changes `apps/admin/src/shared/api/schema.d.ts`, `packages/i18n/src/service-import.ts`, `packages/i18n/src/employee-import.ts` and one i18n spec. No file of this plan |

## What exists, what is new, what overlaps

| Piece | State on `main` | This PR |
| --- | --- | --- |
| `WorkspaceSwitcher`, `AccountMenu`, `NavTabs`, `Pills`, `BottomNav`, `HubCard`, `PageShell` | Absent from `packages/ui/src` and from its `index.ts` | New |
| `PageHeader` (`page-header.tsx`, 20 lines) | `title`, `description`, `action`; h1 is already 24px bold. Imported by 26 non-test files in `apps/admin` | Extend: optional further actions before the primary one; the description width cap is applied by `PageShell` to the header inside it, not by the header itself. Existing props and markup order kept |
| `DataTableFrame` (`data-table-frame.tsx`, 30 lines) | `title`, `action`, a horizontally scrolling table area. Imported by 19 non-test files | Extend: optional `filters` and `footer` areas, opt-in stacked rows. Defaults reproduce today's output |
| `Select`, `NativeSelect`, `Button`, `Badge`, `Card`, `Label`, `Separator`, `ThemeSwitch`, `DirectionProvider`, `motion.ts` | Present | Reused as they are |
| `AppSidebarDrawer` | Uses Radix Dialog from the `radix-ui` package | Not changed. New overlays use primitives of the same `radix-ui` 1.6.7 package; no file in `packages/ui/src` or `apps/admin/src` uses its popover or dropdown-menu primitive yet, so the implementer confirms the export before relying on it. No new dependency |
| `apps/admin/src/workspace/ui/workspace-selector.tsx` (three stacked selects) | Live in the sidebar header | Not changed, not replaced. `WorkspaceSwitcher` is the kit part that 074-7 feeds from `useWorkspace()` |
| `dashboard-account.tsx`, `session/ui/sign-out-button.tsx`, `session/ui/enrol-link.tsx`, the sidebar `ThemeSwitch` | Live in the sidebar footer | Not changed. `AccountMenu` takes these as supplied entries in 074-7 |
| `apps/admin/src/shared/frame/app-frame.tsx` | Pads `<main>`; no width limit | Not changed (spec requirement 5) |
| 074-4/5/6 candidate | Adds 14 production files, 10 test files, a browser fixture under `apps/pos/e2e/navigation-fixture`, a `navigation-components-browser` CI job and one 34-line block in `packages/ui/src/index.ts`. It does not change `icons.tsx`, `page-header.tsx`, `data-table-frame.tsx`, any `app-sidebar*.tsx`, `packages/ui/README.md`, `packages/ui/package.json`, `packages/i18n` or `apps/admin` | No shared file except `index.ts`. See the landing sequence |
| The candidate's `LocalNav` | Renders its own narrow link strip and "accepts the eventual Pills presentation" (its plan) | `Pills` is built here as a separate part; swapping it into `LocalNav` is 074-7's wiring, not this PR's |

Real overlap with work in flight is therefore one file: `packages/ui/src/index.ts`. A second overlap appears only if this PR adds real-browser coverage (`.github/workflows/ci.yml` and the fixture); that is manager decision 2 below.

## Landing sequence for `packages/ui/src/index.ts`

1. The candidate inserts its block between the `AppSidebarItem` line and the `PageHeader` line.
2. This PR adds one contiguous block **at the end of the file**, after the `theme.js` export, and changes no existing line. `PageHeader` and `DataTableFrame` keep their export lines; their new props travel through the already exported `PageHeaderProps` and `DataTableFrameProps`.
3. If an icon is added, its name goes inside the existing icon list at the top, not on its last line. That hunk is five lines above the candidate's and does not touch it.
4. The two changes are in separate hunks, so either PR can merge first. Check the export diff against the latest base before publishing.
5. No exported identifier may repeat one of the candidate's: `CollapsibleSidebar`, `TopNav`, `MegaMenu`, `LocalNav`, `ModuleDrawer`, `ModuleDrawerSection`, `NavRail`, `ContextPanel`, `ContextPanelBody`, `ContextPanelSection`, `ContextPanelEmpty`, `PageFinder`, `collectFinderResults`, `groupIsCurrent`, `matchesPageQuery`, `visiblePages`, and the types `ContextPanelLabels`, `FinderResult`, `NavigationChromeLabels`, `NavigationFinderLabels`, `NavigationGroup`, `NavigationModule`, `NavigationPage`, `NavigationSection`, `NavigationWorkspace`. No file is named `navigation-presentation.ts` or `__tests__/navigation-fixtures.tsx`.
6. Item shape. The candidate's page item is `{ id, label, href, count?, status? }` with plain `<a href>` links and an `onNavigate` callback; router adaptation is 074-7's. The link parts here use the same field names and the same link convention, under this PR's own type name (`ShellNavItem`, with an optional `icon`), so 074-7 can pass one object to both sets. If the candidate has merged when implementation starts, import `NavigationPage` instead of declaring a twin, after checking its shape on `main`.

## Increments

1. **Page frame parts (074-8, kit).** `PageShell` with a list width, a form width and a two-column arrangement at viewport widths of 1024px and above. A lone block occupies the main column. Extend `PageHeader` and `DataTableFrame`. Stacked rows use opt-in per-cell labels and one frame prop; callers without the prop keep their current output. A `filters` or `footer` area whose content renders nothing leaves no bordered bar (`ServiceCategoryFilter` returns `null` when the category read fails).
2. **Link parts (074-3, kit).** `NavTabs`, `Pills`, `BottomNav`, `HubCard`. Server-renderable where no state is needed. `BottomNav` takes an optional extra entry that calls back; it does not build the sheet.
3. **Overlay parts (074-3, kit).** `WorkspaceSwitcher` (one trigger showing business and branch; Company, Business and Branch through the kit's `Select`; values, options, disabled state and change callbacks supplied) and `AccountMenu` (name, email, supplied entries and slots; sign-out as a supplied callback with a pending state). Labels through one labels prop each.
4. **Reference pages (074-8, admin).** Services, Add service, Business identity. Layout only. `ServiceEditPanel` stays below the list card, unchanged. `IdentityEditor` renders the logo alone when `showNames` is false; that case must land in the main column.

**Rules that bind every increment.** `packages/ui` imports nothing from an app. No string literal reaches the user from the kit. Files stay under the lint limits (400 lines per file, 60 per function, `packages/config/eslint/index.js`), which is why the overlay parts may split into a second file each. Field components shared with the service edit panel (`service-basics-fields.tsx`, `service-attributes-fields.tsx`, `service-rule-fields.tsx`) may only gain classes that have no effect inside the edit panel, so that panel keeps its look for 074-9.

## Intended files

Paths are exact for existing files and proposed for new ones.

| Area | New | Changed |
| --- | --- | --- |
| `packages/ui/src/` | `page-shell.tsx`, `nav-tabs.tsx`, `pills.tsx`, `bottom-nav.tsx`, `hub-card.tsx`, `workspace-switcher.tsx`, `account-menu.tsx`, `shell-nav-item.ts` (the shared item type and link class; omitted if `NavigationPage` is reused) | `page-header.tsx`, `data-table-frame.tsx`, `index.ts`; `icons.tsx` only if a caret or a "more" icon is needed |
| `packages/ui/src/__tests__/` | `page-shell.spec.tsx`, `page-header.spec.tsx`, `data-table-frame.spec.tsx`, `nav-tabs.spec.tsx`, `pills.spec.tsx`, `bottom-nav.spec.tsx`, `hub-card.spec.tsx`, `workspace-switcher.spec.tsx`, `account-menu.spec.tsx` | `icons.spec.tsx` only if an icon is added |
| `packages/ui/` | | `README.md`: the stacked-row cell contract and the `PageShell` widths |
| `apps/admin/src/catalog/` | `pages/services-page.spec.tsx`, `pages/create-service-page.spec.tsx` | `pages/services-page.tsx`, `ui/services-list-panel.tsx`, `ui/services-table.tsx`, `ui/service-table-row.tsx`, `ui/service-category-filter.tsx`, `ui/services-page-navigation.tsx`, `pages/create-service-page.tsx`, `ui/service-form.tsx`; the three shared field files only under the rule above. Existing specs `ui/services-list.spec.tsx`, `ui/service-table-row.spec.tsx`, `ui/service-form.spec.tsx`, `pages/services-page-closing.spec.tsx` are adjusted only where markup moved |
| `apps/admin/src/business-identity/` | | `pages/business-identity-page.tsx`, `pages/identity-editor.tsx`, `pages/business-identity-page.spec.tsx` (one added case; the round-3 and round-5 specs must pass unedited or with selector-only edits) |
| `packages/i18n/src/` | | `catalog-services.ts`, only for a form section title with no existing key, Arabic and English together |
| `docs/journey/` | | A short bilingual note in journey 101 that three pages use the shared layout before step 7 |

Keep the candidate's fixture and CI files in its owner's scope. The component and reference-page changes do not need edits to `.github/workflows/ci.yml`, `apps/pos/**`, `apps/admin/app/(dashboard)/_frame/**`, `apps/admin/src/shared/frame/app-frame.tsx`, `apps/admin/src/workspace/**`, `apps/admin/src/session/**`, `packages/ui/src/app-sidebar*.tsx`, `packages/ui/src/styles/**`, or `packages/ui/package.json`.

## Size estimate

Added or materially rewritten lines, before implementation.

**Calibration.** The sibling plan for 074-4/5/6 forecast 875 production and 700 test lines. The candidate at `d6fa40841` measures 2,219 production and 2,545 test and fixture lines by `git diff --numstat` against `main` (plus 80 CI and 96 docs lines), about 2.5 and 3.6 times the forecast, after its correction rounds. Its 14 new production files average about 155 lines. The figures below are sized against that measurement, not against the earlier forecast; the parts here hold less focus and breakpoint logic than a mega menu or a page finder.

| Increment | Production | Test | Generated | Docs |
| --- | ---: | ---: | ---: | ---: |
| 1 Page frame parts: `page-shell` 90, `page-header` +25, `data-table-frame` +70 | 185 | 280 | 0 | 0 |
| 2 Link parts: `nav-tabs` 80, `pills` 70, `bottom-nav` 110, `hub-card` 70, `shell-nav-item` 40 | 370 | 440 | 0 | 0 |
| 3 Overlay parts: `workspace-switcher` 170, `account-menu` 150 | 320 | 330 | 0 | 0 |
| Shared: `index.ts` 20, `icons.tsx` 10 | 30 | 10 | 0 | 0 |
| 4 Reference pages: Services 110, Add service 90, Business identity 50 | 250 | 290 | 0 | 0 |
| README and journey note | 0 | 0 | 0 | 45 |
| **Total** | **1,155** | **1,350** | **0** | **45** |

Expected range: 950 to 1,400 production lines and 1,100 to 1,650 test lines. Nothing is generated: no contract, OpenAPI client, migration or snapshot changes. This spec and plan (about 190 lines) are counted apart from implementation. A delivery above twice a figure is refused under the size rule; a smaller one is welcome, with no padding.

## Verification

| Gate | Evidence |
| --- | --- |
| Unchanged callers | The frame and header specs render the pre-existing prop sets and assert today's output. Of the 26 header users and 19 frame users, only `services-page.tsx`, `business-identity-page.tsx` and `services-table.tsx` are edited |
| Parts | One rendered spec per part: current item, open and closed, disabled Business and Branch, count present and absent, Soon mark, long label, RTL and LTR, Escape and focus return for the two overlays |
| Reference pages | Rendered page specs assert the visible structure in the spec's stories and keep every existing assertion. Run the whole `catalog` and `business-identity` test folders, not only the edited files |
| Geometry, kit parts | Verify widths, stacking under 600px and 44px targets in a real browser at 390, 820 and 1280px in both directions. Record the method and evidence |
| Geometry, the three pages | No CI job renders these admin pages in a browser. `admin-document-popup` builds a synthetic admin for the document popup, and the candidate's fixture renders kit parts, not admin pages. The page-level stories are therefore a recorded manual browser review by the owning session at 390, 820, 1024 and 1280px in Arabic and English, with screenshots in the PR. Checks of every page at three widths belong to the 074-7 release in `pr-sequence.md` |
| Local gates | From the repo root: typecheck, lint (boundaries included), `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/ui test`, and the admin tests of the two touched areas. Record commands, exit codes and head. The slice is «implementation complete, pending `ci-gate`» until `ci-gate` is green on the exact head (CLAUDE.md §1 step 3) |
| Guards and review | PP-198 for the approved tier: the implementer runs `clean-code-guard` and `test-guard`; the owning session runs one whole-diff review on a different model |

## Delivery decisions

- The owner approved Medium on GLM 5.3 Flash, one PR, and the 1024px viewport breakpoint in `design.md` §6. Check the logo column at 1024px using the current Admin frame.
- Run the browser check in an isolated harness without taking ownership of the 074-4/5/6 fixture. Reuse it only if already merged and suitable. Report an actual harness limitation if it prevents measuring a required case.
- Record the visible changes in journey 101 and reconcile `pr-sequence.md` with the combined PR. 074-7 remains the separate frame release. 074-9 and 074-11 skip the three reference migrations.

## Constitution check

| Principle | Status |
| --- | --- |
| I. One slice at a time | Pass with the note the parent plan already records: 074 is delivered as component and page PRs, not one use case |
| II. Domain purity and money | Not applicable; no arithmetic |
| III. Tenant isolation | Not applicable; no data access changes |
| IV. Module boundaries | Pass; the kit imports no app, the pages stay in their own areas, no new arrow |
| V. Test-backed delivery | Pass; visible-outcome tests per part and per page |
| VI. Arabic-first, RTL, one design system | Pass; same tokens, kit components only, strings from `packages/i18n`, logical properties |
| VII. Documented why | Pass; no `domain/`, `ports/` or `events/published.ts` file is touched |

`.specify/extensions.yml` does not exist on `main`, so no spec-kit hook applies. The spec-kit scripts were not run: they create a numbered folder and a branch, and this delivery follows the sibling precedent of a subfolder under the 074 folder. `research.md`, `data-model.md`, `contracts/` and `quickstart.md` are not produced because the slice has no data, contract or unresolved technical unknown beyond the decisions listed above.
