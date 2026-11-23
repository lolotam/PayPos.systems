# 074-10a — Team and Pay pages on the shared templates (layout only): delivery spec and plan

Parent: [`spec.md`](../spec.md) (FR-002, FR-008, FR-015, FR-016), [`design.md`](../design.md) §6 and §7, [`pr-sequence.md`](../pr-sequence.md) row 10. Pattern to copy: the merged deliveries [`074-3-8-shell-parts-and-page-frame`](../074-3-8-shell-parts-and-page-frame/spec.md) and [`074-9-sales-catalog-pages`](../074-9-sales-catalog-pages/spec.md), including the «Implementation notes» of 074-9, which record what three review passes corrected.

## Owner decision

Row 10 is delivered in two parts. Waleed, card of 2026-11-23, «نقسّم: التخطيط دلوقتي والمسارات بعد 7b (Recommended)»: **10a** (this slice) lays the existing Team and Pay pages out on the shared templates and adds no route; **10b**, after 074-7b merges, adds Employee detail as a tabbed page on its own route. Tier Medium. Cap: 2,800 added plus removed lines of code and tests, docs counted separately. Review pipeline PP-228. Recorded as PP-234 in `docs/owner-decisions.ar.md`.

## What changes for a user

Seven pages get the layout of the reference pages: a centred page of a fixed maximum width, one header, cards in the template's order, tables that become stacked cards on a phone. Addresses, permissions, data, validation, messages and actions do not change.

| Page | Address | Component | Template (`design.md` §6) |
|---|---|---|---|
| Employees | `/staff` | `staff/pages/employees-page.tsx` | List |
| Create employee | `/staff/create` | `staff/pages/create-employee-page.tsx` | Form (840px) |
| Employee numbers | `/staff/employee-numbers` | `staff/company-numbers/pages/company-employee-numbers-page.tsx` | List |
| Import employees | `/staff/import` | `staff/pages/employee-import-page.tsx` | Form or list, whichever its content is today |
| Document types | `/staff/document-types` | `staff/pages/document-types-page.tsx` | List |
| Commission plans | `/commissions/plans` | `commissions/pages/commission-plans-page.tsx` | List |
| Commission overrides | `/commissions/overrides` | `commissions/pages/commission-overrides-page.tsx` | List |

Not in 10a: Employee detail and the employee leave page (`/staff/[employeeId]/leave`), which are 10b. On Employees, the inline employee edit panel and the passkey panel stay exactly where they are on `main`.

## Requirements

1. Each page is wrapped in `PageShell` with the variant its template names and uses `PageHeader` for the title, an optional one-line description where an existing i18n key fits (no new copy), and actions: one primary action at the inline end, further actions as outline buttons before it.
2. List pages: one card holding filter bar, table and footer with paging, in that order, through `DataTableFrame`'s filter and footer areas. Stacked rows under 600px are switched on for every real table: the first cell is the card title; every other cell that has content shows its column label; a cell whose only content is an action carries no duplicate label; an empty cell collapses without `display: none`, so it stays in the accessibility tree.
3. Form pages: one card of titled sections on the 12-column grid (fields span 6, short fields 4, long fields 12), action bar at the card foot with the primary action last; one column on a phone. A field's label, control and message move together as one unit. Registration, handlers, validation and submit logic stay where they are.
4. Behaviour is unchanged. In particular: a page that is refused keeps exactly the requests `main` makes (no new query observer that fetches while a screen is closed); one query has one observer per screen, so data, refusal and paging come from one snapshot; filters and inputs keep their React position so focus survives a late refusal or a reload.
5. The `admin document popup · production browser` CI job stays green: do not change the employee document popup flow, its routes or the elements its browser test reads. Read `apps/admin/e2e/employee-document-popup-*` before touching `staff/**`.
6. Look: no colour, font, radius or button-variant change. `PageHeader`'s heading size is the template's and is intended. Logical inline properties only. All text through `packages/i18n`; a new key only for a form section title or a stacked-row label with no existing key in either language (search the catalogs for the same text first), `ar` and `en` together.
7. One React component per file, test helper components included; 60 lines per function; 400 per file.

## Not in this PR

Any route, `page.tsx` or `layout.tsx`; anything under `apps/admin/app/(dashboard)/_frame/`, `apps/admin/src/shared/frame/` or the navigation model; `packages/ui` (unless a template defect blocks you, listed with its reason); Attendance, Leave and Setup pages (074-11); any API, contract, migration, permission, dependency or deploy change.

## Acceptance

