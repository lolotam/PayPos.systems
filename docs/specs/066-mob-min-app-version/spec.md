# Feature Specification: minimum supported app version (MOB M-1f)

**Feature Branch**: `docs/mob-m1f-spec`

**Created**: 2026-10-23

**Status**: Draft

**Input**: A store app keeps running an old bundle until the user updates it. The server must be able to tell an
installed «PosPay Business» that it must update, and the check must be inside the first signed build (M-2a depends on
this slice). Rests on ADR-0055 (consequence «Installed apps lag behind the server») and spec 065 (plan row M-1f).
Owner decisions: **APP-Q18** (PP-42.10, batch 58), Waleed's answer «لازم تحدّث» مع كل نسخة جديدة (the second option,
not the recommended one), and **APP-Q19** (PP-43.3, batch 59), Waleed's answer «يفتح ويتأكد تاني». Both are recorded verbatim in
`docs/specs/065-mob-app-shell/owner-questions.ar.md`. Abu Salem's picks are pending; if his differs, his binds
(`CLAUDE.md` §1 5b) and this spec changes through a follow-up. This spec asks no new owner question.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new version is out, so every device must update (Priority: P1)

The counter tablet at «الأميرة» runs version 1.2.0. Version 1.3.0 is now available to everyone in the store. When the
app opens with internet, a full screen says the app must be updated to continue, with one button that opens the
store page. Nothing else is reachable until the tablet runs 1.3.0 (APP-Q18: every new version is a forced update).

**Why this priority**: it is the owners' decision for every release, and the check must ship in the very first signed
build. A binary without it can never be told to update.

**Independent Test**: serve a version file whose `minimum` for the platform is above the installed version.

**Acceptance Scenarios**:

1. **Given** the installed version is below the platform's `minimum`, **When** the app opens online, **Then** only
   the «must update» screen shows, with the store button, over both the counter flow and the employee flow.
2. **Given** that screen, **When** the user updates from the store and reopens the app, **Then** the app opens
   normally, and the device pairing, the role and the remembered business are all still there.
3. **Given** the installed version is equal to or above `minimum`, **When** the app opens online, **Then** nothing
   is shown and the app opens normally.

---

### User Story 2 - The app is back in the foreground after a release (Priority: P1)

The tablet stayed open overnight, and a new version became mandatory in the morning. When the cashier brings the app
back to the foreground with internet, the app checks again and shows the «must update» screen.

**Why this priority**: a counter tablet is rarely closed; a check at launch only would miss most releases.

**Independent Test**: start the app with `minimum` equal to its version, raise `minimum` in the served file, then fire
the return-to-foreground event after the check interval, or let the app stay in the foreground past it.

**Acceptance Scenarios**:

1. **Given** the app is running and `minimum` was raised above its version, **When** it returns to the foreground
   online and the last successful check is older than the check interval, **Then** the «must update» screen shows.
2. **Given** the same tablet never leaves the foreground (kept awake on its stand), **When** the check interval passes
   online, **Then** the app checks again by itself and the «must update» screen shows.

---

### User Story 3 - No internet (Priority: P1)

The counter tablet starts with no network. The app does not block: it opens as it does today and checks again once
it is online (APP-Q19).

**Why this priority**: the cashier must never be stopped by a check the app cannot make (`CLAUDE.md` §7: local-first).

**Acceptance Scenarios**:

1. **Given** no network, or a file that cannot be read, **When** the app opens, **Then** it opens normally and shows
   no update screen.
2. **Given** yesterday's check showed «must update», the cashier did not update, and the app is opened offline today,
   **When** it opens, **Then** it opens normally offline. **When** the network returns, **Then** it checks again and
   blocks if the update is still required (APP-Q19).
3. **Given** the «must update» screen is up and the cashier switches to another app, **When** the cashier comes back to it
   offline (the app was kept in the background, not closed), **Then** it opens normally too, and checks again once
   online (FR-007).

### Edge Cases

- **Malformed file, unknown shape, or a version string that does not parse:** treated as unreadable; the app opens
  normally and tries again at the next trigger.
