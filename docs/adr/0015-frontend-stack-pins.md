# ADR-0015 — Frontend stack pins and the shared RTL component kit

- **Status:** Accepted
- **Date:** 2026-10-01
- **Slice:** Phase 1 · PR 1 — `packages/ui` foundation

## Context

`06` §1 fixes React, Tailwind CSS, shadcn-style Radix components and Framer Motion.
PR 1 introduces the shared kit before either frontend shell. Its dependencies,
RTL conventions and self-hosted Arabic typography need reproducible pins.

## Decision

These are the exact versions pnpm installed. React remains a `^19.0.0` peer;
its development copy and the other direct dependencies are pinned exactly.

| Package | Version | Why this one |
|---|---|---|
| `react` / `react-dom` | **19.3.0** | React 19 peers; matching development versions for DOM tests and Radix |
| `@types/react` / `@types/react-dom` | **19.3.0** | React 19 JSX and ref-as-prop types |
| `tailwindcss` / `@tailwindcss/vite` | **4.3.3** | Tailwind 4 CSS-first `@theme` tokens and its matching Vite integration |
| `radix-ui` | **1.6.7** | Accessible primitives, Slot composition and shared direction context |
| `class-variance-authority` | **0.7.1** | Typed, owned component variant definitions |
| `tailwind-merge` | **3.7.0** | Resolve Tailwind 4 utility conflicts, including logical spacing |
| `clsx` | **2.1.1** | Conditional class names without string concatenation |
| `lucide-react` | **1.49.0** | The single icon family required by `06` and CLAUDE.md §7 |
| `motion` | **13.4.6** | Framer Motion's `motion/react` entry and typed animation variants |
| `@fontsource/ibm-plex-sans-arabic` | **5.3.0** | Local Arabic font assets at weights 400, 500 and 700 |
| `eslint-plugin-react-hooks` | **7.1.1** | Recommended hooks rules in the shared TSX configuration |
| `jsdom` | **30.1.1** | Vitest's DOM environment on Node 24 |
| `@testing-library/react` | **16.3.3** | Test component behavior through the rendered DOM |
| `@testing-library/dom` | **10.4.2** | Explicit Testing Library peer for DOM queries |
| `vitest` | **5.0.1** | Reuse the workspace's existing test-runner pin |

**Release-age policy stays enabled.** No new dependency bypasses pnpm's minimum
release age, and no version younger than that minimum was used. The workspace has
no explicit age override, so pnpm 12 uses its 1,440-minute default. The existing
typescript-eslint exceptions are unchanged. pnpm verified the resolved lockfile
against its supply-chain policies; no new exception or build-script approval was added.

**The component source lives in the repository.** The shadcn component pattern is
copied into and maintained in `packages/ui`, with Radix primitives and logical CSS;
there is no runtime `shadcn` dependency or second component library. Icons are
Lucide as required by `06`. Each React component has its own file, and every
user-facing label comes from props or children backed by `packages/i18n`.

**CSS is the theme source.** Light and dark semantic variables feed Tailwind's
`@theme inline` mapping. Neutral surfaces, 18px interactive radii, 24px card radii,
a 4px spacing unit and business-status colors implement constitution VI. The
constitution references `DESIGN.md`, which is absent from this checkout; its stated
token constraints are used directly. Arabic uses IBM Plex Sans Arabic, paired with
the local system Latin stack. Fonts are bundled assets, never fetched from a CDN.

**RTL is explicit.** `DirectionProvider` defaults to RTL and sets both a DOM root's
`dir` and Radix's context. ESLint rejects physical-direction Tailwind classes inside
`className`, `cn()` and `cva()` literals in `apps/**` and `packages/ui/**`, including
variants, negative utilities and template fragments. Hooks recommendations apply
to TSX through the shared config.

**Motion presets stay plain data.** `fadeIn`, `slideIn.rtl`, `slideIn.ltr` and
`reducedMotion` share the `hidden` / `visible` / `exit` convention. Consumers select
the direction and reduced-motion preset using Motion's preference hook; the static
preset never hides content or moves it. The future shells own that preference wiring.

## Consequences

- Consumers transpile `@pospay/ui`'s TypeScript source export and import
  `@pospay/ui/styles.css` once. The stylesheet registers the kit's sources so
  Tailwind sees them even through a workspace link under `node_modules`.
- The POS service worker must precache the emitted local font assets in PR 3;
  this PR creates no application shell or offline runtime.
- Shared lint rules apply from the repository root and from individual packages.
  RuleTester and shared-config tests prove physical utilities fail and logical ones pass.
- Upgrades are deliberate PRs that update this table and the lockfile together.

References: [Tailwind theme variables](https://tailwindcss.com/docs/theme),
[Radix direction](https://www.radix-ui.com/primitives/docs/utilities/direction-provider),
[Motion accessibility](https://motion.dev/docs/react-accessibility),
[pnpm release-age policy](https://pnpm.io/settings/dependency-resolution#minimumreleaseage).
