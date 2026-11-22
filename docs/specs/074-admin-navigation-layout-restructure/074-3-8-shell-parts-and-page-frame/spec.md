# Shared shell parts and the page frame

**Delivery** 074-3 + 074-8, one implementation PR. Parent documents: [spec.md](../spec.md) (FR-002, FR-015, FR-016, FR-024), [design.md](../design.md) §4, §6 and §7, [pr-sequence.md](../pr-sequence.md) rows 3 and 8. See the [implementation plan](plan.md).

**Status of the grouping.** The manager's assignment of 2026-11-22 states that the owner approved 074-3 and 074-8 in one PR, with the 074-7 release separate. That approval is not yet written in `owner-questions.ar.md` or `docs/owner-decisions.ar.md` on `main` at `a32a6a211`, and `pr-sequence.md` still lists steps 3 and 8 as two PRs with step 8 after step 7. The manager records the verbatim answer and its PP number; this spec does not quote it.

## What changes for a user

Seven shared parts are added to the component kit. None of them is placed in the running dashboard here: the frames that use them go live together in 074-7.

Three existing pages are laid out on the shared page templates as the reference for every later page (074-9 to 074-11). This is the first change of spec 074 that an admin user can see.

| Reference | Page | Address | Why this page |
| --- | --- | --- | --- |
| List | Services | `/catalog` | It already has a header action, a category filter, a table and paging, so every slot of the list template is exercised by something that exists today |
| Form | Add service | `/catalog/create` | A form-only page, 576px wide today |
| Two-column | Business identity | `/business-identity` | Named for this template in `design.md` §6; its official-names form and logo panel are two separate blocks today. Record a visit is also named there but belongs to 074-9 (sticky summary) |

## User scenarios and acceptance

| Story | Given and action | Observable result |
| --- | --- | --- |
| P1 · Read a list on a phone | Open Services at 390px wide, in Arabic and in English. | Each service is a stacked card. The service name is the card title. Every other value has its column label above it. The page does not scroll sideways. The row's action is still reachable and at least 44px tall. |
| P1 · Read the same list on a desktop | Open Services at 1280px. | The page is centred and no wider than 1200px. One card holds the category filter, the table and the paging buttons, in that order. The header shows the title, a one-line description and the Add service action at the inline end. |
| P1 · Fill a form | Open Add service at 1280px, then at 390px. | The page is centred and no wider than 840px. Fields sit in one card; the save action is last, at the card foot. On a phone the fields stack in one column. Saving, the validation message and the success message behave as before. |
| P2 · Edit identity beside the logo | Open Business identity at 1280px, then at 1024px and 820px. | At 1280px and 1024px the official names are in the wider column and the logo in the narrower one. At 820px the logo block follows the names block at full width. Loading, refusal, retry, save and logo upload behave as before. |
| P2 · Choose a workspace (component, in isolation) | Activate the workspace button, pick another branch. | The button shows the business and the branch. It opens Company, Business and Branch. Business is disabled until a company is chosen, Branch until a business is chosen. The choice is reported to the caller; Escape closes and returns focus to the button. |
| P2 · Open the account menu (component, in isolation) | Activate the account button, move with the keyboard, press Escape. | The menu shows the name and the email, then the supplied entries in the order given (Authenticator, Appearance, navigation style, theme, Sign out). Focus stays inside while open and returns to the button on close. |
| P3 · Move between sibling pages (component, in isolation) | Render a tab row, a pill strip and a bottom bar with one current item. | Exactly one item is marked current in each. A count shows beside its item; a missing count shows nothing. A Soon item carries its text mark. With more items than fit, the row scrolls inside itself. |
| P3 · Pick a page from an overview (component, in isolation) | Render overview cards with and without a count and a Soon mark. | Each card is one link with its icon, title and one-line description; the whole card is the target. |

### Edge cases

- A table that does not opt in to stacked rows looks and behaves exactly as today at every width.
- A stacked row whose cell has no label shows the value alone; nothing shows an empty label.
- A header with no description, or with no action, leaves no empty gap.
- A list page while loading, on error and when empty keeps its current messages; the filter stays visible so the user can change it.
- A workspace with one company, one business and one branch still opens and shows all three.
- An account with no name shows the email alone; with neither, the menu still opens.
- A bottom bar with an extra "More" entry reports the press to its caller; the sheet it opens is assembled in 074-7.
- A long Arabic label is cut with an ellipsis and never widens its row.
- When the category list fails to load, the Services filter shows nothing today; the card then has no empty filter bar above the table.
- When Business identity shows the logo block without the names block, the logo block takes the main column and is not left alone in the narrow one.
- The inline edit panel that opens under the Services list stays where it is, below the list card, with its current width; it moves in 074-9.

## Requirements