- **The web build (PWA)** never runs the check; it always serves the newest bundle.
- **Flavours:** the staging and the production app each read their own entry (FR-002). Raising staging never blocks
  production.
- **One platform only:** iOS and Android have separate entries. Raising Android's `minimum` never blocks an iPhone.
- **The store has not caught up:** if `minimum` is raised before the version is available to everyone in that store
  (App Store review still pending, or a staged rollout on Google Play), the user sees a store page with no update and
  is stuck. BR-002 forbids raising it before then.
- **Local work:** the «must update» screen covers the app but deletes nothing. Device credentials, the role, the
  remembered business and anything queued for sync stay in device storage. The update keeps the same origin
  (ADR-0055 decision 3, spec 065 edge case «App update»), so the updated app finds them.
- **A forged or tampered file** can at most show the update screen. It cannot change data, open a session, or send the
  user to another site, because the store link is limited to the store hosts (FR-008).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The native build MUST check the version file, online only, on these triggers:
  - **cold start**: always, never skipped;
  - **return to the foreground** and **back online**: each is skipped when the last successful read is less than 15
    minutes old;
  - **the foreground timer**: while the app is in the foreground and online, a timer fires 15 minutes after the last
    successful read and is restarted by every successful read, so the throttle never skips it. It stops while the app
    is in the background.
  A cold start offline, or a return to the foreground offline (FR-007), leaves no successful read in force, so going
  back online checks at once.
- **FR-001b**: Only one read runs at a time. A trigger that comes while a read is running starts nothing. Each read
  carries an increasing number, and only the answer of the most recently started read can apply; any other answer,
  including one that arrives after its 10-second deadline, is discarded.
- **FR-001a**: A check never holds the app for long. At cold start the app keeps its existing loading notice for at
  most **3 seconds** while the read runs. If the answer arrives in time, it decides; if not, the app opens normally.
  Every read (cold start or later) ends after **10 seconds** in total: an answer arriving before that still applies (a
  «must update» answer then covers whatever is showing), and an answer arriving after it is discarded and counts as a
  failed check. The read passes `connectTimeout` and `readTimeout` of 10 000 ms to `CapacitorHttp`, and the app also
  keeps its own 10-second deadline, so a stalled native request can never hold it. Checks after the cold start run in
  the background, with no loading notice.
- **FR-002**: The version file MUST be a static file served by the POS host and changed only by a deploy. There is no
  API route (`CLAUDE.md` §6 allows no unguarded endpoint). Its URL is
  `https://<the flavour's POS host>/app-version/<flavour>.json`, with flavour `staging` or `production`. The same POS
  image serves both environments, so the flavour, not the host, picks the entry. The flavour is a build constant of the
  native build (`VITE_FLAVOUR`, set in the `native` mode of `apps/pos/vite.config.ts` from `FLAVOUR`, like
  `VITE_POS_HOST` in spec 065), never read from the page: on iOS both flavours run on `capacitor://localhost`.
- **FR-003**: The app MUST read the file through Capacitor's native HTTP (`CapacitorHttp`, part of `@capacitor/core`),
  never through a WebView `fetch`. On Android the app's own hostname is the POS host, and Capacitor answers it from the
  bundled assets (ADR-0055 decision 3). On iOS a WebView read from `capacitor://localhost` would need CORS. No new
  dependency is added.
- **FR-004**: The app MUST take its own version from the native app info (`App.getInfo()` of `@capacitor/app`, which
  reports Android `versionName` and iOS `CFBundleShortVersionString`), not from any `package.json`.
- **FR-005**: The app MUST show the «must update» screen when its version is below the `minimum` of its platform in
  the file. Otherwise it shows nothing. Under APP-Q18 every release raises `minimum` (BR-001), so every new version
  is a forced update. This slice shows no dismissible «update available» notice: the owners did not pick it.
- **FR-006**: The «must update» screen MUST cover every flow of the native build (start screen, counter, employee)
  and offer only the store button. It cannot be dismissed. The language switch stays available, and so does the
  system back gesture, which leaves the app.
