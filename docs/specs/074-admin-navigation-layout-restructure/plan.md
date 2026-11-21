# Implementation Plan: Admin navigation — three switchable styles

**Branch**: `feat/074-nav-styles` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/074-admin-navigation-layout-restructure/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

The admin app gets three navigation styles (A sidebar and tabs, B top bar and hubs, C rail and panel) that share one list of pages and the existing Souk Tiles look. Any signed-in user picks a style on a new Appearance page or in the account menu; C is the default. The frame is chosen on the server from a cookie so the first paint is right, and the choice is later saved on the user's account so it follows them to other devices.

Technical approach, from [research.md](research.md): one typed page list with three groupings, composed in the dashboard frame from per-area exports; three frame components built from `packages/ui` parts on the Radix primitives the package already ships; a `pospay_nav_style` cookie read the same way as the locale cookie; and one nullable column on the `user` table behind two session-only endpoints.

The work is delivered as 13 PRs. Their order, tiers and "done when" are in [pr-sequence.md](pr-sequence.md); the sizes, route map and layout rules are in [design.md](design.md).

## Technical Context

**Language/Version**: TypeScript 6.0.3

**Primary Dependencies**: Next.js 16.3.7 (App Router) and React 19.3.0 in `apps/admin`; `packages/ui` on `radix-ui` 1.6.7, Tailwind CSS 4.3.3, `motion` 13.4.6 and `@phosphor-icons/react` 2.1.10; TanStack Query 5.104.0; NestJS in `apps/api`; Better Auth in `packages/auth`; Drizzle in `packages/db`. No new library.

**Storage**: PostgreSQL. One nullable column on the global identity table `user`. A browser cookie for the first paint.

**Testing**: Vitest 5.0.1 with Testing Library 16.3.3 for the front end; API integration tests against the compose Postgres with one cloned database per spec file (ADR-0006).

**Target Platform**: Browsers on desktop, tablet and phone; Arabic (RTL) and English.

**Project Type**: Web application in a pnpm monorepo: front end `apps/admin` with `packages/ui` and `packages/i18n`; back end `apps/api` with `packages/auth`, `packages/contracts`, `packages/db`.

**Performance Goals**: Switching style shows the new frame in under one second with no full page reload. The frame never waits on the account call. The preference endpoints are single-row reads and writes by primary key, well inside the 200 ms API budget (CLAUDE.md §6).

**Constraints**: No colour, font, radius or button-variant change. Existing URLs unchanged. Strings through `packages/i18n` only. Logical CSS properties only. Interactive targets at least 44px. `apps/pos` untouched.

**Scale/Scope**: 123 management-area menu pages in `app-map.md` (28 built, 2 new, 93 not built and opening one shared Under development page), three groupings, 15 `*-nav-item.tsx` files folded into one model, 13 PRs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. One Vertical Slice at a Time | Pass, with a note | The feature is not one use case; it is cut into 13 PRs, each one reviewable alone (`pr-sequence.md`). The only back-end use case, "set my navigation style", is its own PR (step 12). |
| II. Domain Purity and Money Correctness | Not applicable | No money, no arithmetic, no `domain/` function. |
| III. Tenant Isolation Enforced by the Database | Pass, needs an ADR addendum | No tenant table is added. The new column is on `user`, a global identity table reached only through `packages/auth` on `pospay_auth`. ADR-0003 must classify the column before the migration is written (CLAUDE.md §5). The existing table-level grant to `pospay_auth` covers it; no new grant. |
| IV. Module Boundaries Are Machine-Enforced | Pass | The navigation model is composed in `app/(dashboard)/_frame` from per-area exports (CLAUDE.architecture.md §11.2); nothing with business meaning goes in `src/shared` (§6.4). The endpoint lives in the `identity` module and reaches the column through `packages/auth` only. No new module arrow. |
| V. Test-Backed Delivery | Pass | Front-end tests assert visible outcomes in each style; integration scenarios PREF-01 to PREF-09 for the endpoint. Every hide-condition asserted by today's nav-item specs is carried over before those files are removed. |
| VI. Arabic-First, RTL-Native, One Owned Design System | Pass, needs an ADR addendum | Same tokens and `packages/ui` components; icons per ADR-0060. The theme switch moves out of the sidebar footer in all three styles (NAV-Q5, answered 2026-11-21), which needs an ADR-0059 addendum. |
| VII. Documented Why, in Arabic, With the Code | Pass | No `domain/`, `ports/` or `events/published.ts` change is planned. If step 12 adds a port, it carries its Arabic doc comment. |

