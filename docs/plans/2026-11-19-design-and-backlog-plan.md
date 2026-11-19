# Plan — design follow-ups (DS-3) and Phase-1 backlog, 2026-11-19

Owner request (Waleed, manager thread, 2026-11-19): «أعملي spec وخطة لدول كلهم بتسكات وبلا نبدأهم كلهم».
This plan follows PP-195. Each task gets a tier card before it starts. The tiers below are the manager's recommendations.
At most five task sessions run at once (PP-118 / PP-177). PP-194 makes OpenCode `zai-coding-plan/glm-5.3-flash` (`high`)
the first implementer lane. After that lane, the PP-195 fallback order applies: Kimi → MiniMax → GLM → Grok → Sonnet.

## Status check of the backlog (verified against GitHub, 2026-11-19)

| Item in the old backlog | Real state | Action |
| --- | --- | --- |
| 47-2b migration lane | **Done.** PR #889 merged (migrations 0215/0216). | None. Next are 47-2c, 47-2d and 47-3 (Track C). |
| #882 (57b-2b) | **Merged.** Open follow-ups: #885, #890. | Track E (optional). |
| #883 (59b-2c) | **Merged** (migration 0214). Rating follow-ups #803–#811 stay open, outside this plan. | None. |
| Row 48 (48-3 builder screen) | **Deferred** by PP-169.1. | Track D needs Waleed to lift PP-169.1 first. |
| #1075 follow-ups | Open. | Track B. |
| MCP token rotation | Secrets. Waleed's own action, postponed by PP-14 to the end of the plan. | Not delegated. Listed so it is not forgotten. |

## Track A — DS-3 design follow-ups (#1081, #1082)

### A1 — Theme runtime hardening · tier: **Medium**

**Scope:** `packages/ui/src/theme.ts`, its tests, and the boot script.

**Requirements**

