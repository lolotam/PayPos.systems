# ADR-0059: Souk Tiles design system foundations

Date: 2026-11-19. Status: Accepted by Waleed for DS-1.

## Context

Waleed selected Souk Tiles on 2026-11-19 as the base style for both applications and every future frontend and mobile task. DS-1 imports foundations without changing business behavior.

## Decision

Use `lolotam/lovable-pospay@0440911e3f557538f3118744e6461803c3517f44`, `src/styles.css`, as the token and typography source. Share light/dark colors, radii and theme runtime through `packages/ui`. Preserve existing public token names as aliases to the new palette, including legacy raw color utility names; no independent old palette remains.

Self-host Readex Pro and Baloo Bhaijaan 2 Arabic and Latin variable WOFF2 subsets, with `font-display: swap`. The adjacent OFL 1.1 files permit redistribution. Fonts come from Fontsource variable packages (Readex Pro 5.2.8; Baloo Bhaijaan 2 5.3.0). No runtime CDN requests are needed. Brand assets belong to Waleed/the client.

Keep lucide-react. Port the source theme storage key, pre-paint initialization and browser theme-color synchronization. Storage denial still permits system-theme initialization. Preserve POS PWA scope, start URL, display mode and offline service worker; precache fonts and new icons.

Addendum (2026-11-19, DS-2): [ADR-0060](./0060-phosphor-icons.md) supersedes «Keep lucide-react»; Phosphor is now the icon library.

Addendum (2026-11-20, DS-3 A1): the theme runtime has one source and one instance. The boot script is generated from the module's `installThemeRuntime`, `createThemePainter` and `createThemeStore`, and the installed instance lives on `window.__pospayTheme`. The boot script installs the `storage` and `prefers-color-scheme` listeners on every page, and the module joins that instance instead of installing a second one.

Dark mode follows the system setting by default, and the user can override it with the `ThemeSwitch` (light / dark / system) in the admin sidebar footer and the POS operator panel. The switch writes the same storage key the boot script reads, so the choice survives a reload and reaches the other tabs.

Addendum (2026-11-20, DS-3 A4, issue #1082 item 7): the public rating page, `apps/menu`, is on this design system too (PP-193.1). It already imported `@pospay/ui/styles.css`; it now also renders the shared `THEME_COLOR_METAS` and `THEME_BOOT_SCRIPT` from `packages/ui/src/theme.ts` in its root layout, takes its icons from `@pospay/ui` (ADR-0060), and builds its form from `packages/ui` components and tokens.

- **Theme: the device setting, no switch (PP-200).** Waleed answered «يمشي مع إعداد الجهاز (المقترح)» on 2026-11-20; the question is DS3-Q1 in batch 95 of the decisions page, where Abu Salem's pick is pending and binds if it differs. `apps/menu` mounts no `ThemeSwitch` and never calls `setThemePreference`. The theme runtime has no separate system-only mode and needs none: nothing on the menu origin writes the storage key, so the runtime resolves to `system` and follows `prefers-color-scheme`, live. The shared script would still honour a `pospay-theme` value already stored on the same origin; that only happens when another PosPay app is served from the menu's origin, as two apps on one `localhost` port in development are, and never on the menu's own address (ADR-0058).
- **ADR-0058 still holds.** The boot script is first-party inline code. It only reads `localStorage`; the page writes nothing to the browser, so «no persistence» is unchanged. No tracker, analytics or service worker is added.
- **Favicons without a manifest.** `favicon.ico`, `icon.png` (192px) and `apple-icon.png` are byte copies of the admin's brand assets, placed in `apps/menu/app/` so Next emits and links them; the standalone runtime copies no `public/` directory. The menu has no web manifest, maskable icons or `browserconfig.xml`: the page is not an installable app, and a manifest `start_url` would open it without the rating token that lives in the URL fragment.
- **Selection by colour, not icon weight.** The star options keep the `regular` Phosphor weight (ADR-0060); the chosen option is marked with the primary colours.
- **One export added to `packages/ui`:** the `Star` icon.

## Consequences

`apps/menu` follows the device theme with no switch (PP-200, the DS-3 A4 addendum above). Phosphor requires a later owner decision and ADR. App-shell, navigation, dashboard, charts, page builder and permissions are follow-ups. No new component library, API, DB or migration is included. The `.area-tab-bar` rule is omitted because no existing component uses it.

Mobile apps/business inherits the foundations through the apps/pos build. Future frontend/mobile tasks use this design system. Native builds continue to omit the web manifest and service worker.
