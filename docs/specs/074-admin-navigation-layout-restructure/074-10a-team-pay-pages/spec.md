# 074-10a — Team and Pay pages on the shared templates (layout only): delivery spec and plan

Parent: [`spec.md`](../spec.md) (FR-002, FR-008, FR-015, FR-016), [`design.md`](../design.md) §6 and §7, [`pr-sequence.md`](../pr-sequence.md) row 10. Pattern to copy: the merged deliveries [`074-3-8-shell-parts-and-page-frame`](../074-3-8-shell-parts-and-page-frame/spec.md) and [`074-9-sales-catalog-pages`](../074-9-sales-catalog-pages/spec.md), including the «Implementation notes» of 074-9, which record what three review passes corrected.

## Owner decision

Row 10 is delivered in two parts. Waleed, card of 2026-11-23, «نقسّم: التخطيط دلوقتي والمسارات بعد 7b (Recommended)»: **10a** (this slice) lays the existing Team and Pay pages out on the shared templates and adds no route; **10b**, after 074-7b merges, adds Employee detail as a tabbed page on its own route. Tier Medium. Cap: 2,800 added plus removed lines of code and tests, docs counted separately. Review pipeline PP-228. The PP number is assigned by the manager and added to this file when known.

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

*(filled by the implementer: per page what moved, the proving tests, changed assertions, `packages/ui` changes, open points, sizes)*
