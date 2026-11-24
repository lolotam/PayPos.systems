# 074-10b — Employee detail as a tabbed page on its own route: delivery spec and plan

Parent: [`spec.md`](../spec.md), [`design.md`](../design.md) §1 («Editing an employee opens an inline card under the table… the Details tab stacks six unrelated sections»), §4 (route map: «`/staff`, `/staff/create`, employee detail» and «`/staff/[employeeId]/leave` → Employee detail › Leave tab»; «New routes: Employee detail») and §6 («Detail: header → in-page tabs → the tab's cards. The employee card becomes this: Details, Pay, Hours and card, Documents, Leave»), [`pr-sequence.md`](../pr-sequence.md) row 10, [`074-10a-team-pay-pages/spec.md`](../074-10a-team-pay-pages/spec.md) (layout rules reused here, and «Not in 10a: Employee detail and the employee leave page, which are 10b»).

## Owner decisions

Split 10a/10b: PP-234. Deferral ended: PP-260 (Waleed, 2026-11-24, «يلا نكمل واحدة بواحدة نخلصها وندمج»).

## Tier and implementer (PP-266)

Front end only: no API, contract, migration, permission or dependency change. But the page hosts the salary, bank-account and staff-access sections and the employee document flow that a CI browser job exercises, and it replaces the screen every manager uses to edit an employee. **Implementer: Sonnet 5.5** (not a free model, not MiniMax); one independent review; the owning session's line-by-line read; `ci-gate` including `admin document popup · production browser`; the bot panel. Estimate 900 added plus removed lines of code and tests (350 production, 550 tests); cap 1,800; review fixes up to 2,700.

## What changes for a user

Today, pressing «Edit» on a row of Employees opens a card under the table with two buttons (Details, Leave); Details stacks the edit form, salary, bank account, default hours, attendance card, documents and staff access in one column.

After 10b, pressing «Edit» opens the employee's own page at `/staff/<employeeId>`: a header with the employee's name and number and a «Back to employees» link, then five tabs, each showing only its sections:

| Tab | Address | Content (existing components, unchanged inside) |
|---|---|---|
| Details | `/staff/<id>` | `EditEmployeeForm` with its save status, then `EmployeeAccessSection` |
| Pay | `/staff/<id>?tab=pay` | `EmployeeSalarySection`, `EmployeeIbanSection` |
| Hours and card | `/staff/<id>?tab=hours` | `EmployeeDefaultHoursSection`, `EmployeeCardSection` |
| Documents | `/staff/<id>?tab=documents` | `EmployeeDocumentsSection` |
| Leave | `/staff/<id>/leave` (existing address, kept) | `EmployeeLeaveSection` |

The Employees list keeps its table, search, paging, header actions, the number-start dialog and the passkey panel exactly as they are; only the inline card goes. Every address that exists today still works. Permissions, data, validation, messages and each section's behaviour do not change.

## Decisions taken in this spec (owning session; tell the manager in the report)

1. **Tabs are links, in the URL.** Four tabs are a `?tab=` query on one route and Leave keeps its existing path, so a tab can be bookmarked, the browser's back button moves between tabs, and the frame's menu marks «Employees» current on all of them (the model already has `employee-leave` with `parent: 'employees'`).
2. **Staff access sits in Details**, not in a sixth tab: `design.md` §6 names five tabs and predates the staff-access section (spec 076). Its component and behaviour are not touched.
3. **A tab the user may not use is still listed.** Each section already shows its own refusal; no new permission logic and no hiding by role (a later task may hide tabs once an access read exists for each).
4. **Sections stay mounted only while their tab is shown** (today the Details column mounts all six at once and fires all their reads). So opening the page fires the employee read and the reads of the first tab only. This is a change in request timing, not in behaviour; say so in the PR.
5. **Unsaved edits.** Switching tab while the Details form has unsaved changes discards them, as closing the card does today. No new confirm dialog in this slice; recorded as a follow-up on #1192.

## In scope

### 1. Routes
- New `apps/admin/app/(dashboard)/staff/[employeeId]/page.tsx`, a thin server file in the pattern of `staff/[employeeId]/leave/page.tsx`: awaits `params`, renders `EmployeeDetailRoute` with `employeeId` and no tab (the route component reads `?tab=` with `useSearchParams`).
- `staff/[employeeId]/leave/page.tsx` renders the same `EmployeeDetailRoute` with `tab="leave"`. `_frame/employee-leave-route.tsx` is deleted if nothing else imports it (search first).
- New `_frame/employee-detail-route.tsx` (client): the same guards the other staff routes use (`workspace.status === 'ready'`, a selected business with the existing `admin.chooseBusiness` line, a session user id), a `key` of company, business, user and employee, then `EmployeeDetailPage`.
- An unknown `?tab=` value shows Details. An `employeeId` that is not a UUID, or one the API answers 404 for, shows the record's existing error state inside the page shell with the back link; it does not crash and does not call `notFound()` (the read is client-side).

### 2. Page
- New `apps/admin/src/staff/pages/employee-detail-page.tsx`: `PageShell` (detail template of `design.md` §6: use the variant the shared kit offers for it; if `PageShell` has no detail variant, use the form width 840px and say so), `PageHeader` whose title is the employee heading (reuse `EmployeeProfileHeading`'s data and text; the `<h1>` comes from `PageHeader`), a secondary action «Back to employees» linking to `/staff` (existing key if one fits, else one new key `staff.backToList`, `ar` and `en`), then the tab row, then the active tab's cards.
- New `apps/admin/src/staff/ui/employee-detail-tabs.tsx`: the tab row as links, using the kit's `NavTabs` (or `Pills`, whichever the Admin frames already use for in-page tabs; read `packages/ui` and one existing use). The current tab carries `aria-current="page"`. Labels: reuse `leaveHistory.tabData` and `leaveHistory.tabLeave` for Details and Leave; three new keys for Pay, Hours and card, Documents (`ar` and `en`); the row's accessible name reuses `leaveHistory.tabsLabel`.
- One file per tab body where a body is more than a few lines (`employee-detail-data-tab.tsx`, `-pay-tab.tsx`, `-hours-tab.tsx`, `-documents-tab.tsx`), each rendering the existing section components with exactly the props `employee-edit-panel.tsx` and `employee-record-sections.tsx` pass today (`companyId`, `businessId`, `userId`, `employeeId`, and `timeZone` of the employee's primary branch for the IBAN and Leave sections, `'UTC'` fallback as today). The Details tab keeps: the loading and error states of the record, `EditEmployeeForm` keyed by `id:revision`, the save error and saved messages, and the reload action (`save.reset()` then `record.refetch()`); «Close» becomes the back link.
- `useEmployeeEdit(companyId, businessId, userId, employeeId)` is called once, in the page, and its `record`/`save` are passed down; the Leave tab waits for the record as today (it needs the primary branch's time zone).
- Keep the `TODO(spec) SS-Q2` comment with the code it describes.

### 3. Employees list
- `employees-page.tsx`: remove the `employeeId` state, `EmployeeEditPanel` and the `selectedId` plumbing that only served it. The row's «Edit» control becomes a link to `/staff/<id>` (keep its accessible name `staff.edit` so existing tests and the browser test still find it; a link styled as the same button via `asChild`).
- Delete `employee-edit-panel.tsx`, `employee-file-tabs.tsx`, `employee-record-sections.tsx`, `employee-edit-actions.tsx` and their specs **only after** each of their assertions has an equivalent test on the new page (table in the notes: old assertion → new test). A component still imported elsewhere stays.

### 4. Navigation model and map
- `apps/admin/src/staff/nav.ts`: add an entry `employee-detail` with `route: '/staff/[employeeId]'`, `parent: 'employees'`, like `employee-leave` (no menu entry of its own; marks «Employees» current). `navigation-model.spec.ts` and the route-coverage test pass with the new `page.tsx`.
- `app-map.shared.mjs`: the Employee detail row becomes Live; regenerate both `app-map.md` outputs with the script. Report it for the manager's docs PR in `lolotam/lovable-pospay`.

### 5. Browser test (CI only)
`apps/admin/e2e/employee-document-popup*.ts` opens `/staff`, presses «Edit» on a row, expects the employee heading, uses the documents section, and presses «Cancel» (`staff.cancel`). Update the helpers and the spec for the new flow: «Edit» navigates to `/staff/<id>`; open the Documents tab before touching documents; replace «Cancel» with the back link. Do not weaken what the test proves about the popup. Playwright is not run locally: read the file end to end, change only the navigation steps, and list every changed step in the notes; the CI job `admin document popup · production browser` is the check.

### 6. Docs
`pr-sequence.md` row 10 (10b delivered), this spec with filled notes, the regenerated maps, and the journey file that describes editing an employee if `docs/journey/` has one (search; update `ar` and `en`).

## Not in this PR

Any change inside the section components (`EditEmployeeForm`, salary, IBAN, default hours, card, documents, staff access, leave) beyond what a prop rename forces; any API, contract, migration, permission or dependency change; `apps/admin/src/session/**`; `packages/ui` unless a missing detail variant blocks the page (listed with its reason); the frames and the menu view model beyond the one model entry; a confirm dialog for unsaved edits; hiding tabs by role; the passkey panel; Create employee.

## Acceptance

Rendered tests (Vitest + Testing Library), each asserting what a user or a screen reader gets:

1. `/staff/<id>` shows the header with the employee's name and number, the five tabs with Details current, the edit form and the staff-access section, and none of the Pay, Hours, Documents or Leave sections.
2. Each of `?tab=pay`, `?tab=hours`, `?tab=documents` and `/staff/<id>/leave` shows its tab current and exactly its sections; an unknown `?tab=` shows Details.
3. Only the reads of the shown tab are requested (assert the requests made on opening Details do not include the salary, IBAN, hours, card, documents or leave reads).
4. Saving the form shows the saved message and the refreshed values; a save error shows the alert; reload refetches.
5. A failed employee read (404, 403, network) shows the existing error state inside the shell with the back link, on every tab.
6. Employees list: «Edit» is a link to `/staff/<id>`; no inline card; search, paging, header actions, the number-start dialog and the passkey panel behave as before (their existing tests pass unchanged, or each changed assertion is listed with its reason).
7. In the mounted frame, «Employees» is the current menu item on `/staff/<id>`, each `?tab=` and `/staff/<id>/leave`, in styles A, B and C.
8. The carried-assertion table for the deleted files is complete.
9. Layout: the page uses the shell and header of the detail template; tab row and cards in order; logical CSS properties only; no colour, font, radius or button-variant change.

Gates: `pnpm typecheck`; `pnpm lint`; `pnpm lint:docs`; `pnpm module-map:check`; `pnpm --filter @pospay/i18n test`; the whole admin suite; `eslint` named on every changed or created file. CI: `ci-gate` and `admin document popup · production browser` on the exact head.

Not verifiable locally, to be reported as such: widths, stacking and 44px targets in a browser; the Playwright flow.

## Plan

1. Read the parents, `employees-page.tsx`, `employee-edit-panel.tsx` and every component it renders, their specs, the leave route, `staff/nav.ts`, the e2e files, one existing in-page tab use of the kit.
2. Route, page shell, tabs, Details tab; tests 1, 4, 5.
3. The other four tabs; tests 2, 3.
4. Employees list change; test 6; carried assertions; delete the old files.
5. Model entry, map, frame tests (7).
6. Browser test steps.
7. Docs, gates, guards (`clean-code-guard`, `test-guard`), size.

Stop and report if: a section needs a change inside it; `PageShell` or the tab kit needs a change in `packages/ui`; code plus tests passes 1,400 before step 7; anything under `src/session/**` or the frames needs editing.

## Implementation notes

### Shell and tabs

- **Shell:** `PageShell layout="form"` (840px). `PageShell` offers `list`, `form` and `two-column` only, so there is no detail variant; the form width is the fallback this spec names. `packages/ui` is untouched.
- **Tab component:** the kit's `NavTabs` (the row style A's frame already uses). Items are plain `<a href>`; the frame's soft-navigation boundary wraps only the frame's own menus, not page content, so `EmployeeDetailTabs` wraps the row in one click handler that sends a plain left-click to `router.push` (modified clicks stay with the browser). The route reads `?tab=` with `useSearchParams`; its `key` leaves the tab out, so switching tabs keeps the one `useEmployeeEdit` and its cache.
- **Files:** `staff/[employeeId]/page.tsx` and `leave/page.tsx` → `_frame/employee-detail-route.tsx` → `pages/employee-detail-page.tsx` (shell, header, tab row, card) with `ui/employee-detail-header.tsx` (and `employee-identity.tsx` for the name and number), `-tabs.tsx`, `-body.tsx` (the card and the record's loading and error states), `-tab-content.tsx` (the tab switch) and one file per body (`-data-tab`, `-pay-tab`, `-hours-tab`, `-documents-tab`; Leave is three lines in the switch). The tab model (`EMPLOYEE_DETAIL_TABS`, labels, addresses, the unknown-tab rule) is `staff/model/employee-detail-tabs.ts`. `useEmployeeEdit` is called once, in the page. The `TODO(spec) SS-Q2` comment sits above the sections it describes, in `employee-detail-tab-content.tsx`.
- **i18n:** `leaveHistory.tabPay`, `leaveHistory.tabHours`, `leaveHistory.tabDocuments` (`ar` and `en`), beside `tabData`, `tabLeave` and `tabsLabel`, which are reused; the back link reuses `staff.cancel` («Back to employees» / «العودة إلى الموظفين»), the title reuses `staff.editTitle`, so `staff.backToList` was not needed.
- **Section props:** each section gets exactly what the old `employee-edit-panel.tsx` and `employee-record-sections.tsx` passed. `EmployeeAccessSection` gets `{ companyId, businessId, employeeId }` only (asserted), its internals untouched for track 076.

### Decisions beyond the spec text (for the manager)

1. **Reload sits in the header on every tab**, not only in Details: the old panel showed it on both tabs, and the browser test's activation-expiry step presses it from the Documents view. It is disabled while a save or the employee read is running, as before.
2. **«Edit number»** (`EmployeeNumberEdit`) moved from under the name to the header's actions, beside Reload and the back link; the name and number are the header description (the number keeps its screen-reader-only label).
3. **The back link is not disabled during a save.** `staff.cancel` was a disabled button while saving; a link cannot be disabled and the save request continues either way.
4. **Every tab waits for the employee record** (loading status, then the error state or the tab). Pay needs it for the IBAN time zone and Leave for its zone, as today; Hours and Documents wait too so that the error state is the same on every tab.
5. **`employee-number-edit.spec.tsx`** was not in the spec's list but rendered `EmployeeEditPanel`; it now renders `EmployeeDetailPage` (access section mocked so its read does not add an alert). Its ten tests are otherwise unchanged. `employee-profile-heading.tsx` is deleted: its text and number markup moved into the header.
6. **`app-map`:** the Employee detail row (`Employees (+ Create, + Employee detail)`) is already `Live` in `app-map.shared.mjs` and in `app-map.md`, so there is nothing to mark. Regenerating `app-map.md` with the script changes one unrelated row (Access › Invitations, Live → Soon) that drifted on `main`; that diff is not part of this slice and was not committed. The copy in `lolotam/lovable-pospay` was not touched.
7. **Journey:** `docs/journey/16-update-employee.md` (the employee-edit journey) is updated in Arabic and English for the new page, tabs and back link; `18`, `30`, `40`, `46`, `53` and `92` get one bilingual note saying which tab holds their section.

### Carried-assertion table (deleted files → new tests)

| Old assertion | New test |
|---|---|
| `employee-edit-panel.spec`: number shown beside the name, label `sr-only`, parent text `Employee number 15` | `employee-detail-page.spec.tsx` «shows the employee number beside the name…» and «opens on Details…» (name's parent holds `15`) |
| `employee-file-tabs.spec`: Details first, no leave section | «opens on Details…» and the `it.each` over Pay, Hours, Documents, Leave (exactly its sections) |
| `employee-file-tabs.spec`: Leave mounts only on its tab, with the employee's branch zone | the Leave row of that `it.each`, «gives the IBAN and Leave sections the employee's primary branch zone…» |
| `employee-file-tabs.spec`: waits for the record before Leave, uses the primary zone | «waits for the employee record before mounting Leave, then uses its primary zone» |
| `employee-file-tabs.spec`: Reload and Close stay on both tabs | «keeps Reload and the back link on data / leave» (Close → back link) |
| `employee-file-tabs.spec`: unsaved Details edits survive switching tabs | **changed**, see below |
| `employee-edit-actions`: Reload disabled while saving or fetching | «reload clears the save message and reads the employee again» waits for it to be enabled; the disabled state is `busy` in the header (not separately asserted, as before) |
| `employee-record-sections`: the props each section receives | `employee-detail-page.spec.tsx` asserts the access, salary and IBAN props and the `UTC` fallback; `employee-detail-requests.spec.tsx` runs the real sections |
| `employee-profile-heading`: title, name, number, number edit | `employee-detail-page.spec.tsx` (title, name, number) and `employee-number-edit.spec.tsx` (the number edit through the page header) |
| `employee-number-edit.spec`: ten tests | same ten tests, host changed to `EmployeeDetailPage` |

### Changed assertions

| Where | Change | Reason |
|---|---|---|
| `employee-file-tabs.spec`, «keeps unsaved details edits when switching tabs back and forth» | Now «discards unsaved Details edits when another tab is opened and Details is opened again» | Decision 5 of this spec: sections mount only while their tab is shown; no confirm dialog in this slice (follow-up on #1192) |
| `employees-page.spec`, first test | «Edit» is a link to `/staff/<id>`, not a button; no inline card; the «clears selection on next/first page» expectations are gone | Nothing is selected on the list any more; paging is asserted as before |
| `employees-page.spec`, «closes the open employee editor when a search settles» | Removed | There is no inline editor to close |
| `employees-page-layout.spec`, «stacks the rows under 600px…» | The last cell's «Edit» is found by role `link`, not `button` | Same control, now a link (`asChild`), same accessible name |

### Browser test steps changed (`apps/admin/e2e/employee-document-popup.pw.ts`; not run locally)

Nothing in a popup, hold, release, ledger or reconnect assertion changed.

1. `chooseStaff`: «Edit» is found as a **link** in a table row (was a button), then the new `openEmployee` helper opens the **Documents** tab (link in the tab row named `leaveHistory.tabDocuments`, exact, inside the tabs navigation so Arabic «الوثائق» cannot match «أنواع الوثائق») and expects the same level-3 Documents heading.
2. «employee change, panel unmount and workspace change…»: the second «Edit» (`nth(1)`) is now `backToList` (the back link, `staff.cancel`) then `openEmployee(page, 1)`; «Cancel» is `backToList`; the third «Edit» (`first()`) is `openEmployee(page, 0)`. The employee change is therefore reached by leaving the page (unmounting Documents) and opening another employee; the workspace-change leg now runs on the employee page.
3. «old settlement cannot navigate a successor…»: the `nth(1)` «Edit» is `backToList` then `openEmployee(page, 1)`.
4. `expiryWithoutOpening` still presses `staff.reload`, which stays on the Documents view (decision 1).

The fixture's route table needs no change: the Documents view requests the employee, `employee-number-capability` and the documents reads, all in the inventory; the other tabs' reads are not made.

### Request timing observed

Old: after the employee read, the Details column mounted all six sections and fired salary, IBAN, default hours, card, documents and staff-access reads together, plus the number capability. New (`employee-detail-requests.spec.tsx`, real sections): the employee read, the number capability (header, every tab) and the shown tab's own reads only — Details: staff access; Pay: salaries, IBAN; Hours and card: default shifts, cards; Documents: documents; Leave: leave requests. A change in timing, not in behaviour; say so in the PR.

### Not verified

Widths, stacking, 44px targets and the Arabic layout in a browser; the tab row's soft navigation in the real Next router (the unit test mocks `useRouter`); the Playwright flow (CI job `admin document popup · production browser`); the regenerated map copy in `lolotam/lovable-pospay`.

### Sizes

Added plus removed lines against `origin/main` (`git diff --cached --numstat` before the commit; the spec file itself, new in this commit, counts as docs):

| Kind | Added | Removed | Total |
|---|---|---|---|
| Production code | 430 | 331 | 761 |
| Tests (specs, fixture, browser test) | 670 | 324 | 994 |
| Docs (this spec, `pr-sequence.md`, journey) | 187 | 7 | 194 |

Code plus tests: **1,755**, under the 1,800 cap but over the 1,400 line of the stop rule. The count includes the 332 removed lines of the deleted panel, tabs, actions, sections, heading and their two specs, and the 84 removed from the ported specs; the stop line was passed while carrying those assertions and porting `employee-number-edit.spec.tsx` (step 4), and the work was finished rather than split because nothing in the stop conditions (a change inside a section, `packages/ui`, `src/session/**` or the frames) was met.
