# 074-1 + 074-2 — Scope & Delivery Spec: Navigation Model & i18n Catalog

**Parent spec:** [spec.md](spec.md) (FR-001 to FR-027, BR-001 to BR-010) · [data-model.md](data-model.md) · [app-map.md](app-map.md) · [pr-sequence.md](pr-sequence.md) · [owner-questions.ar.md](owner-questions.ar.md)

**Owner approval (2026-11-21):**
- Combined `074-1 + 074-2` in one Medium PR: «Medium في PR واحد» (`owner-questions.ar.md`).
- Separate `074-0c` (workspace business type & country fields): «اعتمد Medium». PR #1161 (32b-1 + 34-pre-3) supplied the stored country. Extending the workspace response belongs to 0c.

## 1. Deliverable Scope

### Step 1 — Typed Navigation Model (`apps/admin`)
- **Pure structural types:** `apps/admin/src/workspace/nav-types.ts` (type-only; imported via `import type` by each business area per `CLAUDE.architecture.md` §6.4 and §11.2, keeping `src/shared/` free of business meaning).
- **Per-domain page exports (`apps/admin/src/<area>/nav.ts`):** each business area owns its own Management-area entries, live visibility condition identifiers, count source identifiers, section and sub-menu placement:
  - `workspace`, `orders`, `catalog`, `customers`, `staff`, `commissions`, `reporting`, `business-identity`, `permissions`, `session`, `settings`.
- **Composition and groupings (`apps/admin/app/(dashboard)/_frame/navigation-model.ts`):**
  - The frame composes the domain exports. Route matching, destination selection and visibility rules live in `apps/admin/src/workspace/model/navigation-rules.ts`.
  - Composes all 131 typed entries:
    - **127 Management-area `app-map.md` rows:**
      - **27 live top-level routes** (one per built top-level admin route).
      - **1 embedded live entry** (`schedule-settings`, `parent: 'weekly-schedules'`, `embeddedInParent: true`): represents `Schedule settings` while it remains a block at the top of `/schedules` until step 11 (`pr-sequence.md` step 7), avoiding duplicate `/schedules` routes while keeping all 127 Management entries modeled.
      - **2 planned step-7 (`New`) entries** (`approvals-inbox` with `plannedRoute: '/approvals'`, `appearance` with `plannedRoute: '/appearance'`): typed as `state: 'soon'` until step 7 ships their routes (`data-model.md`).
      - **97 `Soon` entries** (each with `state: 'soon'`, no live `route`, opening `/soon/<id>` when step 7 activates the frame).
    - **4 live Next.js child routes** (`appMapEntry: false`, `parent` set): `/catalog/create`, `/catalog/package-types/create`, `/staff/create`, `/staff/[employeeId]/leave`.
  - **Total live routes covered:** all **30** `apps/admin/app/(dashboard)/**/page.tsx` routes plus `/security/two-factor` = **31** routes, 1-to-1 with unique `live` entries.
  - **Total top-level menu entries (`parent === undefined`):** **126** entries (27 live + 2 planned step-7 `soon` + 97 `soon`).
  - **Three groupings (`NAVIGATION_GROUPINGS.A`, `.B`, `.C`):** built deterministically from canonical `section` and `submenu` metadata matching `app-map.md` (`A`: 7 groups with 4 marked for phone bottom bar; `B`: 6 modules; `C`: 5 workspaces, default `C`). Every top-level entry appears **exactly once** in each grouping.