- **FR-007**: No network, a timeout (FR-001a), a non-200 answer, an unreadable file or a version that does not parse
  MUST let the app open normally (APP-Q19). The decision of the last successful read (blocked or not) and its time live
  **in memory only**, for the life of the app process. Nothing goes to disk, and a cold start begins with no decision.
  While the app stays in the foreground, that decision stands until the next successful read: a «must update» screen
  does not lift because the network drops or a later read fails. When the app **returns to the foreground offline**,
  the decision is cleared and the app opens normally, as at an offline cold start, whether or not the process was kept
  (APP-Q19: «يفتح ويتأكد تاني»); it checks again as soon as it is online.
- **FR-008**: The store button opens the `store_url` of the platform from the file, outside the app, and only when
  its host is one of `apps.apple.com`, `testflight.apple.com` or `play.google.com` over `https`. With any other value
  the screen still blocks, and it shows one line asking the user to update from the store instead of a button.
- **FR-009**: All text MUST come from `packages/i18n` in Arabic and English, Arabic and RTL first (spec 065 FR-010).

### Key Entities

- **Version file**: one JSON object per flavour:
  `{ "ios": { "minimum": "1.3.0", "latest": "1.3.0", "store_url": "https://apps.apple.com/…" }, "android": { … } }`.
  Versions are `MAJOR.MINOR` or `MAJOR.MINOR.PATCH`, numbers only, and a missing `PATCH` counts as 0. The format is
  fixed from the first signed build, because an installed app cannot learn a field added later. The app in this slice
  reads only `minimum` and `store_url`. `latest` is written with the same value under APP-Q18, so that if Abu Salem
  later picks the recommended option (a notice for new versions, a forced update only when the server can no longer
  serve an old one), new app versions can read `latest` while older apps keep obeying `minimum`, with no format change.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001** (APP-Q18): every new version of «PosPay Business» is a forced update. When a version is released on a
  platform, that platform's `minimum` (and `latest`) in the flavour's file are raised to it.
