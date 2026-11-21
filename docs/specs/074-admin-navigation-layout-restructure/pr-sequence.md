# 074 — PR sequence

Builds the three switchable navigation styles of `spec.md` and `design.md` in `apps/admin` and `packages/ui`. Each step is one PR. Local gate per CLAUDE.md §1 step 3; a step is done only when `ci-gate` is green on its exact head.

Under PP-204 this session writes the spec and plan only. The manager opens an implementer session per step.

## Tiers (PP-195)

The manager sends the tier card per task; these are the recommendations.

| Steps | Tier | Why |
|---|---|---|
| 0 | Light | Docs only |
| 1 to 11 | Medium | Front end only, no money, permission, DB or API change, but each is over 150 lines |
| 12 | Heavy | A migration and a new endpoint. Merge authority: the CLAUDE.md header (PP-195) asks for Waleed's card on a migration PR; PP-201 in `docs/owner-decisions.ar.md` (item 121) gives the manager the merge for Heavy PRs too. The manager states which applies |

## Order

| # | PR | Touches | Done when |
|---|---|---|---|
| 0 | Spec, plan, decisions | This folder; `docs/owner-decisions.ar.md` (new PP entry for the 2026-11-21 answer); ADR-0059 addendum (theme switch on the Appearance page); ADR-0003 addendum (the `nav_style` column on `user`); `docs/journey/` step (PP-196.4) | Merged to `main` so implementer sessions start from it. Before the PR: run `pnpm lint:docs` and `pnpm format:check`; neither has been run on this folder, and `prototypes/` holds dense generated HTML, JS and CSS that the formatter may reject. If it does, exclude or drop the built `.html` files rather than reformatting them by hand |
| 1 | Navigation model | A page export per business area under `apps/admin/src/<area>/`, composed in `apps/admin/app/(dashboard)/_frame/navigation-model.ts` (new), and its spec (CLAUDE.architecture.md §6.4, §11.2) | One typed page list (label key, route, icon, show condition, count source, state `live` or `soon`, section and sub-menu) holding every page of `app-map.md`, and three groupings, A, B and C. Tests: every `page.tsx` under `(dashboard)` plus `/security/two-factor` is in the page list; every page appears exactly once in each grouping |
| 2 | i18n keys | `packages/i18n` | Group, tab, section, style-name and Appearance labels in ar and en, the names of every section, sub-menu and page of `app-map.md`, the "Soon" mark and the Under development page text. `schedules.reload` added; `staff.reload` no longer used on Schedules |
| 3 | Shared shell parts | `packages/ui`: `WorkspaceSwitcher`, `AccountMenu`, `NavTabs`, `Pills`, `BottomNav`, `HubCard`, `PageShell` | Component specs assert visible state: current item, open, RTL side |
| 4 | Style A parts | `packages/ui`: `AppSidebar` gains a collapsed rail state and group items | Specs: collapsed, expanded, current group |
| 5 | Style B parts | `packages/ui`: `TopNav` with `MegaMenu`, `LocalNav`, drawer with accordion groups | Specs: menu open and closed, current module, drawer on phone width |
| 6 | Style C parts | `packages/ui`: `NavRail`, `ContextPanel`, `PageFinder` | Specs: current workspace, panel hidden, finder filters and opens a page. If the finder needs a new library, an ADR comes first (CLAUDE.md §11) |
| 7 | **The switch: three frames go live together** | `apps/admin/app/(dashboard)/_frame` (`dashboard-frame.tsx`, `dashboard-sidebar.tsx`, `dashboard-navigation.tsx`, the 15 `*-nav-item.tsx` files fold into the model), `apps/admin/src/shared/frame/app-frame.tsx`, a `pospay_nav_style` cookie reader and writer beside `src/shared/locale`, new routes `/appearance`, `/overview/[group]` and `/soon/[page]` (the shared Under development page) | Default is C. Every section and sub-menu of `app-map.md` is in the menu; not-built entries carry the "Soon" mark and open the Under development page. The Appearance page and the account menu switch style with no reload. The server renders the saved style on first paint. Active-item test covers every route in all three styles, including `/staff-app-columns`. One rendered test per style asserts the visible current item. Label keys exist in ar and en. A user with no permissions can switch. Sign-out clears the cookie, and both sign-in paths set or clear it before entering the dashboard. `/security/two-factor` sits outside `(dashboard)` and draws only its enrol gate today: this step brings it inside the frame, keeping its address and its gate, with a rendered test. Schedule settings and Employee detail have no routes until steps 10 and 11, so their entries point to `/schedules` and `/staff`. NAV-Q14 (who sees Soon entries) is answered before this step is approved, and the same rule holds in the menu, the page finder and direct `/soon/...` links. Every assertion in the existing `*-nav-item.spec.tsx` and `staff-navigation.spec.tsx` files (which items a permission or a loading state hides) is carried over to the model tests before those files are removed |
| 8 | Page frame | `packages/ui` `PageHeader`, `PageShell` (width and gaps), `DataTableFrame` filter and footer slots, stacked rows under 600px | One list page, one form page and one two-column page migrated as reference |
| 9 | Sales and Catalog pages | `apps/admin/src/orders/**`, `apps/admin/src/catalog/**` | Record a visit two-column with sticky summary; list and create pages on the templates |
| 10 | Team and Pay pages | `apps/admin/src/staff/**`, `apps/admin/src/commissions/**` | Employee detail as a tabbed page on its own route; Numbers, Import, Document types, Plans and Overrides on the templates |
| 11 | Attendance, Leave and Setup pages | attendance, leave, identity, permissions, alerts, staff app, schedules | Board template; list pages; Schedule settings as its own page; per-page branch pickers read the workspace branch |
| 12 | Account preference | The ADR-0003 addendum from step 0 is merged; `packages/contracts`, `packages/db` (migration: a nullable `nav_style` column on `user`, NAV-Q10), `packages/auth`, `apps/api` (`GET` and `PUT /v1/me/preferences`), `apps/admin` (read on sign-in, write on change) | The `spec.md` integration scenarios PREF-01 to PREF-08 pass; the PUT is registered in `AUTHENTICATED_WRITES`. The choice follows the user to another browser. Until this merges the choice is kept by the cookie on each device |

