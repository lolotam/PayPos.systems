# Design brand and application shells

Owner decision ledger, 2026-10-03. Presentation only, applied to the existing Phase 1 UI
kit, admin shell, permissions, notifications, device pairing, staff login and attendance display.

## Locked decisions

- Data-sheet precision: warm Sand canvas, Ink text, white surfaces, thin warm borders,
  compact controls, 8px element gaps and 48px section gaps. No gradients or decorative art.
- Adopt `docs/design/brand-theme.source.css` unchanged except control radius 8px and
  surface radius 12px. Preserve its dark theme and all palette/status/chart values.
  This owner decision supersedes the earlier DESIGN.md/constitution radius guidance.
- Primary buttons use Ember with Ink text. Links use the link token, destructive actions
  use Crimson, success/paid use Gulf Teal. Blue is reserved for semantic info and charts.
- Ink sidebar: workspace selector at the top, existing Workspace and Permissions links
  in the middle, signed-in identity, authenticator and sign-out at the bottom. Active
  navigation has a small Ember dot, brighter text and a subtle lighter row, superseding
  the older brand-guide pill. Utility row contains notifications and language switching.
- IBM Plex Sans Arabic 400/500/700 throughout; headings 700, Latin-only -0.02em
  letter spacing, tabular numbers. All positioning and spacing are logical for RTL.
- Logo is concept 20 Bilingual Lockup, replacing all earlier logo choices: Ember square
  tile with 18% rounded corners, geometric Ink P and circular Sand counter. Tile geometry
  stays identical on every background and appears at inline-start in both directions.
  Isolated `BrandMark` keeps the tile unchanged; `BrandLockup` supports Ink/light wordmark tones.
  Accessible title: PosPay — بوس باي. Interim IBM Plex Sans Arabic 700 wordmark reads
  PosPay above بوس باي, with `TODO(brand): replace with outlined final artwork`.
  Favicons and POS PWA icons contain the tile alone. The reference raster is not copied.
- Narrow admin layouts collapse the sidebar into a keyboard-accessible modal drawer.
- POS uses 16px+ text and controls at least 48px high. Attendance branch/clock appear
  above a QR on white with its quiet zone preserved and refresh guidance below.

## Scope and acceptance

Visual QA round 1, owner instructions:
- Sidebar account uses the existing session email/name, ellipsis and full-value titles, never a UUID.
- Active navigation dots use absolute logical inline-start positioning and explicit inherited direction.
- Buttons use the bundled 600 font weight; admin labels are 15px and POS labels 18px.
- Membership scopes use loaded workspace names, with shortened-id fallback. Holder ids show
  eight characters plus ellipsis, full-value titles and a localized copy control. Row action is View / عرض.
- Sign-in uses a centered bilingual BrandLockup above its heading. Browser-tool output is ignored.

PR review fixes:
- POS controls carry their touch sizing in rendered utility classes: labels/input/select text
  is at least 16px, button text 18px and controls at least 48px high. No layered sizing overrides.
- The default wordmark follows the theme foreground token on cards and headers, including dark mode.
  Explicit light tone remains for the Ink sidebar; tile geometry and colours never change.
- Regression assertions cover rendered control classes and both wordmark tones in light/dark themes.

1. Preserve existing component APIs, form handlers, data hooks, selection, session,
   authorization, polling and QR hiding behavior. Change only composition and appearance.
2. Add shared sidebar, page header, empty state, stat and bordered table frame components.
   Use pill badges for statuses/roles. Skip toast if no existing implementation exists.
3. Restyle admin sign-in/TOTP, workspace summaries, permissions tables/detail/forms,
   notifications, and loading/error/unavailable states.
4. Restyle POS pairing/waiting/offline/unsupported, staff sign-in/session, attendance.
   Offline uses warning styling; unavailable uses a distinct error icon and token.
5. Every new user string has ar/en catalog keys. No manual setup or external font fetch.
6. `pnpm check` with FORCE_COLOR unset exits zero; admin and POS builds exit zero.
   Existing behavior assertions remain intact. Browser screenshots are owner/orchestrator work.

## Out of scope

No API, contracts, migrations, database work, permissions, business rules, new screens,
features, startup changes or new dark designs. No commit/push or dev server.
The sole dependency addition is the CLAUDE.md §7-mandated `@tanstack/react-table` 8.21.3,
pinned in ADR-0016, rendering already-paginated membership rows with their existing actions.
Existing product TODO(spec) decisions remain deferred; this slice introduces none.
