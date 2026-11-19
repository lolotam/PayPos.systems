# ADR-0060: Phosphor icons

Date: 2026-11-19. Status: Accepted by Waleed for DS-2 (PP-193.3).

## Context

Waleed selected Phosphor on 2026-11-19 in PP-193.3: «ننقل لـ Phosphor (المقترح)». The Souk Tiles source, `lolotam/lovable-pospay@0440911e3f557538f3118744e6461803c3517f44`, uses Phosphor. ADR-0059 kept lucide-react until this separate decision and task; DS-1 has now merged, so DS-2 replaces the icon library without changing business behavior.

## Decision

Use `@phosphor-icons/react` 2.1.10 everywhere instead of lucide-react. Pin the dependency exactly and import its non-deprecated `…Icon` exports. Existing `@pospay/ui` export names remain as aliases where needed, so consumers keep their current component API. Every Phosphor import in `packages/ui` uses `@phosphor-icons/react/dist/ssr`, one entry point, because Next.js server components cannot evaluate the client entry's `createContext`; no `IconContext` provider exists, so nothing is lost. Apps import icons only through `@pospay/ui`.

Phosphor defaults to `size="1em"` where lucide defaulted to 24px. The icons exported by `@pospay/ui` are thin wrappers (`packages/ui/src/icons.tsx`) that default to `size={24}`; an explicit `size` prop or a `size-*` class wins.

The default weight is `regular`, including every icon migrated by DS-2. Do not set another weight unless the Lovable source clearly uses one for that icon; no such override applies to the current usages.

Horizontal directional icons, including arrows and left/right carets, must follow reading direction. The exported directional icon (`LogOut`) mirrors itself in RTL with `rtl:-scale-x-100` merged into the caller's class, so call sites add nothing. A new horizontal directional alias is created with the same `mirrorInRtl` option. Vertical carets and non-directional icons are not mirrored.

## Consequences

Lucide imports and its dependency are removed. Icon sizes (24px default), class names and accessible hiding stay unchanged. Directional icons now mirror in RTL by design, inside the shared export. `MonitorX` has no Phosphor equivalent, so the unsupported-device notice uses `DeviceMobileSlash`. ADR-0059's «Keep lucide-react» item and the icon rule in `CLAUDE.md` §7 point to this ADR; the corresponding constitution rule moves to Phosphor.

No component library, API, permission, money behavior, database schema or migration changes. Future icons use Phosphor by default and follow the same weight and direction rules.