- **BR-002**: `minimum` is raised for a flavour and a platform only once that version can be installed by everyone who
  receives that flavour through its channel. Otherwise users see an update screen and a store page with nothing to
  install. Per channel:
  - **production, iOS**: approved and released on the App Store to all users (a phased release finished, or released
    to all at once);
  - **production, Android**: the production track at 100 % rollout;
  - **staging, iOS**: the build is processed in TestFlight and available in every tester group that uses the staging
    app (the internal group and, once used, the external group after Apple's beta review, plan 065 step M-2);
  - **staging, Android**: the build is available in every Play testing track that serves the staging app (internal
    testing today).
- **BR-003** (APP-Q19): opened offline, from a cold start or back from the background, the app opens normally even
  right after a «must update» answer, and it checks again once online.
- **BR-004**: raising `minimum` in the production file is part of a production deploy, so it needs Waleed's typed yes,
  like any production change. The staging file is changed by the orchestrator through a normal staging deploy.

### Schema changes

None. No table, column, RLS policy or index.

### API contract

No endpoint.

- **Files**: `apps/pos/public/app-version/staging.json` and `apps/pos/public/app-version/production.json`, built into
  the POS image.
- **Serving**: `deploy/pos-nginx.conf` gains `location /app-version/ { add_header Cache-Control "no-cache"; try_files
  $uri =404; }`, so a missing file is a 404 and not the SPA's `index.html`. That is a `deploy/**` edit, coordinated
  with the orchestrator's deploy lane before the sub-PR.
- **Shape**: a Zod schema in `packages/contracts/src/app-version.ts`, exported from the contracts index. The app parses
  the file with it, and a unit test validates both committed files against it.
- **Initial content**: both files start with `minimum` and `latest` at the first signed version of M-2a, and
  `store_url` set to the internal-testing pages until the store records exist (O-2b).

### Permissions

None. The file carries no tenant or personal data.

### Events

None published, none consumed.

### Test plan

- **Unit** (`apps/pos`, pure, no Capacitor):
  - `VER-T01` version parsing: `1.10.0` > `1.9.0`; `1.3` equals `1.3.0`; `1.3.0-beta`, `v1.3`, an empty string and
    `1..3` are unreadable.
  - `VER-T02` the decision: installed below `minimum` → must update; equal or above → nothing; an unreadable
    installed version or file → nothing.
  - `VER-T03` the store link filter: the three store hosts over `https` pass; `http`, a lookalike host or another
    site fails.
  - `VER-T04` both committed files parse with the contracts schema.
- **UI tests** (Vitest + Testing Library, each asserting what is on screen, `CLAUDE.md` §9; the native reads mocked
  behind one platform module):
  - `VER-T05` the «must update» screen covers the start screen, the counter flow and the employee flow, and shows
    only the store button.
  - `VER-T06` a read requires an update and the screen shows; the app is closed and started again offline → the
    normal start screen (nothing was stored); the network returns → a fresh read shows the screen again.
  - `VER-T07` a malformed file → the normal start screen.
  - `VER-T08` returning to the foreground after `minimum` was raised → the screen appears.
  - `VER-T09` the throttle: a foreground or back-online trigger within 15 minutes of a successful read makes no read;
    a cold start always reads; a back-online trigger after an offline cold start reads at once.
  - `VER-T10` back online after an offline start → checks again and blocks when required (APP-Q19).
  - `VER-T11` a store link outside the allowed hosts → no button, the «update from the store» line.
  - `VER-T12` flavour and platform isolation, table-driven over staging/production × iOS/Android with a different
    `minimum` in each entry: the requested URL is the flavour's file, and only the matching platform's entry can show
    the screen (SC-004).
  - `VER-T13` with fake timers and a read that takes a few seconds, the app stays in the foreground and online for 45
    minutes with no other event: a read happens every 15 minutes after the previous one (none skipped), and once
    `minimum` is raised the screen appears.
  - `VER-T14` a stalled read: the normal start appears after 3 seconds; a «must update» answer at 8 seconds still
    blocks; an answer after 10 seconds is discarded.
  - `VER-T15` single flight: a foreground and a back-online trigger during a running read start no second read; an
    older read's late answer showing the old `minimum` never lifts a block set by a newer read.
  - `VER-T16` the screen is up, the app goes to the background, and it returns to the foreground offline without the
    process being killed → the normal flow shows; the network returns → a fresh read shows the screen again.
- **Device checks** (M-2a, on the first signed builds): an installed build below `minimum` on staging shows the
  screen and opens the right store page; the read goes through native HTTP on Android, where a WebView `fetch` to the
  POS host would be answered from the bundled assets.
- **RLS / `EXPLAIN`**: not applicable (no table, no query).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An app below its platform's `minimum` cannot reach any flow while online, once its read has answered
  (within 3 seconds at a cold start on a working network, FR-001a).
- **SC-002**: No network, and no unreadable file, ever stops the app from opening.
- **SC-003**: Making a version mandatory needs only a file change and a POS deploy, with no app release.
- **SC-004**: Raising one flavour or one platform never blocks the other.

## Assumptions

- M-2a sets the native versions as `MAJOR.MINOR.PATCH`. Today they are `1.0` (`versionName` in
  `apps/business/android/app/build.gradle`, `MARKETING_VERSION` in the Xcode project), which FR-004's parser reads as
  1.0.0. M-2a's release step refuses a version that does not parse, so a build can never silently skip the check.
- The store pages exist before the first public release (MOB-17). Until then the staging file links to the internal
  testing pages.
- When during the day a mandatory release is turned on is a release-step choice for the orchestrator and Waleed
  (BR-004). Under APP-Q18 every release stops each device once, until it is updated.
- Opening `store_url` outside the app relies on Capacitor sending a non-app host to the system. M-2a checks it on both
  platforms; if it does not, the sub-PR adds the smallest native call behind the same platform module, with no new
  dependency.
- This slice depends on M-1d (plan row M-1f), and M-2a depends on this slice.
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
