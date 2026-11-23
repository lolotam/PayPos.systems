# 074-7a-fix — Review fixes for the unmounted navigation frames: delivery spec and plan

Parent: [`spec.md`](./spec.md) and [`plan.md`](./plan.md) of this folder (074-7a), [`../spec.md`](../spec.md) (FR-020, FR-024), [`../design.md`](../design.md) §4, [`../app-map.md`](../app-map.md). Source of the work: issue #1225, items 1 to 14.

## Owner decision

Waleed, card of 2026-11-23, «PR صغير مستقل قبل 7b (Recommended)», recorded as PP-233: PR #1226 (074-7a) merges as reviewed under its 5,000-line cap, and the findings left by its reviews are fixed here, in one separate PR that merges before 074-7b starts. Tier Medium. Cap: 900 added plus removed lines of code and tests, docs counted separately. Review pipeline PP-228. The cap was raised once, to 1,050 added plus removed lines of code and tests, by the owner's card of 2026-11-23 («رفع السقف إلى 1,050 ونقفل كل الـ 14 بند (Recommended)»), so that all fourteen items close in this PR. The Next `Link` prefetch finding is not part of this slice (#1227).

## What changes for a user

Nothing. The frames are still mounted nowhere. This slice makes them correct before 074-7b mounts them.

## Requirements

Each item is fixed with a test that fails without the fix. Paths are under `apps/admin/app/(dashboard)/_frame/` unless stated.

1. **Soon mark when style A hides a lone tab.** For a role whose sub-menu has a single not-built page (reproduced: `accountant`, restaurant, Kuwait, `/soon/customer-wallet`), the tab row is hidden and nothing visible marks the page. The mark is shown on the visible link that leads to the page. FR-020.
2. **Focus after the «More» sheet closes on a width change.** When the opener is no longer visible, focus goes to the visible link of the current section, not to a hidden button. FR-024.
3. **Link boundary.** `frames/frame-chrome.tsx` leaves pure-fragment links and any link with an explicit `target` to the browser.
4. **One component per file in two spec files** (`style-a-frame.spec.tsx`, `style-c-frame.spec.tsx`): move or merge the test helpers.
5. **Workspace switcher trigger is named** before a business is selected: a translated prompt, or the company name, as its accessible name and visible text.
6. **Choosing the current page's own link closes** the floating panel and the «More» sheet on a plain same-tab activation; a modified click leaves them open.
7. **Account menu and workspace switcher close on navigation**, including Back and Forward, without remounting their triggers.
8. **Current-section cue behind More (style A phone).** «More» is marked current when it contains the current group, and that group is marked inside the sheet.
9. **«More» links carry the Soon mark** when their destination page is not built.
10. **The floating panel does not reopen** after the viewport leaves 600–1023px and returns.
11. **Desktop panel visibility and the tablet modal state are separate.** A desktop open or inspect action never opens the tablet modal later.
12. **Approvals inbox states.** While the permission probes are loading it shows a loading state; if they fail it says the list could not be checked; the settled empty text does not claim that nothing is pending.
13. **Closing the sheet on navigation does not take focus back** from a destination that already holds it; a dismissal (Escape, backdrop) still returns focus to the opener.
14. **`LocalNav` scroll-to-current scrolls only its own container.** The B frame bounds the local list's height; the page itself never scrolls because of it.

## Rules

Same as 074-7a: no `page.tsx` or `layout.tsx`, nothing mounted, no `*-nav-item.tsx`, `staff-navigation.tsx`, `dashboard-*.tsx` or `app-frame.tsx` edited, no new dependency, no colour, font, radius or button-variant change, strings through `packages/i18n` in `ar` and `en`, logical CSS properties only, one component per file, 60 lines per function, UI tests assert what the user sees. `packages/ui` changes are allowed where an item names a ui file or needs an optional, backward-compatible prop; each one is listed in the PR. No scope beyond the fourteen items.

## Acceptance