1. Each page has a rendered test that proves its template structure with what a user or a screen reader gets: for a list, the filter, the table and the paging are inside one card (`within(card)`), in order; for a form, titled sections and the primary action last at the card foot.
2. Each real table has a test covering every cell of a stacked row.
3. No existing assertion is deleted or weakened; a changed assertion is listed with its reason.
4. Tests do not pin implementation details where a visible or structural assertion exists, do not import production constants to assert against them, and do not name a constant «token» or «secret» (the PR's secret scanner flags it).
5. `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test` pass.
6. Widths, spans, stacking under 600px and 44px targets are CSS outcomes; they are reported as not browser-verified and belong to the 074-7b browser pass (#1192).

## Plan

1. Read the reference pages and 074-9's pages and specs as merged on `main`, then `PageShell`, `PageHeader` and `DataTableFrame` in `packages/ui`.
2. Pay: Commission plans, Commission overrides.
3. Team lists: Employee numbers, Document types, Import employees.
4. Employees, then Create employee.
5. Gates, guards (`clean-code-guard`, `test-guard` run as skills), size.

Estimate: 600 production, 800 tests. Review rounds roughly doubled 074-9, so stop and report if code plus tests passes 1,700 before step 5.

## Implementation notes

### What moved, per page

| Page | What moved | Tests that prove the structure |
|---|---|---|
| Employees | `PageShell list`; header actions: Document types (and the app link when it exists) as outline `actions`, Create employee as the primary `action`; one stacked `DataTableFrame` owned by `EmployeeListPanel` in every state, with the search in its filter area, loading, refusal and empty inside, and paging in its footer; bare table with explicit roles and labels on Name, Role and Primary branch | `staff/pages/employees-page-layout.spec.tsx` |
| Create employee | `PageShell form`; one card; sections «Employee details» (names, 6 + 6) and «Employment» (branch 6, role 6, hire date 4, contract end 4, user ID 12, employee number 4); every label and control in one cell; create action last at the card foot; fields keep their old DOM order | `staff/pages/create-employee-page-layout.spec.tsx` |
| Employee numbers | `PageShell list`; one stacked card in every state; the search sits in the card's filter area and is absent only when access is refused (as on `main`); labels on Business and Employee number | `staff/company-numbers/pages/company-employee-numbers-page-layout.spec.tsx` |
| Import employees | `PageShell form`; one card with sections «Template» and «File», actions at the foot (Preview, then Commit last, both still outline); the rows-to-fix table, the result and the refusal below the card; the errors table is stacked, caption kept | `staff/pages/employee-import-page-layout.spec.tsx` |
| Document types | `PageShell list`; one stacked card holds loading, refusal or the table; the add/edit form and its messages stay after the table in their own card; the Edit/Deactivate cell has no label (its header text equals its button) | `staff/pages/document-types-page-layout.spec.tsx` |
| Commission plans | `PageShell list`; the employee picker and the plan form stay where they are; the version history is one stacked card with Load more moved from the title bar to the footer | `commissions/pages/__tests__/commission-plans-page-layout.spec.tsx` |
| Commission overrides | `PageShell list`; the picker stays before the card; the services table is one stacked card with Load more in the footer; the Edit cell has no label | `commissions/pages/__tests__/commission-overrides-page-layout.spec.tsx` |

### Precedent for the two commission pages

The employee picker chooses whose data the screen shows; it does not narrow rows. It therefore stays between the header and the card, like the scope select of Categories in 074-9, and is asserted to be outside the card. The card is the per-employee table. A frame above the section would need the section's queries lifted into the board, which is the second-observer mistake 074-9 corrected; a frame inside the section would remount the picker. The plan builder form stays between the picker and the history card: no document says where it goes (open point 1).

### Requests and states against `origin/main`

No new network query observer, query key, enabled flag or request was added, removed or reordered. Each page has the same single owner of each query as on `main`; only wrapper elements moved. Presentation components that moved or were split out call `useLocale`, and `usePlanAccess` subscribers (local cache state) already existed on `main`; neither is a network observer. States on `main` and now (loading, refusal, denied, empty, data, paging) render the same content; the card now surrounds them where the template says so. Employee numbers still renders no search box while access is refused; Employees and Document types still render no form while the read is pending or refused.

### Shared files

- Opt-in `grid` prop (default off, markup unchanged) on `EmployeeNameFields`, `EmployeePlacementFields`, `EmployeeContractFields` and `EmployeeNumberField`; these are shared with `EditEmployeeForm`, whose panel is unchanged. No `staff/ui` file used by the Attendance or Leave pages was touched.
- `EmployeeListSearch` and `EmployeePageNavigation` (shared by Employees and Employee numbers) are unchanged.

### Changed assertions

None. No assertion in an existing spec was deleted or edited.

### `packages/ui` changes

None. `packages/i18n`: `employeeImport.sectionTemplate`, `employeeImport.sectionFile`, `staff.sectionIdentity`, `staff.sectionEmployment`, each in `ar` and `en`; none had a match in either catalog.

### Open points

1. The plan builder form (Commission plans) and the add/edit form (Document types) have no stated destination; both stay where they are.
2. Employees keeps the employee number as its first column, so on a phone the number is the card title; Employee numbers starts with the Name, so the name is the card title. No document says to reorder columns.
3. The inner fields of the Document types form and of the plan builder were not put on the 12-column grid: the spec names only the pages' frames.
4. Document types keeps its title in both the page header and the card (as Package types does).

### Not verified in a browser

Widths, 12-column spans, stacking under 600px, 44px targets, the Arabic layout, how the form card looks around the disabled fieldset, and the document popup browser job (the popup flow and the `/staff` row and Edit button it reads are unchanged in structure; the job itself was not run).

### Table header look against `origin/main` (correction round 1)

`DataTableFrame` gives its tables a header look (`bg-secondary` header row, `text-xs font-medium text-muted-foreground` cells). Where the table was already in the frame on `main` nothing changes: Employees, Employee numbers, Document types, Plan versions and the override Services table (the first three only had the frame moved up one level, into the panel that owns the card). Only the Import «rows to fix» table was a plain `text-sm` table on `main`; it now restores its header locally with `bg-transparent!` on the header row and `text-sm! font-bold! text-inherit!` on each header cell (Tailwind 4 important suffix, so no `packages/ui` change). Row separators and cell padding still come from the frame: they are layout, and the stacked-row look needs them. Proving test: `employee-import-page-layout.spec.tsx`, «keeps the plain desktop header look…».

### Sizes

See the final report; the 1,700 stop line was passed at the end of step 4, before step 5 (gates and guards only).