1. **Kit parts (074-3).** `WorkspaceSwitcher`, `AccountMenu`, `NavTabs`, `Pills`, `BottomNav`, `HubCard` and `PageShell` exist in the component kit and render in isolation from supplied, already translated text. The kit owns no user-facing string.
2. **Navigation, not in-page tabs.** `NavTabs`, `Pills` and `BottomNav` are lists of links to pages inside a named navigation landmark; the current one is exposed as the current page. In-page tabs that switch content without changing the address (the employee detail of 074-10, the "which tab is selected" clause of FR-024) are not built here.
3. **Decisions stay with the caller.** Which items exist, their order, addresses, counts, the Soon mark, and what a business type, country, role or permission hides are decided by the admin app. The parts never read a route, a session or a workspace.
4. **Sizes** from `design.md` §4 and §6: tab row 48px; pills, menu rows and every other target at least 44px in both directions; bottom bar 64px with at most five entries; list pages at most 1200px and form pages at most 840px, both centred; section gap 24px, 16px under 768px.
5. **Page padding is not moved here.** The frame's content padding stays as it is on `main`; `design.md` §6's 24px/16px page padding arrives with the frames in 074-7. `PageShell` owns width and gaps only, so no page is padded twice.
6. **Page header.** Title, an optional one-line description, one primary action at the inline end, and optional further actions before it. The 65-character width cap on the description applies only to a header placed inside `PageShell`, so it reaches a page when that page is moved to a template. The 24 other pages that use the header keep their appearance and are not edited.
7. **Table frame.** Optional filter area above the table and footer area below it, inside the same card. Stacked rows under 600px are opt-in per table: the first cell is the card title and each other cell shows its label above its value. The 18 other tables that use the frame keep their appearance and are not edited.
8. **Two-column template.** Main 2 parts and side 1 part from a 1024px viewport, stacked below that, main first. A lone block takes the main column.
9. **Look.** No colour, font, radius or button-variant change (FR-002, SC-008). Logical inline properties only. Directional icons mirror in Arabic; icons follow ADR-0060.
10. **Access.** Every icon-only control has an accessible name from the caller. Open menus keep focus inside, close on Escape and return focus to their opener. Motion uses the kit's presets and stops under reduced motion (FR-024, `design.md` §7).
11. **Behaviour of the three pages is unchanged.** Addresses, permissions, data reads, validation, messages and every existing test assertion about them stay. Only layout changes.

## Slice design

**Data and rules.** Presentation only. No schema, RLS policy, index, migration, API, contract, idempotency key, event, audit entry, permission or feature flag. No storage, cookie, analytics or new dependency.

**Not in this PR.** The dashboard frame, the style switch, the Appearance page, the new routes and the removal of the theme switch from the sidebar footer (074-7). The parts of 074-4, 074-5 and 074-6 and their browser fixture. In-page tabs (074-10). Every admin page other than the three above (074-9 to 074-11). The account preference and its migration (074-12). `apps/pos`. `lolotam/lovable-pospay`.

**Strings.** The kit takes text from its caller. The account-menu and frame labels already exist in `packages/i18n/src/admin-nav-catalog.ts` (`accountMenuLabel`, `accountMenuStyle`, `accountMenuTheme`, `more`, `back`) and are not wired here. The three pages reuse their existing keys; column labels on stacked rows reuse the column-header keys. A new key is allowed only for a form section title that has no existing key, in Arabic and English together.

**Test plan.** Rendered component tests for each of the seven parts and for the header, the table frame and the page shell, asserting what the user sees: current item, open and closed, disabled state, count present and absent, Soon mark, RTL and LTR. Rendered page tests for the three reference pages asserting the visible structure (filter, table and paging inside one card; save action last; names before logo) with every existing assertion kept. Widths, stacking under 600px and 44px targets are CSS outcomes that a DOM test cannot measure; they need a real browser at 390, 820, 1024 and 1280px in both directions. The plan says which of these run in CI and which are a recorded manual review. No domain unit, integration, RLS-negative or `EXPLAIN` test applies: no back-end code changes.

**Independence from 074-7.** The three pages render inside today's frame. `apps/admin/src/shared/frame/app-frame.tsx` wraps every page in a padded `<main>` and does not constrain width; each page sets its own width and gap today (`max-w-xl` on `create-service-page.tsx`, `gap-8` on `services-page.tsx` and `business-identity-page.tsx`). Moving that into `PageShell` needs nothing from the new frames. `design.md` §6 states that the page templates do not depend on the style. No reference page depends on 074-7.

## Success criteria

- A person can read every value of a service on a 390px screen without scrolling sideways, in Arabic and in English.
- At 1280, 820 and 390px no reference page scrolls sideways; only a table scrolls inside its own frame.
- Every control added or moved is at least 44px in both directions.
- The 24 other pages using the header and the 18 other tables using the frame look the same as before.
- No colour, font, radius or button variant differs from `main`.
- Each of the seven parts can be shown alone with supplied text and has exactly one current item when one is supplied.

## Assumptions

- "One list page, one form page and one two-column page" (`pr-sequence.md` row 8) leaves the choice of pages open; the three above were chosen for the reasons in the table. 074-9 and 074-11 then skip them.
- The owner confirmed the 1024px viewport rule in `design.md` §6. The current sidebar leaves about 215px for the side column at that width. The logo controls must fit it and remain usable.
- The three visible layout changes are recorded in journey 101 under PP-196.4.