Steps 1 and 2 may be one PR: the label-key test of step 1 can only pass once the keys of step 2 exist. Steps 1 to 6 change nothing a user can see. Step 7 is the release of all three styles at once, as the owner asked (NAV-Q8). Steps 4, 5 and 6 are independent of each other; steps 8 to 11 are independent of each other once 8 has merged; step 12 depends only on step 7 and on NAV-Q10. How many run at once is the manager's call under PP-118.

Between step 7 and step 12 the choice is kept per device. The owner accepted this order on 2026-11-21 (NAV-Q12): the three styles release first, saving on the account follows.

The manager reserves the numbers: the next free ADR looks like 0061 and the next PP entry is 212 or later (PP-211 is the highest in `docs/owner-decisions.ar.md` at `cf70114e2`).

Not in this sequence: the cashier app (`design.md` §10, a separate spec first) and `lovable-pospay`, which gets its own spec and plan in its own repository (NAV-Q2).

## Overlap with work in flight

Checked on 2026-11-21 against open PRs by changed file: #1147 (commissions, blocked corrections list), #1145 (pipeline docs) and #1138 (ratings docs). None changes a file under `_frame`, `packages/ui` or `packages/i18n`; #1147 changes the generated `apps/admin/src/shared/api/schema.d.ts` only.

- New admin pages keep arriving (the two commission pages landed between the first draft and this one). After step 1 merges, every PR that adds an admin page must add it to the page list and to all three groupings; the step 1 test fails if it does not. Tell the manager so briefs for page-adding tasks include it.
- Until step 7 merges, new pages still add a `*-nav-item.tsx` file. Step 7 must be rebased on `main` and fold in any that appeared.
- Step 10 must keep the `admin-document-popup` job green.

## Rules for every PR

- No colour, font, radius or button-variant change.
- Existing URLs unchanged. New routes only as listed in `design.md` §4.
- Strings through `packages/i18n` only; logical CSS properties only; icons per ADR-0060.
- UI tests assert what the user sees (CLAUDE.md §9), in each style the PR touches.
- Guards and review follow PP-198: the implementer runs the guards, the session runs one `/code-review`.

## Risks

| Risk | Mitigation |
|---|---|
| Three frames drift: a page is added to one style only | One page list, three groupings, and the step 1 test |
| Three times the frame tests slow CI | Route and active-item tests are table-driven over the model, not three copies; component specs stay in `packages/ui` |
| Nav items hidden by async permission reads leave an empty group, tab row or panel section | The model carries the condition; a group with no visible child is hidden; counts load after the frame |
| A style-only overview route is opened under another style, or the style is switched while on one | `/overview/[group]` sends the user to the first page of that group when the group is not in the current style |
| Per-page branch pickers disagree with the workspace branch | Step 11 makes the workspace branch the single source; the page picker becomes a filter that defaults to it |
| Splitting Schedule settings changes where a manager looks | A link from Weekly schedules to Schedule settings stays in the page header |
| The account write fails or step 12 is late | The cookie keeps the choice per device; the frame never waits on the account call |
| A section with 16 pages does not fit a style on a phone | The full map was not prototyped. Step 1 lists the longest sections; step 7 is checked at 390px in each style before release, and a sub-menu may collapse behind its heading |
| A "Soon" entry promises something that is later dropped or renamed | Names are working names from the PRD; the entry is removed or renamed by the task that decides it, and `/soon/<id>` for a removed id shows not-found |
| The page finder needs a library | Decide in step 6 before writing it; an ADR if so |
| Style B groups pages with different permissions under Approvals | Each page keeps its own condition; the count sums only what the user may see |
