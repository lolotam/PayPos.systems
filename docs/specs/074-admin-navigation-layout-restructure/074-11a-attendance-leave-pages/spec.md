# 074-11a — Attendance and Leave pages on the shared templates (layout only): delivery spec and plan

Parent: [`spec.md`](../spec.md) (FR-002, FR-008, FR-015, FR-016), [`design.md`](../design.md) §6 and §7, [`pr-sequence.md`](../pr-sequence.md) row 11. Pattern to copy: the merged deliveries [`074-3-8-shell-parts-and-page-frame`](../074-3-8-shell-parts-and-page-frame/spec.md) and [`074-9-sales-catalog-pages`](../074-9-sales-catalog-pages/spec.md), including the «Implementation notes» of 074-9, which record what three review passes corrected.

## Owner decision

Row 11 is delivered in two parts. Waleed, card of 2026-11-23, «نقسّم: التخطيط دلوقتي والمسارات بعد 7b (Recommended)»: **11a** (this slice) lays the existing Attendance and Leave pages out on the shared templates and adds no route; **11b**, after 074-7b merges, makes Schedule settings its own page, makes the per-page branch pickers read the workspace branch, and lays out the Setup pages (Weekly schedules, Permissions, Alerts, Staff app link, Staff app columns, Imported refunds). Tier Medium. Cap: 2,800 added plus removed lines of code and tests, docs counted separately. Review pipeline PP-228. The PP number is assigned by the manager and added to this file when known.

## What changes for a user

Seven pages get the layout of the reference pages: a centred page of a fixed maximum width, one header, cards in the template's order, tables that become stacked cards on a phone. Addresses, permissions, data, validation, messages, actions and every branch or date picker's behaviour do not change.

| Page | Address | Component | Template (`design.md` §6) |
|---|---|---|---|
| Attendance board | `/staff/attendance` | `staff/pages/attendance-board-page.tsx` | Board: header → status blocks → table |
| Attendance requests | `/staff/attendance-requests` | `staff/pages/attendance-requests-page.tsx` | List |
| Attendance exceptions | `/staff/attendance-exceptions` | `staff/pages/attendance-exceptions-page.tsx` | List |
| Monthly report | `/staff/attendance-report` | `staff/pages/attendance-report-page.tsx` | List |
| Statement | `/staff/attendance-statement` | `staff/pages/attendance-statement-page.tsx` | List |
| Leave approvals | `/leave` | `staff/pages/leave-inbox-page.tsx` | List |
| Leave history report | `/staff/leave-history` | `staff/pages/leave-report-page.tsx` | List |

Not in 11a: the employee leave page (`/staff/[employeeId]/leave`, part of 10b), Weekly schedules and every Setup page (11b), and any change to how a branch picker chooses its branch (11b).

## Requirements

1. Each page is wrapped in `PageShell` with the list variant (the board uses the list width) and uses `PageHeader` for the title, an optional one-line description where an existing i18n key fits (no new copy), and actions: one primary action at the inline end, further actions as outline buttons before it.
2. List pages: one card holding filter bar, table and footer with paging, in that order, through `DataTableFrame`'s filter and footer areas. Stacked rows under 600px are switched on for every real table: the first cell is the card title; every other cell that has content shows its column label; a cell whose only content is an action carries no duplicate label; an empty cell collapses without `display: none`, so it stays in the accessibility tree. A list that is a set of cards and not a table keeps its cards and gets no stacked rows.
3. Board: header, then the filters, then the status blocks («in now», refusals and the like) in their current order, then the sessions table in its card. No block is merged, dropped or reordered beyond what the template names.
4. Behaviour is unchanged. In particular: a page that is refused keeps exactly the requests `main` makes (no new query observer that fetches while a screen is closed); one query has one observer per screen, so data, refusal and paging come from one snapshot; filters, date and branch pickers keep their React position so focus and their chosen value survive a late refusal, a reload or a decision; polling intervals, approve and reject actions, dialogs and their focus return are untouched.
5. Look: no colour, font, radius or button-variant change. `PageHeader`'s heading size is the template's and is intended. Logical inline properties only. All text through `packages/i18n`; a new key only for a stacked-row label with no existing key in either language (search the catalogs for the same text first), `ar` and `en` together.
6. One React component per file, test helper components included; 60 lines per function; 400 per file. `attendance-statement-page.tsx` is 166 lines today: if the template pushes it over a limit, split by responsibility, not by line count.

## Not in this PR

Any route, `page.tsx` or `layout.tsx`; anything under `apps/admin/app/(dashboard)/_frame/`, `apps/admin/src/shared/frame/` or the navigation model; `packages/ui` (unless a template defect blocks you, listed with its reason); Team and Pay pages (074-10a, running in parallel on another branch: do not touch `staff/pages/employees-page.tsx`, `create-employee-page.tsx`, `employee-import-page.tsx`, `document-types-page.tsx`, `staff/company-numbers/**`, `commissions/**`, or the `staff/ui` files only those pages use); any API, contract, migration, permission, dependency or deploy change.

## Acceptance

1. Each page has a rendered test that proves its template structure with what a user or a screen reader gets: the filter, the table and the paging are inside one card (`within(card)`), in order; for the board, the order header → filters → status blocks → table.
2. Each real table has a test covering every cell of a stacked row.
3. No existing assertion is deleted or weakened; a changed assertion is listed with its reason.
4. Tests do not pin implementation details where a visible or structural assertion exists, do not import production constants to assert against them, and do not name a constant «token» or «secret» (the PR's secret scanner flags it).
5. `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test` pass.
6. Widths, stacking under 600px and 44px targets are CSS outcomes; they are reported as not browser-verified and belong to the 074-7b browser pass (#1192).

## Plan

1. Read the reference pages and 074-9's pages and specs as merged on `main`, then `PageShell`, `PageHeader` and `DataTableFrame` in `packages/ui`.
2. Leave: Leave approvals, Leave history report.
3. Attendance lists: Requests, Exceptions, Monthly report, Statement.
4. Attendance board.
5. Gates, guards (`clean-code-guard`, `test-guard` run as skills), size.

Estimate: 600 production, 850 tests. Review rounds roughly doubled 074-9, so stop and report if code plus tests passes 1,700 before step 5.

## Implementation notes

*(filled by the implementer: per page what moved, the proving tests, changed assertions, `packages/ui` changes, open points, sizes)*