1. Theme logic has one owner. The boot script is built from the same helpers as the module, or it hands over to the module listener after hydration (#1082.4).
2. The cross-tab `storage` listener and the `prefers-color-scheme` listener are attached at module load, not only while a `ThemeSwitch` is mounted. This covers the admin sign-in page and the POS before staff login (#1082.2, #1081.1).
3. The system listener respects `memoryPreference` when storage is blocked. An explicit Dark choice survives an OS switch (#1082.1).
4. When the stored key is cleared mid-session, the owned `data-pospay-theme` meta is updated or removed. The browser bar then follows the system (#1082.3).
5. The boot script guards `matchMedia` (#1082.5).
6. The `readThemePreference` snapshot is cached. There is no localStorage read on every render (#1082.6).

**Acceptance:** each item has a test that asserts the visible result (the `.dark` class, the meta content, the switch state), per CLAUDE.md §9.

**Out of scope:** colours and tokens.

### A2 — Tokens and browser colours · tier: **Light**

**Scope:** `theme.css`, `theme.ts`, `browserconfig.xml` ×2, the admin `site.webmanifest`, and import ordering.

**Requirements**

1. Delete the unused legacy scales `ember-*`, `ink-*`, `teal-*`, `crimson-*`, `sand-50` and `ink-950`. First check that nothing in `apps/` or `packages/` uses them (#1081.2).
2. Add one test that checks `THEME_COLORS` against the light and dark `--background` in `theme.css`. The same test checks both TileColor entries and the manifest colours (#1081.3).
3. Move the `@pospay/ui/theme` import into the `@pospay` import group in `apps/admin` root-layout and in the `apps/pos` vite config (#1082.8).

### A3 — Native app icons and the unsupported-device icon · tier: **Light**

**Scope:** `apps/business` native icon assets and `apps/pos/src/device/ui/unsupported-notice.tsx`.

**Requirements**

1. Regenerate the iOS and Android icons from the Souk Tiles favicon source. The orange P artwork goes away (#1081.4).
2. Keep `DeviceMobileSlash`, or switch to `Desktop` plus a warning badge, if Waleed prefers that on the card.

**Note:** binary assets. The review is visual, from screenshots in the PR.

### A4 — apps/menu visual pass · tier: **Medium**

**Scope:** `apps/menu` only, plus an addendum to ADR-0059.

**Requirements**

1. Menu follows PP-193.1. It gets the boot script, the theme-color metas, Phosphor icons and the favicon set.
2. No theme switch on the public menu: it follows the device setting.
3. RTL check.
4. Record the menu in ADR-0059 (#1082.7).

**Open question for Waleed (feature card, may go on the decisions page):** should the public menu follow the device's
dark mode, or always stay light?

## Track B — package sale picker follow-ups (#1075)

### B1 — Recovery journal hardening · tier: **Medium**

**Scope:** `apps/admin/src/orders/api` (the recovery journal) and its tests.

**Requirements** (#1075 list 1)

1. Handle the device clock moving backwards against the 23-hour window.
2. Key async cleanup per `scopeKey`.
3. Discard an expired attempt after manager verification.
4. Bound the size of the status-only record.
5. Refresh the retry button when the window expires.
6. Warn the operator when the journal write fails.
7. Run the recovery tests in Arabic as well.

**Out of scope:** money. The server stays authoritative.

### B2 — Stale quote UX in the picker · tier: **Light**

**Scope:** `package-sale-type-field.tsx` and `package-sale-type-option.tsx`.

**Requirement:** when a package quote is refreshed, the old revision can no longer be submitted. The confirm button stays
disabled until the new quote is acknowledged (#1075, the picker item). The server already rejects a stale quote with
`PACKAGE_SALE_QUOTE_STALE`, so this is UX only.

### B3 — API guard and seller list · tier: **Heavy** (permissions)

**Scope:** `package-sale-context.adapter.ts` and `sellable-package-types.controller.ts`.

**Requirements** (#1075, the API items)

1. Prove that the seller list excludes the recorder herself, or pass `userId` explicitly.
2. Add the explicit user-only guard that the contract promises: device principals are refused, as on the context and
   sale endpoints.
3. Add negative tests.

**Merge:** needs Waleed's card (PP-195 §4).

## Track C — package import, spec 058 row 47

### C1 — 47-2c: commit transport and recovery sweep · tier: **Heavy** (money)

**Scope:** orders worker. The `package-import-commit` processor and BullMQ transport are wired like staff's.

**Requirements**

1. The job is enqueued only after the claim commits (ADR-0018).
2. A recovery sweep marks a commit request that stayed pending for ten minutes as `failed`.
3. The producer stays closed until 47-2d.
4. The 47-2b terminal-failure persistence is preserved.

**References:** spec 058 rows 47-2 and 47-2b, ADR-0034's 058 addendum, and `47-2b-local-receipt.md`.

**Migration:** the plan expects none. If one turns out to be needed, it waits for the manager's lane grant.

### C2 — 47-2d: commit request route · tier: **Heavy** (money, permissions)

**Scope:** an API command that answers 202 and requires an `Idempotency-Key`. In one transaction it sets
`commit_requested`, stores the selected authorized membership, and appends `PackageImportCommitRequested`.

**Also in this task:**

- the contract, the worker's known type, the ADR-0034 addendum, and the module-map §4 row;
- IM-01…IM-08;
- the producer is activated only after C1 is deployed.

**Depends on:** C1 merged and deployed to staging.

### C3 — 47-3: import screen · tier: **Medium**

**Scope:** upload, preview and commit in the admin, with row errors and component tests.

**Depends on:** C2.

## Track D — commissions, row 48

### D1 — 48-3: commission plan builder screen · tier: **Heavy** (money)

**Blocked:** PP-169.1 («Keep deferred, free the slot»). It starts only if Waleed lifts PP-169.1 on a card.

**Scope** (spec 059 row 48-3):

1. Blocks with switches, validated before submit through `packages/commissions-engine/validation`.
2. A history list.
3. ar/en keys.
4. Component tests (CM-06, CM-09).
5. The employee list shows name and employee number (CS-Q40).

**Unblocks:** 49-2.

## Track E — optional follow-ups of #882

### E1 — #885: newest-first own leave history · tier: **Medium**

### E2 — #890: cancel the latest request using a server-documented permission source · tier: **Heavy** (permissions)

## Start order (five sessions at most)

| Wave | Tasks | Why |
| --- | --- | --- |
| 1 (now) | A1, A2, B1+B2 (one session, two PRs), C1, B3 | Disjoint files. Two Heavy tasks run in parallel. No migration lane conflict. |
| 2 | A3, A4, C2 | A3/A4 start when A1/A2 free a slot. C2 starts after C1 is deployed. |
| 3 | C3, D1 (if unblocked), E1, E2 | C3 starts after C2. |
| Waleed only | MCP token rotation | Secrets (PP-14). |

## Waleed's answers (tier cards, 2026-11-19, manager thread)

- DS-3: «زي ما هي + مراجعة بالمتصفح» — tiers as proposed, plus an exception: before each DS-3 merge a session opens
  staging (or the PR build) in a browser and attaches light/dark, ar/en screenshots.
- #1075: «كله Medium» — B1, B2 and B3 all run Medium; B3 merges without a Waleed card.
- Package import: «زي ما هي (المقترح)» — C1/C2 Heavy, C3 Medium, order C1 → C2 → C3.
- 48-3: «نفك التأجيل ونبدأها دلوقتي» — PP-169.1 is lifted; D1 starts in wave 1 (Heavy).
- Note from Waleed: «اللي بيكتب الخطط هو fable 5.2 medium» — every task's implementation plan is written by
  Claude Fable 5.2 (medium); Heavy plans then get one Astra 6.2 (medium) debate round.
- Note from Waleed: every feature addition updates its user-journey file under `docs/journey/`; the missing journeys
  are caught up as task J1 (Light).

## Revised start order

| Wave | Sessions |
| --- | --- |
| 1 (now) | A1 · A2 then A3 · B1 → B2 → B3 (one session, three PRs) · C1 · D1 |
| 2 | A4 (after A1) · C2 (after C1 is on staging) |
| 3 | C3 · E1 · E2 |
| Manager | J1 journey catch-up (Light, docs only) |

Every merge report carries the plan summary and the three closing headings (PP-195 §6). `roadmap.json` gets one row per
task.
