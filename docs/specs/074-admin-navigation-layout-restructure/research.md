# Research: Admin navigation — three switchable styles

Checked against `origin/main` at `cf70114e2` on 2026-11-21. Each entry says what was decided, why, and what else was considered. "Checked" names the file read; "not checked" is said where it applies.

## R1. How three styles share one set of pages

- **Decision**: One typed list of page entries and three groupings over it. The three frames read the same list.
- **Rationale**: The three prototypes already work this way (`prototypes/src/data.js` plus one navigation file per style), and a test over the list catches a page added to one style only.
- **Alternatives considered**: Three independent menus (drift is certain); one frame with three skins (the styles differ in structure, not in looks).

## R2. Where the navigation model lives

- **Decision**: Each business area exports its page entries from `apps/admin/src/<area>/`, with their show conditions and their section and sub-menu. `apps/admin/app/(dashboard)/_frame/navigation-model.ts` only composes them and holds the three arrangements of sections; it carries no visibility rule of its own.
- **Rationale**: CLAUDE.architecture.md §11.2 puts cross-area composition in `app/`; §6.4 forbids business meaning in `src/shared`. Checked: both sections.
- **Alternatives considered**: `src/shared/frame/navigation-model.ts` (rejected by §6.4; this was the first draft's location).

## R3. Where the style choice is stored

- **Decision**: A nullable `nav_style` column on the global identity table `user`, with a browser cookie `pospay_nav_style` as a first-paint cache.
- **Rationale**: The owner chose "saved on the user's account" (NAV-Q6) and "a column on `user`" (NAV-Q10). The choice belongs to the person, not to a company. Checked: `packages/db/schema/identity-auth.ts` has no preference column today; migration `0008_2026-09-23_identity-auth-grants.sql` grants `pospay_auth` table-level access to `user`, so a new column needs no new grant.
- **Alternatives considered**: A new table keyed on the user through `withUser` (needs its own policies and an isolation test; more than one value needs); a row per membership (the choice would differ per company, against NAV-Q6); device only (against NAV-Q6).
- **Owed**: an ADR-0003 addendum classifying the column before the migration (CLAUDE.md §5). The table already carries a column outside Better Auth's declared user fields (`phoneBindingApprovedAt`), so an extra nullable column has a precedent; the read and write still touch this one column only, keyed on the session's user, and sign-up and sign-in are tested after the migration.

## R4. How the server knows the style on first paint

- **Decision**: Read a `pospay_nav_style` cookie in the server layout, the way `apps/admin/src/shared/locale/request-locale.ts` reads `pospay_locale`. Unknown or missing value means C.
- **Rationale**: Avoids a flash of the wrong frame and needs no API call before rendering. Checked: `locale-cookie.ts` and `request-locale.ts` exist and follow this pattern.
- **Alternatives considered**: `localStorage`, as the theme uses (`packages/ui/src/theme-switch.tsx`): the server cannot read it, so the wrong frame would show first. Fetching the account value during render: ties every page load to an extra call.

## R5. Keeping the cookie from leaking between users

- **Decision**: The cookie is set from the account before the app navigates into the dashboard, on both sign-in paths (password and TOTP): written when the account has a value, cleared when it has none. A successful sign-out clears it too. This covers a session that expired without a sign-out. The server reads cookies per request, and the account read is not cached.
- **Rationale**: The cookie belongs to the browser, not the person. Without this the next user on a shared computer inherits the last user's style, which breaks "a user who has never chosen sees C".
- **Checked**: the two sign-in paths are `apps/admin/src/session/api/use-sign-in.ts` and `use-verify-totp.ts`; sign-out is `use-sign-out.ts`; `server-session.ts` shows the per-request cookie read and uncached fetch to follow. Before step 12 there is no account value, so sign-in clears the cookie and the user starts from C on a browser where they signed out or their session expired.

## R6. New libraries

- **Decision**: None.
- **Rationale**: `packages/ui` already depends on `radix-ui` 1.6.7, which provides tabs, dialog, popover, navigation menu and accordion. Style C's page finder is a dialog with a filtered list of page entries; it does not need a command-palette library. Checked: `packages/ui/package.json`.
- **Alternatives considered**: A command-palette package (would need an ADR under CLAUDE.md §11; not justified for filtering about 30 entries).
- **Risk**: if the implementer finds the Radix parts insufficient, the ADR comes before the library, not after.

## R7. The endpoint

- **Decision**: `GET` and `PUT /v1/me/preferences` on the existing `me` controller of the `identity` module, session-only (`@Authenticated()`).
- **Rationale**: The controller already holds `me/workspaces` and `me/memberships` with the same guard. The decision is personal to the caller, which is the case CLAUDE.md §6 allows for a session-only route; the write is registered in `AUTHENTICATED_WRITES` (`apps/api/src/modules/identity/http/route-coverage.ts`), which is how PP-7.1 is enforced. Both routes require `principal.userId`, as `me/workspaces` does: a device token has none and gets `FORBIDDEN`. Checked: `apps/api/src/modules/identity/http/me.controller.ts`.
- **Alternatives considered**: A permission-guarded route (the owner said no permission); writing through Better Auth's client-side `updateUser` (bypasses the project's contract and error envelope).

## R8. Overview pages that only some styles have

- **Decision**: One route, `/overview/[group]`, drawn from the model. If the group is not in the user's current style, send them to the first page of that group.
- **Rationale**: Existing URLs stay identical in every style; a style-only link or a mid-session switch never dead-ends.
- **Alternatives considered**: Redirect to home (loses the user's place); a route per style (three URL spaces for the same thing).

## R9. Moving the theme switch

- **Decision**: The light, dark and system switch moves to the Appearance page and the account menu.
- **Rationale**: Styles B and C have no sidebar footer. ADR-0059 places the switch in the sidebar footer, so an addendum is owed (NAV-Q5).

## R10. Navigation counts

- **Decision**: Show pending counts only where an existing read already returns them; otherwise leave them out of the first release.
- **Not checked**: whether the leave, attendance-request and exception list endpoints can supply a count cheaply. This is the one open technical unknown; it does not block any step before 7.

## R11. Release order

- **Decision**: The three styles are released together in one PR (step 7) with the choice kept on the device; saving on the account follows as its own Heavy PR (step 12).
- **Rationale**: Owner answers NAV-Q8 and NAV-Q12. The front end does not wait on the migration lane.

## R12. Cashier app

- **Decision**: Out of this feature; a separate specification.
- **Rationale**: `apps/pos` has no navigation menu (its screens change by state), its people use staff sessions bound to a device (ADR-0019, ADR-0027), and an employee is not always linked to a user account, so "saved on the account" has no settled meaning there yet (NAV-Q11).
