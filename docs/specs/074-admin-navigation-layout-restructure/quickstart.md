# Quickstart: verifying the three navigation styles

How to prove the feature works. Details of the data are in [data-model.md](data-model.md); the endpoints and cookie are in [contracts/me-preferences.md](contracts/me-preferences.md).

## Prerequisites

- The repo set up as in `docs/journey/00-local-setup.md`, with the seed data.
- An admin user to sign in with (`docs/journey/01-admin-sign-in-and-totp.md`).
- For scenario 6, a second browser or a private window.

## Automated checks

Run from the repo root. These are the local gates of CLAUDE.md §1 step 3; the full `pnpm check` is left to `ci-gate`.

```powershell
pnpm --filter @pospay/admin test
```

```powershell
pnpm --filter @pospay/ui test
```

```powershell
pnpm lint:docs
```

Expected: the navigation-model tests report every admin route present exactly once in each of the three groupings and exactly one current entry per route; one rendered test per style passes.

After step 12, the API tests for the `identity` module include scenarios PREF-01 to PREF-09. They need the test database; see the project's test-database notes before running them, and run one database suite at a time.

## Manual scenarios

Start the app with `pnpm dev` and sign in to the admin app.

1. **Default.** With no stored choice, the frame is style C: a rail of five workspaces and a panel of pages.
2. **Every page, one current entry.** Open each page from the menu. One top-level entry is marked each time, including on Staff app columns and Authenticator.
3. **Switch.** Open Appearance and pick A, then B, then C. Each time the frame changes at once, the address stays `/appearance`, and there is no full page reload.
4. **Reload.** Pick B and reload. The first thing drawn is style B.
5. **Same page, any style.** Copy the address of any page other than an overview page, switch style, paste the address. The same page opens. (Overview pages belong to one style; scenario 9 covers them.)
6. **Follows the user** (after step 12). Pick A, then sign in as the same user in a second browser. Style A is shown.
7. **Shared browser.** Pick A, sign out, sign in as a user who has never chosen. Style C is shown.
8. **No permission needed.** Sign in as a user with the fewest permissions. Appearance opens and the style can be changed.
9. **Overview fallback.** In style B open a module's overview page, then switch to A. The first page of that group opens.
10. **Three widths, two languages.** Repeat scenarios 2 and 3 at 1280, 820 and 390 pixels wide, in Arabic and in English. No page scrolls sideways; in Arabic the menu is on the right.
11. **Whole product in the menu.** Compare the menu with `app-map.md`: every section and sub-menu is there. Open three entries marked "Soon" from different sections; each shows the Under development page with that entry's name and a button back to Home.
12. **Nothing else moved.** Colours, fonts and buttons look as they did before; the light and dark choice and the language choice are unchanged by switching style.

## Not covered here

- The cashier app: out of this feature.
- Navigation counts: shown only if existing reads supply them; not verified.
