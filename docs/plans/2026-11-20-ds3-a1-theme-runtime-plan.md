# DS-3 A1 — Theme runtime hardening: implementation plan

Date: 2026-11-20. Tier: **Medium** (PP-195), with the DS-3 exception «زي ما هي + مراجعة بالمتصفح» (browser
screenshots, light/dark × ar/en, attached to the PR before it is reported ready).
Sources: issue #1082 items 1–6, issue #1081 item 1 (remainder), `docs/plans/2026-11-19-design-and-backlog-plan.md`
section A1 (PR #1086), ADR-0059.
Branch: `feat/ds3-a1-theme-runtime`. No migration, no API, no i18n key, no new dependency.

## 1. Problem

`packages/ui/src/theme.ts` holds the theme logic twice: once as the `THEME_BOOT_SCRIPT` string and once as module
functions. The two copies do not share state, which causes every finding in #1082:

| # | Finding | Root cause |
| --- | --- | --- |
| 1082.1 | With storage blocked, an explicit Dark choice is overridden when the OS switches. | The boot listener cannot see the module's `memoryPreference`. |
| 1082.2 | A change made in another tab does not apply on the admin sign-in page or the POS before staff login. | The `storage` listener is attached only while a `ThemeSwitch` is mounted. |
| 1082.3 | Clearing the stored key mid-session leaves the owned `data-pospay-theme` meta in place. | The boot listener only toggles `.dark`. |
| 1082.4 | Theme logic exists twice. | Boot string and module are separate code. |
| 1082.5 | The boot script calls `matchMedia` without a guard. | Only the module checks `typeof window.matchMedia`. |
| 1082.6 | `readThemePreference` reads localStorage on every render. | No cached snapshot. |

## 2. Constraint that decides the design

`THEME_BOOT_SCRIPT` is imported by a server component (`apps/admin/src/shared/locale/root-layout.tsx`) and by a Node
config (`apps/pos/vite.config.ts`). Neither puts `theme.ts` into a client bundle. `ThemeSwitch` is the only client
consumer, and it is mounted only in the admin dashboard sidebar and the POS staff home. `packages/ui` also declares
`sideEffects: ["**/*.css"]`, so a module-level side effect in `theme.ts` may be tree-shaken.

So on the admin sign-in page and on the POS before staff login **only the boot script runs**. Plan requirement 2
(«listeners attached at module load») is therefore met by the boot script: it installs the listeners before first
paint on every page. The module never installs a second set. It joins the instance the boot script created.

## 3. Design — one source and one instance

All theme behaviour lives in three self-contained functions in `packages/ui/src/theme.ts` (the storage side was
split out in fix round 1, when the state function exceeded the 60-line limit):

- `createThemePainter(config)` — DOM side. Resolves the system media query once, behind a `typeof window.matchMedia
  === 'function'` guard (#1082.5), and returns `{ media, paint(preference) }`. `paint` toggles `.dark` on `<html>`,
  and creates/updates the owned meta for an explicit choice or removes it for `'system'` (#1082.3).
- `createThemeStore(config)` — storage side. `read()` returns the stored `'light'`/`'dark'` or `null` (also on a
  throw); `write(preference)` returns `false` when the browser refuses the write.
- `installThemeRuntime(config, createPainter, createStore)` — state side. If `window[config.handle]` exists it returns it
  (idempotent). Otherwise it creates the runtime, stores it on `window[config.handle]`, paints once, attaches the
  `storage` listener and the system `change` listener, and returns the handle.

The runtime handle (`ThemeRuntime`) is:

```ts
{ get(): ThemePreference; set(preference: ThemePreference): void; subscribe(listener: () => void): () => void; dispose(): void }
```

State inside the runtime: the memory preference (written only when a storage write throws), the cached current
preference (#1082.6), and the subscriber list. Because the system listener lives in the same closure, it sees the
memory preference (#1082.1).

The boot script is generated from those same functions, the pattern `next-themes` uses:

```ts
export const THEME_BOOT_SCRIPT = `(${installThemeRuntime.toString()})(${JSON.stringify(THEME_RUNTIME_CONFIG)},${createThemePainter.toString()},${createThemeStore.toString()});`;
```

The module API delegates to the same instance:

```ts
function themeRuntime(): ThemeRuntime {
  return installThemeRuntime(THEME_RUNTIME_CONFIG, createThemePainter, createThemeStore);
}
```

`readThemePreference`, `setThemePreference` and `subscribeToThemePreference` keep their names and signatures and call
`themeRuntime().get / set / subscribe`. On the server (`typeof window === 'undefined'`) `readThemePreference` returns
`'system'` and nothing is installed. The runtime is installed lazily on the first client call, never at import time
(tree-shaking safe, and tests can stub `matchMedia` before the install).

### Rules for the stringified functions

They are serialised with `Function.prototype.toString()`, so each one must be fully self-contained:

- Every dependency arrives through a parameter. No reference to a module constant, import, or another module function.
- Plain syntax only: `var`/`function`, no spread, no destructuring, no classes, no async, no optional chaining, no
  nullish coalescing, no template literals, no optional catch binding (`catch (error)`, never `catch {`). This keeps compilers from injecting helpers and keeps old WebViews working.
- No `typeof window` comparison inside them. The Next server compiler replaces `typeof window` with `"undefined"`,
  which froze the `matchMedia` guard to `if (false)` in the admin boot script (found in the browser review, fix
  round 2). Guard the member instead: `typeof window.matchMedia === 'function'`.
- Each stays under the 60-line function limit (`max-lines-per-function`, blank lines and comments skipped).
- `theme.ts` stays one file with no imports (the POS Vite config loads it in Node) and inside the `max-lines` lint limit
  (300 warn / 400 error; the rule skips comments and blank lines, and the Arabic doc comments make the physical file longer).

### Runtime behaviour (exact)

- `read()`: try `localStorage.getItem(key)`; `'light'`/`'dark'` wins. On a throw or any other value: the memory
  preference, else `'system'`.
- `refresh()`: `current = read()`, `paint(current)`, notify subscribers.
- `set(preference)`: try to write (`removeItem` for `'system'`, `setItem` otherwise) and clear the memory preference;
  on a throw keep `preference` in memory. Then `current = preference`, paint, notify.
- `storage` event: ignore when `event.key` is neither `null` nor the theme key. Otherwise clear the memory preference
  (the event proves storage works) and `refresh()`.
- system `change` event: `refresh()`. It re-reads storage because a same-tab clear fires no `storage` event; storage
  empty plus a memory choice keeps the memory choice. The full paint also removes a stale owned meta.
- `get()`: returns the cached `current`. No storage read.
- Listener attach/detach is guarded (`media` may be `null`; `addEventListener`/`removeEventListener` may be missing
  on old engines and in test mocks).
- `read()` order (review round 1): a non-null memory preference wins over storage, because it only exists when a
  write was refused, so storage then holds a value older than the user's last choice.
- `dispose()`: removes both listeners, drops the subscribers and deletes `window[config.handle]`. Used by tests.

`effectiveTheme`, `THEME_COLORS`, `THEME_COLOR_METAS`, `THEME_STORAGE_KEY` and every name exported from
`packages/ui/src/index.ts` stay unchanged. The window handle is `__pospayTheme`, typed through a `declare global`
`Window` augmentation in `theme.ts`.

## 4. Files

| File | Change |
| --- | --- |
| `packages/ui/src/theme.ts` | Rewrite the runtime as in §3. Remove the hand-written boot string and the module's own listener code. |
| `packages/ui/src/theme.test.ts` | Update for the shared runtime; add the tests in §5. |
| `packages/ui/src/__tests__/theme-switch.spec.tsx` | Dispose the runtime in teardown; add the tests in §5. |
| `packages/ui/src/theme-switch.tsx` | No change expected (same three imports). |
| `docs/adr/0059-souk-tiles-design-system.md` | Addendum: one shared theme runtime on `window.__pospayTheme`, boot script generated from the module's functions. |
| `packages/ui/README.md` | Update only if it describes the theme runtime. |

No file in `apps/` changes. The `@pospay/ui/theme` import grouping (#1082.8) belongs to A2.

## 5. Tests — each asserts a visible outcome (CLAUDE.md §9)

Teardown in both spec files: `window.__pospayTheme?.dispose()` so listeners do not leak between tests, then the
existing clean-up. The boot script is run with `new Function(THEME_BOOT_SCRIPT)()` as today.

| Item | Test | Visible assertion |
| --- | --- | --- |
| 1082.4 | Run the boot script, then call `setThemePreference('dark')` and `subscribeToThemePreference`; run the boot script a second time. | Exactly one system `change` listener was registered; `.dark` is set; the owned meta is the dark colour. |
| 1082.4 | Existing «runtime helper reaches the same theme and owned meta as the boot script». | Kept, with a dispose between the two halves. |
| 1082.2 | Boot script only, no `ThemeSwitch`, no subscriber. Store `dark` and dispatch a `storage` event. | `.dark` is set and the owned meta is the dark colour. |
| 1082.2 / 1081.1 | Boot script only, stored `dark`, then the other tab clears the key (`storage` event, `newValue: null`) on a light system. | `.dark` is removed and the owned meta is gone. |
| 1082.1 | `setItem` throws. Render `ThemeSwitch`, click Dark, then the system changes to light. | `.dark` stays, the Dark button stays pressed, the owned meta stays the dark colour. |
| 1082.3 | Boot script with stored `dark`, no subscriber. `removeItem`, then a system change to light. | `.dark` is removed **and** the owned meta is absent. |
| 1082.5 | `matchMedia` undefined. Run the boot script with stored `dark`, and again (after dispose) with nothing stored. | No throw; stored dark gives `.dark` and the dark owned meta; nothing stored gives light and no owned meta. |
| 1082.6 | Render `ThemeSwitch` with stored `dark`, spy on `Storage.prototype.getItem`, re-render three times. | The Dark button is still pressed, and `getItem` was not called during the re-renders. |

Existing tests keep their intent. Where one relied on the old split (for example asserting `listeners` length after
running the boot script in a fresh mock), it is adapted, not deleted.

## 6. Steps

1. Implementer (PP-194: OpenCode `zai-coding-plan/glm-5.3-flash`, `high`) rewrites `theme.ts` and the two test files
   per §3–§5. Bans: no git commands, no edits outside §4, no unrelated reformatting, no line-squashing.
2. Session owner reviews the diff line by line against this plan; runs `clean-code-guard`, `test-guard`, `docs-guard`.
3. Local gates (PP-113): `pnpm --filter @pospay/ui typecheck`, `lint`, `test`; `pnpm lint:docs`;
   `pnpm module-map:check`; typecheck of `apps/admin` and `apps/pos` (they import `@pospay/ui/theme`).
4. Browser review (DS-3 exception): build/run admin and POS locally. Check the emitted boot script in the admin HTML
   and in the POS `index.html` for injected helpers (for example `__name(`) and for console errors. Capture light/dark
   × ar/en screenshots and attach them to the PR.
5. ADR-0059 addendum. Commit, push `git push origin HEAD:feat/ds3-a1-theme-runtime`, open the PR, comment
   `@mergepilot review`.
6. Review rounds: at most 3 (local `/code-review`, CodeRabbit, MergePilot). The manager merges.

## 7. Acceptance

- #1082 items 1–6 and the #1081.1 remainder each have a passing test from §5.
- One runtime instance per page: boot script plus module leave one system listener and one `storage` listener.
- Exports of `@pospay/ui` and `@pospay/ui/theme` are unchanged; `apps/admin` and `apps/pos` typecheck without edits.
- The boot script emitted by the real admin and POS builds runs without errors in a browser.
- `ci-gate` is green on the exact head.

## 8. Out of scope

Colours and tokens, the legacy scales, the browserconfig/manifest test and the import grouping (A2). Native icons
(A3). The `apps/menu` pass (A4). Journey: no user-facing feature is added or changed, so no `docs/journey/` file
changes; the theme switch journey is part of the manager's J1 catch-up.