Gate result: pass. Two addenda are owed before the PRs that depend on them: ADR-0059 (before step 7) and ADR-0003 (before step 12). Both are written in step 0b (`pr-sequence.md`). NAV-Q5 is answered: one place for the theme switch in all three styles.

Post-design re-check (after Phase 1): unchanged. The data model adds one column and no table; the contract adds two session-only routes and no permission.

## Project Structure

### Documentation (this feature)

```text
docs/specs/074-admin-navigation-layout-restructure/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: decisions and what was checked
├── data-model.md        # Phase 1: page entry, grouping, style preference
├── quickstart.md        # Phase 1: how to verify the feature
├── contracts/
│   └── me-preferences.md  # Phase 1: the two endpoints and the cookie
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── app-map.md           # Every section, sub-menu and page of the product, built or not
├── design.md            # Problem evidence, sizes, route map of built pages, layout rules
├── pr-sequence.md       # The 13 PRs, tiers, overlap, risks
├── owner-questions.ar.md  # Owner answers, verbatim (audit record)
├── prototypes/          # Clickable A, B and C
└── tasks.md             # Phase 2 output (/speckit-tasks), not created here
```

### Source Code (repository root)

```text
apps/admin/
├── app/
│   ├── (dashboard)/
│   │   ├── _frame/
│   │   │   ├── navigation-model.ts        # new: composes the areas' entries; holds only the three arrangements of sections
│   │   │   ├── dashboard-frame.tsx        # changed: picks the frame for the current style
│   │   │   ├── frame-a.tsx, frame-b.tsx, frame-c.tsx   # new: one per style
│   │   │   ├── dashboard-navigation.tsx, dashboard-sidebar.tsx   # replaced by the frames
│   │   │   └── *-nav-item.tsx (15 files)  # folded into the model, then removed
│   │   ├── appearance/page.tsx            # new route
│   │   ├── overview/[group]/page.tsx      # new route, used by styles B and C
│   │   └── soon/[page]/page.tsx           # new route: the shared Under development page
│   └── layout.tsx                         # reads the style cookie beside the locale cookie
└── src/
    ├── <area>/nav.ts                      # new, one per business area: its page entries, their show conditions, section and sub-menu
    ├── settings/                          # Appearance page UI
    ├── session/                           # sign-out clears the style cookie; preference read on sign-in
    └── shared/
        ├── frame/app-frame.tsx            # changed
        └── nav-style/                     # new: cookie name, parse, read, write (no business meaning)

packages/ui/src/            # new parts: WorkspaceSwitcher, AccountMenu, NavTabs, Pills, BottomNav,
                            # HubCard, PageShell, TopNav, MegaMenu, LocalNav, NavRail, ContextPanel,
                            # PageFinder; AppSidebar gains a collapsed state; PageHeader and
                            # DataTableFrame gain slots
packages/i18n/              # group, tab, section, style-name and Appearance labels (ar, en)

packages/contracts/src/identity/me-preferences.ts   # new: Zod schema
packages/db/schema/identity-auth.ts                 # changed: user.navStyle
packages/db/migrations/                             # new: one expand-only migration
packages/auth/src/                                  # new: read and write the caller's nav style
apps/api/src/modules/identity/http/me.controller.ts # changed: GET and PUT me/preferences

docs/adr/0059-souk-tiles-design-system.md, docs/adr/0003-auth-rls-boundary.md   # addenda
docs/journey/                                       # new step (PP-196.4)
```

**Structure Decision**: Existing monorepo layout, no new top-level folder and no new package. Front-end composition sits in `apps/admin/app/(dashboard)/_frame` because the model crosses business areas; each area keeps its own page entries under `apps/admin/src/<area>/`. Reusable frame parts go in `packages/ui`. The one back-end slice extends the existing `me` controller of the `identity` module and reaches the `user` table through `packages/auth`.

File names for new files above are proposals for the implementer; the existing paths were checked on `cf70114e2`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Three frames instead of one | The owner decided to ship all three and let the user choose (NAV-Q1) | One frame was the earlier recommendation; the owner chose otherwise |
| A feature delivered as 13 PRs, not one slice | A frame swap, 28 pages of layout work and a migration cannot be reviewed as one change | A single PR would exceed every review and size limit and would tie the front end to the migration lane |