1. Each of the fourteen items has a test that fails without its fix, named in the implementation notes.
2. Every existing spec passes unchanged, except a test the item itself says is wrong; each changed assertion is listed with its reason.
3. `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test`, `pnpm --filter @pospay/ui test` and `pnpm --filter @pospay/i18n test` pass.
4. Size at or under 900 lines of code and tests.
5. Not browser-verified here: real focus movement, scroll containment and breakpoint behaviour are confirmed in the 074-7b browser pass (#1192).

## Plan

1. Menu and marks: items 1, 8, 9.
2. Open-state lifecycle: items 6, 7, 10, 11.
3. Focus: items 2, 13.
4. Links and scroll: items 3, 14.
5. Naming and inbox states: items 5, 12.
6. Test hygiene: item 4.
7. Gates, guards, size.

Estimate: 330 production, 480 tests. If the count passes 800 before step 6, stop and report what remains.

## Implementation notes

**Base:** `origin/main` (it already contains 074-7a). **Status: items 1–3 and 5–14 done; item 4 not done.** The size stop of the brief (800 before plan step 6) was passed after step 5, so step 6 (item 4, test helper components in `style-a-frame.spec.tsx` and `style-c-frame.spec.tsx`) is left for a follow-up. Its planned fix: merge `CurrentRoute`/`PageContent` into one helper file and `DestinationHeading`/`Destination` into one.

| # | Fix | Proving test | Red check |
|---|---|---|---|
| 1 | `style-a-frame.tsx` keeps a lone tab when it carries the Soon mark | `style-a-frame-fixes.spec.tsx` (accountant, `/soon/customer-wallet`) | red run before the fix |
| 2 | `BottomSheet` `closeFocusTarget`; `phone-bar.tsx` sends focus to the sidebar link when not phone | `style-a-frame-fixes.spec.tsx` (widen to 820) | red run before the fix (focus ended on More) |
| 3 | `frame-chrome.tsx`: `#…` links and any `target` left to the browser | new `frame-chrome.spec.tsx` (`fireEvent.click` returns true) | red run before the fix (`#` and `_self`) |
| 5 | `frame-workspace-switcher.tsx`: prompt (`admin.chooseCompany` / `admin.chooseBusiness`, existing keys) | `frame-actions.spec.tsx` | red run before the fix |
| 6 | `FrameChrome onCurrentPage` (plain click whose path equals the current path), wired in `rail-and-panel.tsx` and `phone-bar.tsx`; `closeFloating` in `use-panel-state.ts` | `style-c-frame-panel.spec.tsx`, `style-a-frame-fixes.spec.tsx` (plain closes, ctrl-click stays) | red run before the fix |
| 7 | optional `resetKey` on `AccountMenu` and `WorkspaceSwitcher`, passed the pathname | `frame-actions.spec.tsx` (two navigations each, same trigger element) | red run before the fix |
| 8 | `BottomNavExtra.current` (`aria-current="true"`, heavier weight); «Current» text on the section heading in the sheet | `style-a-frame-fixes.spec.tsx` | red run before the fix |
| 9 | Soon mark on a More link from `list.pages[0].status` (the destination) | `style-a-frame-fixes.spec.tsx` (every More list, both ways) | red run before the fix |
| 10 | `usePanelState` clears the floating session on leaving 600–1023px | `style-c-frame-panel.spec.tsx` | red run before the fix |
| 11 | `show`/`hide` touch only their own state (floating or desktop) | `style-c-frame-panel.spec.tsx` (two tests) | red run before the fix |
| 12 | `useApprovalInbox` (`kinds` + `state`), `useApprovalKindProbes`; page `state` prop; keys `approvalsInboxFailed` new, `admin.loading` reused, `approvalsInboxEmpty` copy changed | `approvals-inbox-page.spec.tsx`, `use-approval-kinds.spec.tsx` | page: mutation (state ignored) fails 2 tests; hook: mutation (idle counts as loading) and mutation (error without status) each fail the same test |
| 13 | `BottomSheet` leaves focus alone when it is already outside the sheet and not on `body` | `bottom-sheet.spec.tsx` (destination takes focus in an effect) | removing the guard fails the test |
| 14 | `LocalNav` scrolls its own container by rect deltas; optional `className`; B frame passes `min-[1024px]:max-h-dvh` | `top-nav-local-nav.spec.tsx` (scrollTop/scrollLeft, `scrollIntoView` never called); `style-b-frame.spec.tsx` (class) | red run before the fix |

**`packages/ui` changes (all optional and backward compatible):** `BottomNavExtra.current` (item 8); `BottomSheet.closeFocusTarget` and the «focus already moved» guard (items 2, 13); `AccountMenu.resetKey` and `WorkspaceSwitcher.resetKey` (item 7; the reset close does not call `onOpenChange`); `LocalNav.className` and own-container scrolling (item 14).

**Changed assertions.** `top-nav-local-nav.spec.tsx`: the two tests that asserted `scrollIntoView` calls now assert the list's own scroll offsets (the item says `scrollIntoView` is the bug). `approvals-inbox-page.spec.tsx`: the empty-state test is renamed and also checks the copy no longer claims «nothing is waiting» (the copy changed). `use-approval-kinds.spec.tsx`: `renderKinds` takes the hook as an argument (the three old assertions are unchanged). `frame-test-support.tsx`: `selectBusiness` takes an optional role.

**Other notes.** The approval probes now throw `{ ...error, status }` like `imported-refunds-client.ts`; before, a 403 carried no status and `readAccessProof` read it as a failure, which the new «could not be checked» state would have shown to refused users. `approvalsInboxEmpty` now says no approval list is available, because the inbox never knew how many approvals wait. Two max-lines errors found by lint in my own code were fixed (`MoreSheet` props interface, a spec `describe` split).

**Closing step.** `origin/main` (`8a3a360fe`) was merged without conflict. Item 4 was tried: moving the helpers into two small helper files nets +31 added and −32 removed lines (63 against the cap), which would take the total from 888 to 951, so it was reverted and **item 4 stays open on #1225**. Guards (PP-198): `clean-code-guard` found nothing needing a code change (see the report); `test-guard` found two tests in `use-approval-kinds.spec.tsx` holding two scenarios each, now split into four.

**Open points.**
- Item 4 (above).
- Item 2 finds its target with `aside a[aria-current="page"]` document-wide. Scoping it to the frame root needs a ref or the navigation label passed down, which is more than a one-line change, so it is left.
- Item 6 compares the pathname only. A link that differs from the current page only by its query string is therefore treated as the same page, and the panel or sheet closes (the router still pushes the new query).
- After Back closes an open account menu or workspace switcher, focus lands on its trigger (Radix default), not on the destination. Known behaviour, to be checked in the #1192 browser pass.
- The reset-on-key code (a `resetKey` compared during render) is now written in `AccountMenu`, `WorkspaceSwitcher`, `PageFinder` and `TopNav`; extracting one hook was not done to stay inside the cap.
- `useApprovalKinds` and `useApprovalKindAccess` have no production caller yet (7b will call `useApprovalInbox`); they stay because existing specs pin their shapes.

Not verified: real-browser focus, scroll containment (item 14 uses stubbed rects) and breakpoint behaviour (#1192).

## Correction round 1 (PP-228 review of head e65171ef5)

Main moved (`a3e52e119`, 55-2f) and was merged without conflict.

**Done in this round (points 1–4 of the brief):**

1. **Query string in the navigation key (item 7, P1).** New `frames/use-navigation-key.ts` returns the pathname plus the query (`useSearchParams`). It now keys: the account menu and workspace switcher (`resetKey`), the More sheet, the C floating panel, the C page finder and the B drawer and mega menu (`TopNav.resetKey`). Decision per overlay: every keyed overlay is modal or closes on an outside press, so the URL cannot change between opening and closing through the user using the page (a filter change needs the page, which the overlay blocks); closing on any URL move, Back and Forward included, is therefore right. What is not keyed by the query: the desktop panel's visibility (a user preference) and the previewed workspace of the desktop panel (kept per pathname, so a filter change on a list page does not reset a preview in use; `usePanelState` takes both keys). Tests: `frame-actions.spec.tsx` (account menu and switcher, forward, Back, forward again on `/packages?package=…`), `style-c-frame-panel.spec.tsx` (floating panel, finder, preview kept), `style-a-frame-fixes.spec.tsx` (sheet). Replacing the key with the bare pathname fails five of these tests. `useSearchParams` in a client component can need a `Suspense` boundary when a page is prerendered; 7b mounts the frames in a dynamic layout, to be confirmed in its build.
2. **Empty-body refusal (item 12, P1).** `use-approval-kind-access.ts` decides from `response.status >= 400` (helper `rejectOnHttpError`), not from the body. Test: a 403 with `error: undefined` lists the other kinds and settles; it failed before the fix with state `failed`.
3. **Workspace and identity failures (item 12, P1).** `useSessionIdentity` (new, in `use-session.ts`) passes the identity query state (`pending`, `failed`, `settled`). With no scope the inbox state is `failed` when the workspace status is `error` or the identity read failed, `loading` while either is pending, `settled` otherwise. Tests in `use-approval-kinds.spec.tsx` (workspace error; identity failed and pending). The spec's mock of `use-session` now provides `useSessionIdentity` instead of `useSessionUser`.
4. **Loading beside known links (item 12, P1).** The page shows its `role="status"` loading text whenever `state` is `loading`, also with links. Test: one kind with state `loading`; red before the fix.

**Not done (size).** The cap of 1,050 was passed after points 1–4 (1,105), so work stopped as the brief says. Left: point 5 (scope the fallback focus target of item 2 to the frame's own root, with a test holding an earlier `<aside>`), point 6 (item 4: one component per file in the two spec files; measured earlier at +31 −32 lines), and the three small points. For the small points: `BottomSheet`'s guard can drop the `instanceof HTMLElement` test (`document.activeElement` is an `Element`, so an SVG destination is covered); `WorkspaceSwitcher`'s reset close not calling `onOpenChange` is already stated in the prop's doc comment; the B local list's `max-h-dvh` adds to the header height, so on a short viewport the last items can need a page scroll, to be checked in the #1192 browser pass.
