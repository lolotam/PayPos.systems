# ADR-0059: Souk Tiles design system foundations

Date: 2026-11-19. Status: Accepted by Waleed for DS-1.

## Context

Waleed selected Souk Tiles on 2026-11-19 as the base style for both applications and every future frontend and mobile task. DS-1 imports foundations without changing business behavior.

## Decision

Use `lolotam/lovable-pospay@0440911e3f557538f3118744e6461803c3517f44`, `src/styles.css`, as the token and typography source. Share light/dark colors, radii and theme runtime through `packages/ui`. Preserve existing public token names as aliases to the new palette, including legacy raw color utility names; no independent old palette remains.

Self-host Readex Pro and Baloo Bhaijaan 2 Arabic and Latin variable WOFF2 subsets, with `font-display: swap`. The adjacent OFL 1.1 files permit redistribution. Fonts come from Fontsource variable packages (Readex Pro 5.2.8; Baloo Bhaijaan 2 5.3.0). No runtime CDN requests are needed. Brand assets belong to Waleed/the client.

Keep lucide-react. Port the source theme storage key, pre-paint initialization and browser theme-color synchronization. Storage denial still permits system-theme initialization. Preserve POS PWA scope, start URL, display mode and offline service worker; precache fonts and new icons.

Dark mode follows the system setting by default, and the user can override it with the `ThemeSwitch` (light / dark / system) in the admin sidebar footer and the POS operator panel. The switch writes the same storage key the boot script reads, so the choice survives a reload and reaches the other tabs.

## Consequences

Phosphor requires a later owner decision and ADR. App-shell, navigation, dashboard, charts, page builder and permissions are follow-ups. No new component library, API, DB or migration is included. The `.area-tab-bar` rule is omitted because no existing component uses it.

Mobile apps/business inherits the foundations through the apps/pos build. Future frontend/mobile tasks use this design system. Native builds continue to omit the web manifest and service worker.
