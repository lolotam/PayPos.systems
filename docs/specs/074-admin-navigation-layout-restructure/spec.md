# Feature Specification: Admin navigation — three switchable styles

**Feature Branch**: `feat/074-nav-styles`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "Add the three navigation styles A, B and C to the admin app. List them by name in Settings so any user can switch at any time and the whole front end changes at once. C is the default. Open to everyone, no permission. Save the choice on the user's account. Same colours and fonts for all three. Release the three together." (Waleed, 2026-11-21, `owner-questions.ar.md` NAV-Q1, NAV-Q6 to NAV-Q10, NAV-Q12.)

Supporting documents in this folder: `app-map.md` (every section, sub-menu and page of the whole product, phases 1 to 6, and which are built), `design.md` (the problem list with evidence, sizes per style, the route map of built pages, layout rules), `owner-questions.ar.md` (the owner's answers, verbatim), `prototypes/` (clickable A, B and C).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a page through an organised menu (Priority: P1)

A manager opens the admin app and finds every page under a small number of named groups instead of one long unordered list. The current page is always marked, on a desktop, a tablet and a phone, in Arabic and in English.

**Why this priority**: This is the complaint that started the work. Without it there is nothing to switch between.

**Independent Test**: Sign in, open each page from the menu in the default style, and confirm one group is marked current each time, at three screen widths and in both languages.

**Acceptance Scenarios**:

1. **Given** a signed-in user who has never chosen a style, **When** the app opens, **Then** it shows style C: five workspaces on a rail and a panel listing the current workspace's pages.
2. **Given** any admin page, **When** the user looks at the menu, **Then** exactly one top-level entry is marked current, including on Staff app columns and on the Authenticator page.
3. **Given** any admin page, **When** the user wants another page, **Then** they reach it in at most three clicks or taps, on a phone too, starting from a different section.
4. **Given** a phone-width screen, **When** the user opens the app, **Then** the main destinations are in a bottom bar in styles A and C and in a drawer in style B, and no page scrolls sideways.
5. **Given** Arabic is selected, **When** the app opens, **Then** the menu sits on the right and direction icons are mirrored.
6. **Given** a user whose permissions hide some pages, **When** the menu is drawn, **Then** those pages are absent and a group left with no pages is not shown.

---

### User Story 2 - Choose another style (Priority: P1)

Any signed-in user opens Appearance and picks style A, B or C by name. The frame around the page changes at once. The same choice is offered in the account menu.

**Why this priority**: The owner asked for all three styles to be available together, with the user choosing. It is released with Story 1.

**Independent Test**: Open Appearance, pick each style in turn, and confirm the frame changes each time while the address stays the same.

**Acceptance Scenarios**:

1. **Given** the Appearance page, **When** the user looks at it, **Then** three choices are listed as "A — Sidebar and tabs", "B — Top bar and hubs" and "C — Rail and panel", and the current one is marked.
2. **Given** style C is showing, **When** the user picks A, **Then** the frame becomes a sidebar with tabs without a full page reload and the address does not change.
3. **Given** a user with no permission beyond being signed in, **When** they open Appearance, **Then** they can see it and change the style.
4. **Given** the user picked B, **When** they reload the page, **Then** the first thing drawn is style B, with no other style shown first.
5. **Given** any address in the app, **When** it is opened under A, B or C, **Then** the same page is shown; only the frame differs.
6. **Given** a user is on an overview page that only their current style has, **When** they switch style, **Then** they are taken to the first page of that group they may see, or to Home if there is none.

---

### User Story 3 - The choice follows the user (Priority: P2)

A user who chose a style on one computer signs in on another and sees the same style.

**Why this priority**: The owner asked for the choice to be saved on the account. It needs a database change, so it is released after Stories 1 and 2 (NAV-Q12); until then the choice is kept on each device.

**Independent Test**: Choose a style in one browser, sign in as the same user in a second browser with no stored data, and confirm the same style appears.

**Acceptance Scenarios**:

1. **Given** a user chose style A in one browser, **When** they sign in on another browser, **Then** style A is shown.
2. **Given** user X chose style A and signed out, **When** user Y, who has never chosen, signs in on the same browser, **Then** user Y sees style C.
3. **Given** saving to the account fails, **When** the user picks a style, **Then** the frame still changes, the choice is kept on this device, and a message says it was not saved to the account.
4. **Given** two users in the same company, **When** one changes style, **Then** the other's style does not change.

---

### User Story 4 - Pages that are laid out the same way (Priority: P3)

Lists, forms, detail pages and boards follow one layout each: one page width, one header pattern, one place for filters and actions. Tables turn into stacked cards on a phone. The employee card becomes a page with tabs.

**Why this priority**: It completes "arranged, not haphazard", but the menus deliver value without it and each area can be done on its own.

**Independent Test**: Open one page of each kind at three widths and compare against the layout rules in `design.md` §6.

**Acceptance Scenarios**:

1. **Given** a list page on a phone, **When** it is opened, **Then** each row is a card whose first column is the title and other cells are labelled.
2. **Given** a form page, **When** it is opened on a desktop, **Then** it is no wider than the form width and the main action is last in the action bar.
3. **Given** the employees list, **When** the user opens an employee, **Then** a page opens with tabs for Details, Pay, Hours and card, Documents and Leave.
4. **Given** the Weekly schedules page, **When** the user wants the shift limits, **Then** they are on their own Schedule settings page, linked from the Weekly schedules header.

---

### User Story 5 - See the whole product in the menu (Priority: P1)

The menu names every section of the product, including the ones not built yet: sales and POS, catalog and stores, customers and marketing, team, reports and money, setup. A page that is not built yet carries a "Soon" mark and opens an Under development page.

**Why this priority**: The owner asked for the complete section names now, so the product's shape is visible and each later feature has a place waiting for it. It is released with Stories 1 and 2.

**Independent Test**: Open every entry in the menu. Built pages open as before; every other entry opens the Under development page with that entry's name.

**Acceptance Scenarios**:

1. **Given** the menu in any style, **When** the user looks at it, **Then** every section and sub-menu of `app-map.md` is present.
2. **Given** an entry for a page that is not built, **When** the user looks at it, **Then** it carries a "Soon" mark that is also announced to screen readers.
3. **Given** such an entry, **When** the user opens it, **Then** an Under development page shows the entry's name, one line saying it is under development, and a way back to Home. It shows no date and no phase number.
4. **Given** a page is built later, **When** a user opens an old link to its Under development address, **Then** a user who may see the page is forwarded to it and a user who may not gets the not-found page.
5. **Given** style C's page finder, **When** the user searches for a page that is not built, **Then** it is found and marked "Soon".

---

### Edge Cases

- A new admin page is added later: it must appear in all three styles. A page present in one style only is a failed build, not a runtime surprise.
- A link to an overview page of style B is opened by a user on style A: they land on the first page of that group they may see; if the group is unknown or nothing in it is visible to them, on Home.
- The user picks A and then B before the first save has finished: the account ends with B.
- The account cannot be read at sign-in: the user signs in normally and starts on C.
- The stored choice is not A, B or C (old or damaged value): the app shows C.
- The user switches style in one tab while another tab is open: the other tab keeps its frame until its next navigation or reload.
- Permission checks for menu items are still loading: the frame is drawn at once; items appear when their check resolves; no group flashes empty.
- A page holds unsaved input while the user switches style from the account menu: the page may be drawn again, so the input is not guaranteed to survive. The Appearance page itself holds no other input.
- The owner's theme choice (light, dark, system) and language choice are unaffected by switching style.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The admin app MUST offer three navigation styles, A (sidebar and tabs), B (top bar and hubs) and C (rail and panel), as described in `design.md` §4.
- **FR-002**: All three styles MUST use the same colours, fonts, corner radius and button styles as the app has today.
- **FR-003**: A user who has never chosen MUST see style C.
- **FR-004**: The app MUST provide an Appearance page that lists the three styles by name, marks the current one, and lets the user pick another. The same choice MUST be available from the account menu.
- **FR-005**: Any signed-in admin user MUST be able to open Appearance and change the style. No permission guards it.
- **FR-006**: Picking a style MUST change the frame at once, without a full page reload and without changing the address.
- **FR-007**: The first frame drawn after a reload MUST be the user's saved style.
- **FR-008**: Every existing admin address MUST keep working and show the same page under every style. No existing address changes.
- **FR-009**: Every admin page MUST appear exactly once in the menu of each style, and exactly one top-level entry MUST be marked current on every page.
- **FR-010**: A page hidden from a user by an existing permission or condition today MUST stay hidden in every style; a group with no visible page MUST not be shown.
- **FR-011**: The choice MUST be remembered on the device from the first release, and saved on the user's account in a following release, after which it follows the user to other devices.
- **FR-012**: Signing out MUST clear the device's remembered choice, and signing in MUST set it from that user's own choice or clear it, so the next person on that browser never inherits it, including after a session that expired.
- **FR-013**: The account choice MUST be personal: one user's choice never changes what another user sees.
- **FR-014**: In styles B and C the light, dark and system switch MUST be available on the Appearance page and in the account menu. Its place in style A waits for NAV-Q5 (`TODO(spec)`).
- **FR-015**: All of the above MUST hold on desktop, tablet and phone widths, in Arabic (right-to-left) and English.
- **FR-016**: Admin pages MUST follow the shared layout rules in `design.md` §6 (page width, header, filters, forms, stacked table rows on phones).
- **FR-017**: The two defects found during mapping MUST be fixed: Staff app columns marks its own entry, not Employees; the Reload button on Weekly schedules no longer reads "Reload employee".
- **FR-019**: The menu MUST list every section, sub-menu and page in `app-map.md`, in all three styles.
- **FR-020**: A page that is not built yet MUST be marked "Soon" in the menu, and the mark MUST not rely on colour alone.
- **FR-021**: Opening a not-built page MUST show one shared Under development page with the page's name and a way back to Home, in Arabic and English, with no date and no phase number.
- **FR-022**: Who sees not-built entries MUST follow one rule in the menu, the page finder and direct links. The owner asked for every section to be shown (NAV-Q13); whether that is every user or follows business type and role is open (NAV-Q14), and its answer is required before the styles are released. Once a page is built, its own permission decides.
- **FR-023**: When a page is built, switching its entry to the real page MUST be a change to that entry alone, and its old Under development address MUST apply the entry's show condition before forwarding to the real page.
- **FR-024**: Menus, drawers, sheets and the page finder MUST keep keyboard focus inside while open and return it to the control that opened them; every icon-only control MUST have an accessible name; in-page tabs MUST expose which tab is selected; a hidden panel MUST take its links out of the tab order; a menu taller than the window MUST scroll inside itself.
- **FR-025**: Choosing styles in quick succession MUST leave the account holding the last choice made.
- **FR-018**: The cashier app is in the owner's scope but out of this feature; it gets its own specification (`TODO(spec)`, NAV-Q3, NAV-Q11).

### Key Entities

- **Navigation style**: one of A, B, C. A way of arranging the same pages into groups and levels.
- **Page entry**: one admin page as the menu knows it: its name, address, icon, the condition that shows it, where its pending count comes from, and whether it is built or still to come.
- **Grouping**: for one style, which page entries sit under which top-level entry and section. Three groupings over one list of page entries.
- **Style preference**: a user's chosen style. One per user; absent means the default.

## Slice design *(mandatory — `CLAUDE.md` §1)*

This feature is mostly front end. It is delivered as several PRs (see `plan.md`); only the account preference touches the database and the API.

### Business rules

- **BR-001**: The default style is C (NAV-Q1).
- **BR-002**: Choosing a style needs no permission; every signed-in admin user may do it (NAV-Q1).
- **BR-003**: The choice belongs to the user, not to the company, business or branch (NAV-Q6).
- **BR-004**: The three styles differ in arrangement only; colours and fonts are shared (NAV-Q7).
- **BR-005**: The three styles are released together; saving on the account follows (NAV-Q8, NAV-Q12).
- **BR-006**: Existing permission rules decide which built pages a user sees in the menu; this feature adds and removes none.
- **BR-007**: The menu names the whole product, phases 1 to 6; a page not built yet opens an Under development page (NAV-Q13).
- **BR-008**: "Social media management" was asked for by the owner but is not in the PRD. Whether it is listed as an Under development entry or left out is NAV-Q15, unanswered: `TODO(spec)`.

### Schema changes

| Table | Columns added / changed | RLS policy (`FOR SELECT` / mutations) | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `user` (global identity, ADR-0003) | `nav_style text NULL`, with a check that it is `'A'`, `'B'` or `'C'` when set. `NULL` means the default | None: a global identity table with no tenant RLS, reached only through `packages/auth` on the `pospay_auth` role. Needs an ADR-0003 addendum before the migration (CLAUDE.md §5). No new grant | None: read by primary key | None |

Expand only: one nullable column, no backfill, nothing destructive (NAV-Q10: «عمود على جدول user»).

### API contract

- **Endpoint**: `GET /v1/me/preferences` and `PUT /v1/me/preferences` · guard `@Authenticated()` (session-only, personal to the caller, `principal.userId` required; the write is registered in `AUTHENTICATED_WRITES`, PP-7.1) · feature flag none
- **Request / response**: Zod schema in `packages/contracts/src/identity/me-preferences.ts` — `{ navStyle: 'A' | 'B' | 'C' | null }`
- **Idempotency-Key**: not required; no money or stock effect, and a repeated write gives the same result
- **Errors**: `VALIDATION_FAILED` → a value other than A, B, C · `UNAUTHENTICATED` → no session or a staff-purpose session · `FORBIDDEN` → a device token

The read and write go through `packages/auth`, the only package that may reach the identity tables. No other module reads the column. The `GET` follows the read path of CLAUDE.md §6: a file under the `identity` module's `queries/` that calls the reader `packages/auth` exports, with no use case in between.

### Permissions

- None added. Appearance and the preferences endpoint are open to any signed-in admin user.
- Staff-purpose sessions (cashier app) are refused before the controller, as on other admin routes (CLAUDE.md §8); a device token is refused because it has no user.

### Events

- **Published**: none
- **Consumed**: none

Audit: not settled. CLAUDE.md §8 asks for an audit entry on every settings change and names no exception for a personal display choice. NAV-Q16 asks the owner for an audit entry or a recorded exception, before the account preference is built.

### Test plan

- **Domain unit**: none; no business arithmetic.
- **Front end, navigation model**: table-driven over the three groupings — every admin route appears exactly once; exactly one top-level entry is current on every route; every label key exists in Arabic and English; every hide-condition asserted by today's `*-nav-item.spec.tsx` and `staff-navigation.spec.tsx` files is carried over before those files are removed.
- **Front end, not-built pages**: every entry of `app-map.md` is in the model; every not-built entry renders the "Soon" mark in each style; the Under development page shows the entry's name in both languages; an unknown `/soon/...` address shows the app's not-found page; a built entry's old `/soon/...` address forwards.
- **Front end, rendered**: one test per style asserting the visible current item; switching style changes the visible frame and keeps the route; default is C; an unknown stored value shows C; a user with no permissions can switch; sign-out clears the device choice; choosing A then B while the first save is delayed ends with B on the account; a failed account read at sign-in clears the device choice and shows C; an old `/soon/...` link to a built page the user may not see shows not-found; an overview link with no visible page goes to Home; at 390px a page in a section behind More is reached in three taps from another section; after a session that expired without sign-out, the next user with no saved choice sees C; the Authenticator page is drawn inside the frame with its entry current; the server-rendered frame matches the stored choice.
- **Integration scenarios**: `PREF-01` read with nothing saved returns null · `PREF-02` write then read returns the value · `PREF-03` invalid value rejected · `PREF-04` user X's write does not change user Y's value · `PREF-05` no session is refused (401) · `PREF-06` a staff-purpose session is refused (401) · `PREF-07` a device token is refused (403) · `PREF-08` an existing user signs in, and a user is created through the existing operator path, after the migration (public sign-up is disabled and stays so) · `PREF-09` two writes sent one after the other end with the second value.
- **RLS negative**: not applicable; no tenant table is added. `PREF-04` covers isolation between users.
- **Queries**: one read for `GET /v1/me/preferences`, with a result-shape test. It reads one row by primary key through `packages/auth`; the `EXPLAIN` assertion required for `queries/` files applies to it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any admin page, any other page is reached in at most three clicks or taps, in each of the three styles, at desktop, tablet and phone widths.
- **SC-002**: The top level of the menu has at most seven entries in every style, down from about 25 links in one list today, while naming the whole product.
- **SC-009**: 100% of the pages in `app-map.md` are present in each style; every one that is not built opens the Under development page.
- **SC-003**: A user changes style in two clicks from any page, and the new frame is visible in under one second.
- **SC-004**: 100% of admin pages are reachable in each of the three styles, and exactly one menu entry is marked current on each.
- **SC-005**: At 1280, 820 and 390 pixels wide, no admin page scrolls sideways, in Arabic and in English.
- **SC-006**: Every button and menu target is at least 44 pixels in both directions.
- **SC-007**: After the account release, a user who signs in on a second device sees their chosen style on the first screen, with no other style shown first.
- **SC-008**: No colour, font or button style differs from before the change.

## Assumptions

- The page list is the one on `main` at `cf70114e2`; pages added later are placed in all three styles by the task that adds them.
- "Settings" in the owner's words means a new Appearance page under the setup area plus the account menu; the admin app has no general settings page today.
- A device-kept choice between the first release and the account release is acceptable (NAV-Q12).
- Overview pages that only styles B and C use are new addresses; they are not counted as existing pages.
- "Built" means an admin route exists on `main` at `cf70114e2`. A page whose back end is merged but which has no admin route is listed as not built.
- The names of not-built sections and pages in `app-map.md` are working names taken from the PRD; each is confirmed when its own feature is specified.
- The prototypes show the built pages only; the full map has not been prototyped, so the fit of the longest sections (more than 15 pages each) in each style is not yet seen on screen.
- Navigation counts (pending leave, attendance requests, open exceptions) are shown only if existing reads can supply them cheaply; otherwise they are left out of the first release. Not verified.
- The page finder in style C uses components the app already has; if a new library is needed, an ADR comes first.
- `lovable-pospay` is a separate project with its own spec and plan in its own repository (NAV-Q2); nothing here applies to it.
- The cashier app, the `--primary` difference (NAV-Q4) and the theme-switch ADR addendum (NAV-Q5) are tracked in `owner-questions.ar.md` and do not block this feature's first steps.