- **Authorized business-type, country, role, visibility and count models:**
  - `NavigationBusinessType` extends `VerticalType` from `@pospay/contracts` (`restaurant | salon | laundry | retail | services`) with Phase 6 expansion verticals named in `app-map.md` (`clinic | gym | education`). Empty `businessTypes` means every business type (including stock entries per `NAV-Q19`; partner decision remains `PENDING`).
  - Country conditions use `Country` from `@pospay/contracts` (`'KW'` for Qayd entries per `NAV-Q21`, `'SA'` for ZATCA). Step 0c reads the business setting introduced by `34-pre-3`.
  - `NavigationRoleCode` reuses `Employee['role_code']` from `@pospay/contracts`. Each `Soon` entry carries its PRD §3.2 baseline roles for `NAV-Q14`. Planned Appearance is available to every signed-in user, including custom roles (`FR-005` / `NAV-Q1`). Live entries carry `visible` instead of `roles`, preserving the current guarded nav-item conditions and keeping unguarded live pages `'always'` (`BR-006` / `FR-010`).
  - `NavigationCountSource` is declared only on the 4 entries named in `FR-026` / `research.md` R10 (`approvals-inbox`, `leave-approvals`, `attendance-requests`, `attendance-exceptions`); step 7 binds counts only where an existing cheap read supplies them.
- **Shared map source (`app-map.shared.mjs` → `app-map.md`):**
  - Adds the `Roles` column data in `app-map.shared.mjs` for Management rows and regenerates `app-map.md` via `node docs/specs/074-admin-navigation-layout-restructure/app-map.shared.mjs`. `app-map.md` is never edited by hand, and `lolotam/lovable-pospay` is untouched.
  - Partner-pending items (`NAV-Q14`, `NAV-Q15`, `NAV-Q17` partner check, `NAV-Q19`, `NAV-Q20`, `NAV-Q21`) are not marked final.

### Step 2 — Arabic & English i18n Catalog (`packages/i18n`) + `schedules.reload`
- Adds `adminNav` (`packages/i18n/src/admin-nav-catalog.ts`), `adminNavPages` (`admin-nav-pages-en.ts`, `admin-nav-pages-ar.ts`), and `schedules` (`schedules.reload`) to `packages/i18n/src/catalog.ts`.
- Covers every style name/description (`A`, `B`, `C`), Appearance labels, Account menu labels, "Soon" badge and screen-reader label, Under development page text (no date, no phase number — `FR-021`), all 7 sections, all 35 sub-menus, Style A groups + More, Style B modules + Overview, Style C workspaces + filter/page finder, Approvals inbox labels, and all 99 non-live Management page names (live pages reuse their existing canonical `packages/i18n` keys).
- Replaces `staff.reload` with `schedules.reload` in `apps/admin/src/staff/ui/schedule-week-controls.tsx` (`FR-017`).

## 2. Explicit Out-of-Scope Boundaries
- No `074-0c` contract/API/query changes (`WorkspaceBusiness` stays unchanged).
- No database migrations, permissions, storage, cookies, or API endpoints.
- No `packages/ui` component work (steps 3–6) and no live frame/menu/auth changes (step 7). Existing `dashboard-frame.tsx`, `dashboard-sidebar.tsx`, `dashboard-navigation.tsx`, `staff-navigation.tsx`, and the 15 `*-nav-item.tsx` files keep their current behavior.
- No edits in any other repository.

## 3. Verification Criteria
- `apps/admin/app/(dashboard)/_frame/navigation-model.spec.ts`: checks coverage of `(dashboard)/**/page.tsx` + `/security/two-factor`, live, planned and Soon totals against generated `app-map.md`, exactly one appearance of every top-level entry in A, B, and C, single-entry active resolution including `/staff-app-columns` and child routes, `@pospay/ui` icon exports, `ar`/`en` translation keys, visibility and count boundaries, and representative business-type, country and role conditions.
- `packages/i18n/src/admin-nav-catalog.spec.ts`: proves `ar`/`en` key parity, non-empty script shape, `schedules.reload`, style labels, and no date/phase in Under development text.
- `apps/admin/src/staff/ui/schedule-week-controls.spec.tsx`: proves visible reload button uses `schedules.reload` and not `staff.reload`.
- Local gates: typecheck, lint (including boundaries), `pnpm lint:docs`, `pnpm module-map:check`, and affected package tests.
