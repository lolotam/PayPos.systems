# Feature Specification: «PosPay Business» app shell (MOB M-1)

**Feature Branch**: `claude/mob-m1-0-spec`

**Created**: 2026-10-23

**Status**: Draft (M-1·0)

**Input**: Track MOB, plan row M-1·0 ([plan.md](plan.md)). Wrap the existing `apps/pos` build in a Capacitor shell for
iOS and Android, as decided in `docs/adr/0055-store-apps-capacitor-shell.md`. Owner decisions: APP-Q1 … APP-Q8
([owner-questions.ar.md](owner-questions.ar.md)); questions APP-Q9 … APP-Q18 (batch 58), answered by Waleed on
2026-10-23 (Abu Salem's picks pending, binding if they differ), so M-1a … M-1f need no further owner question of
this spec. One owner answer from spec 067 is still open: who sees FR-017's line (SO-Q1).

**Scope.** The shell, its start screen, offline cold start, the checks of the auth spike (M-1c), and what is hidden on
native. Out of scope: signed builds and store uploads (M-2), the cashier selling screens (MOB-18, not built yet in the
PWA either), native push (MOB-19), the minimum-version check (M-1f, its own spec), the customer app (MOB-16).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The counter tablet runs as an app (Priority: P1)

At «الأميرة», the manager installs «PosPay Business» on the counter tablet, picks «جهاز الكاونتر», pairs it the same way
the PWA is paired today (pairing code, manager approval), and a staff member opens a PIN session on it. The next morning
the tablet starts with no internet: the app opens, still paired, and shows the offline notice the PWA shows today.

**Why this priority**: the counter device is the first business use of the app and the base for cashier mode (MOB-18).

**Independent Test**: install the debug build on an Android tablet against staging, pair it, open a staff PIN session,
kill the app, turn off the network, reopen it.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the user picks «جهاز الكاونتر» and enters a pairing code that a manager approves,
   **Then** the device is paired exactly as in the PWA, and the choice is remembered.
2. **Given** a paired device, **When** the app is restarted with no network, **Then** it opens from the bundled assets
   on the paired-device screen with the existing offline notice, and no data stored on the device is lost.
3. **Given** a paired device and a network, **When** a staff member signs in with PIN, **Then** the staff session opens
   and survives an app restart until its existing deadline (ADR-0019), on Android and on the iOS simulator (M-1c).

---

### User Story 2 - An employee uses her own phone (Priority: P2)

Sara installs the app on her iPhone, picks «حسابي كموظفة», connects the app to «الأميرة» (APP-Q9), and signs in with
her phone and the code (personal OTP, ADR-0027). The app remembers her salon, so next time she only signs in.

**Why this priority**: it is the employee half of «PosPay Business»; it depends on how the app learns the salon
(APP-Q9) and on the iOS session check (M-1c).

**Independent Test**: on an Android phone against staging, connect to a seeded test business, sign in with the test
OTP, restart the app; repeat (a)–(c) of M-1c on the iOS simulator.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the employee picks «حسابي كموظفة» and connects to her business (APP-Q9), **Then**
   the app remembers the business and shows the personal sign-in.
2. **Given** a remembered business, **When** she signs in with phone and code, **Then** her personal session opens and
   survives a restart until its eight-hour deadline (ADR-0027).
3. **Given** no remembered business, **When** she opens «حسابي كموظفة», **Then** the app shows how to connect (APP-Q9),
   never a field to type an identifier (ADR-0027: «the UI does not ask staff to type identifiers»). Pasting the whole
   link the manager sent (APP-Q9's ⭐ «عندي لينك») is not typing an identifier: the app reads the identifiers out of the
   link with the same parser as an opened link (FR-012) and shows the employee no identifier.
4. **Given** the manager's link and the app installed, **When** she taps the link (app closed or already open),
   **Then** the app opens on the employee flow with that business remembered (FR-012). **Accepted in M-2**, once O-6
   can publish the association files; in M-1 the same handling is accepted through the paste and through a link handed
   to the app by the test harness.

---

### User Story 3 - What the app cannot do yet is hidden, not broken (Priority: P3)

On the iPhone app, Sara does not see passkey enrolment or any attendance (QR camera or passkey), and the Web Push
control is absent on both platforms, instead of a button that fails. What replaces them is one line pointing to the web app with a link (APP-Q17).

**Why this priority**: a store build must never show a control that cannot work (attendance on iOS waits for the real-iPhone
check M-1c-ii, and passkeys also for #536 and O-4; Web Push does not exist inside a WebView; native push is MOB-19).

**Independent Test**: render the personal screens with the platform port reporting each capability off and check what
is on screen.

**Acceptance Scenarios**:

1. **Given** the native build on iOS before M-1c-ii passes, **When** the personal area opens, **Then** passkey
   enrolment and all attendance (QR camera and passkey) are absent, and what APP-Q17 decides is shown (working
   assumption: the «use the web app» line).
2. **Given** the native build on either platform, **When** any screen that would offer Web Push renders, **Then** the
   control is absent.
3. **Given** the web build (PWA), **When** the same screens render, **Then** they behave exactly as before.

---

### User Story 4 - Changing the phone's role (Priority: P3)

The manager hands a tablet that was an employee's phone to the counter. In the app settings she picks «تغيير نوع
الجهاز» (anyone holding the device may do this, after a clear confirmation; APP-Q16); with the network on, the app ends every session on it at the server, clears private forms, forgets the remembered business, and shows the
start screen again.

**Why this priority**: rare, but a wrong role on a shared device would show one person's data to another.

**Independent Test**: switch from employee to counter and back; check that no session, phone number or code survives.

**Acceptance Scenarios**:

1. **Given** a signed-in employee, **When** the role is changed, **Then** the personal session is signed out, private
   forms and caches are cleared (ADR-0019 / ADR-0027 rules), and the start screen shows.
2. **Given** a paired counter device, **When** the role is changed, **Then** the app warns that the device pairing will
   be removed from this device, and only after confirmation removes it locally (the manager can also revoke it from the
   back office, as today).

### Edge Cases

- **First launch with no network**: the start screen shows; both choices say that the first connection needs the
  internet. Nothing is stored.
- **App update**: the bundle changes but the origin must not. The Android `server.hostname`/scheme and the iOS scheme
  are fixed from the first build forever, because changing them is like moving to a new site: IndexedDB (the pairing,
  the outbox queue) would be lost.
- **Staging and production flavours on one phone**: separate apps, separate storage; nothing is shared.
- **A link for another business** (APP-Q9): connecting to a second business replaces the remembered one only after the
  current session is signed out; like the PWA, the app holds one personal session at a time.
- **Session deadline passes while the app is in the background**: on resume the app shows sign-in, as the PWA does.
- **Camera permission denied** (Android QR attendance): the attendance screen's existing camera-failure path runs
  (`use-attendance-camera.ts` calls its failure handler), and the native build adds one line on how to allow the camera
  in the phone settings.
- **The iOS session check fails in M-1c**: User Stories 1.3 and 2.2 cannot pass on iOS; the track stops at M-1c as
  ADR-0055 decision 3 says. This spec does not change `packages/auth`.
- **Back button on Android**: on the start screen and on a signed-in home screen it leaves the app; it never navigates
  back into a signed-out session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The native build MUST open on a start screen with two choices, «جهاز الكاونتر» and «حسابي كموظفة», until
  one is chosen, then open that flow directly on every later launch.
- **FR-002**: The counter flow MUST be the existing paired-device flow of the PWA, unchanged (pairing, waiting, staff
  login, attendance by card, offline notice).
- **FR-003**: The employee flow MUST be the existing personal flow of the PWA, reached without the `/personal` path and
  with the business learned as APP-Q9 decides, then remembered on the device as a routing hint only (ADR-0027).
- **FR-004**: The app MUST start with no network from the bundled assets and keep everything the PWA keeps on the
  device (Dexie stores) across restarts and app updates.
- **FR-005**: The native build MUST NOT register a service worker; the web build MUST keep registering it exactly as
  today.
- **FR-006**: A single platform port MUST report, per capability, whether it is available: Web Push (never on native);
  passkeys (off on both platforms until O-4 is done, on iOS also until #536, on Android also only if M-1c's check
  passes); attendance camera (Android per M-1c; **iOS off until M-1c-ii passes on a real iPhone**, ADR-0055 decision 3).
  Screens read the port; no screen tests the platform itself.
- **FR-007**: A capability that is off MUST NOT offer a working-looking control: its button is hidden and one line says
  it is available in the web app, with a link that opens it (APP-Q17, PP-42.9; Waleed, 2026-10-23; Abu Salem's pick pending and binding if it differs).
- **FR-008**: Anyone holding the device may change its role, after a clear confirmation; a counter device then needs
  a manager's approval to be paired again, as today (APP-Q16, PP-42.8; Waleed, 2026-10-23; Abu Salem's pick pending and binding if it differs). A role change
  **needs the network**: the staff and personal sessions are HttpOnly cookies that page code cannot see or delete, so
  for each session kind the device can hold (staff, personal) the app calls the existing server sign-out; a sign-out
  counts as done only when the server confirms it, or gives the auth module's **explicit** «no session to end»
  result for that route. A plain 401 never counts, because it can also mean the request itself was refused (an
  untrusted origin, a bad authentication context) while the session is still alive. The results are fixed by spec 067
  (`docs/specs/067-auth-explicit-signout/spec.md`, built in its sub-PR 067-1): both routes answer 200 `SIGNED_OUT` or
  200 `NO_SESSION`, never 401, and both count as done; 403 `FORBIDDEN` (a wrong `Origin`) and 503 `NOT_READY` (a
  configuration problem) are refusals. Anything else (no network, a timeout, a refusal, a server error, an ambiguous
  answer) stops the change with a message. **Prerequisite:** the role change is not implemented before the server-side
  session fence of issue #581 (spec 067 D-6): without it, a sign-in racing the role change could leave a usable
  session after the change completes, breaking BR-001. As soon as one sign-out is done, the app clears that session's private forms
  and caches at once (ADR-0027: logout clears them), even if the other sign-out then fails; the role, the
  remembered business and the pairing stay until every sign-out is done. Then it forgets the remembered
  business and, for a counter device, removes the local pairing. Order: the confirmation (with its pairing warning on a
  counter device) comes **first**, before any sign-out; cancelling it changes nothing; nothing «in progress» is stored,
  so after a partial failure the change is simply started again, with the confirmation again.
- **FR-009**: Nothing new is stored about the person: no phone number, code or session token is persisted by the app
  beyond what the PWA already does (ADR-0019 online-only rule).
- **FR-010**: Every string MUST come from `packages/i18n` in Arabic and English; Arabic and RTL first; logical CSS only.
- **FR-011**: The app learns the employee's business on first use in **both** ways: the manager's link (FR-012) and a
  QR code scanned in the app (FR-014) (APP-Q9, PP-42.1; Waleed, 2026-10-23; Abu Salem's pick pending and binding if it differs).
- **FR-012**: The app MUST handle the manager's link (in M-1: the parsing, the routing and
  the paste; the operating system opening the app from a tapped link is verified in M-2 with O-6) `https://<pos host>/personal?company=…&
  business=…` on a cold start (the launch link) and on a warm start (a link opened while the app runs) the same way: it
  accepts only that host and path, parses the two values with the existing `personalWorkspace` schema of
  `packages/contracts`, ignores every other parameter, and then: with no role or the employee role, it sets the employee
  role and remembers the business (when a different business may have a session, it first asks its own short
  confirmation «تبدّلي لصالون تاني؟», not the role-change text (#554 item 1); cancelling keeps the current business and
  session; then it signs out the personal session as FR-008 does, and with no network the link is refused with the
  same message, changing nothing). The business switch does not wait on the session fence of #581: the device keeps
  the employee role, so a racing sign-in can only leave the personal session its own fresh OTP just created (spec 067
  D-6), never a counter or another person's session left behind by the switch, and the server still decides
  eligibility on every request (BR-002); orchestrator, 2026-10-23. With
  the counter role, it does not switch, and offers the role change of FR-008. An invalid or foreign link changes
  nothing and shows the existing «ask your manager for your link» message. The «عندي لينك» paste uses the same parser.
- **FR-013**: The device credentials and the remembered business MUST NOT travel in an OS backup to another device:
  the Android project sets `android:allowBackup="false"` **and** `android:dataExtractionRules` excluding the app's
  storage from both `<cloud-backup>` and `<device-transfer>` (Android 12 and later ignore `allowBackup` for device
  transfer), plus `android:fullBackupContent` excluding it for older versions; the iOS project keeps that storage out
  of iCloud and device backups. A restored phone starts at the start screen and
  pairs again. Built and checked in M-1a.
- **FR-014**: The in-app QR scan reads a QR code whose content is exactly the manager's link of FR-012 and handles it
  with the same parser and the same rules (host and path check, role precedence, confirmation before a business
  switch). It uses the attendance camera capability of the platform port (FR-006): where the camera is off (iOS
  until M-1c-ii passes; Android if M-1c's check fails), the scan option is hidden with the FR-007 line and the
  employee connects by the link or the paste. The QR itself is shown by a back-office screen in `apps/admin` that
  gives the manager each employee's personal link and its QR code; that screen is its own sub-PR (plan M-1g),
  agreed with the web manager because it is in `apps/admin`.
- **FR-015**: On first launch the app uses the phone's language: Arabic when the phone is in Arabic, English for any
  other language; the user can change it afterwards with the existing language switch (APP-Q12, PP-42.4; Waleed, 2026-10-23; Abu Salem's pick pending and binding if it differs).
- **FR-016**: The app follows the device's rotation on tablets and on phones (APP-Q14, PP-42.6; Waleed, 2026-10-23; Abu Salem's pick pending and binding if it differs); every screen
  of the native build must work in both orientations.
- **FR-017**: Before MOB-15, an owner or a manager (exactly which roles count is SO-Q1 of spec 067, still open) who
  picks «حسابي كموظفة» sees what an employee sees (sign-in and
  their own attendance) plus one small line «لوحة الإدارة على الويب» with a link to the back office (APP-Q15,
  PP-42.7; Waleed, 2026-10-23; Abu Salem's pick pending and binding if it differs). This works only for an owner or
  manager who also has an employee record in that business, because a personal session is issued only to a linked
  employee (ADR-0027). Showing the line needs a role signal the personal session does not carry today. Spec 067 Part B
  (its sub-PR 067-2) adds it, and who counts waits on the owners' answer to SO-Q1 (spec 067 `owner-questions.ar.md`): `TODO(spec)`
  until then, and until it exists the line is not shown to anyone.

### Key Entities

- **Device role**: the start-screen choice stored on the device (`counter` or `employee`); not sent to the server.
- **Remembered business**: `company_id` and `business_id` stored on the device as routing hints for the personal
  sign-in (ADR-0027); never eligibility.
- **Capability report**: what the platform port says is available on this build and platform.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: One role per installation. Changing it ends every session on the device first (FR-008).
- **BR-002**: The remembered business is a hint; the server still decides eligibility on every request (ADR-0027).
- **BR-003**: A hidden capability is hidden for everyone on that platform build; there is no per-user override.
- **BR-004**: The business is learned on first use by the manager's link or by its QR code (APP-Q9: both).

### Owner decisions (batch 58: Waleed's picks on 2026-10-23; Abu Salem's pending, and binding if they differ)

| Question | Waleed's pick | Lands in |
|---|---|---|
| APP-Q9 | both: the link and a QR code (FR-011, FR-012, FR-014) | M-1a (link, paste), M-1g (back-office QR screen), M-1h (in-app scan) |
| APP-Q10 | today's PosPay icon and colours plus a small mark that tells it from the customer app | M-1e |
| APP-Q11 | the logo with «PosPay Business» written under it | M-1e |
| APP-Q12 | the phone's language, changeable (FR-015) | M-1a |
| APP-Q13 | «تجربة» on the icon and a coloured strip on every staging screen | M-1e |
| APP-Q14 | follows the device on tablets and phones (FR-016) | M-1a |
| APP-Q15 | the employee view plus a «لوحة الإدارة على الويب» line (FR-017) | M-1a |
| APP-Q16 | anyone holding the device, after a clear confirmation; counter re-pairing needs a manager (FR-008) | M-1a |
| APP-Q17 | hide the button, one line with a link to the web app (FR-007) | M-1d |
| APP-Q18 | «must update» with every new version | M-1f (its own spec) |

Not asked, because already decided: card attendance on the counter device is online-only
(`apps/pos/src/attendance/api/clock-by-card.ts`), and what the cashier does offline is set by `CLAUDE.md` §7 (the
POS is local-first) and §8 (payment state only from the server) for the selling slices of MOB-18.

### Schema changes

None. No table, column, RLS policy or index changes. The app stores the device role and the remembered business in
the browser storage of the native build (the same IndexedDB layer the PWA uses), never in Postgres.

### API contract

No new endpoint. The app calls the existing routes of the PWA (device pairing, staff PIN/OTP, personal OTP,
attendance, and the existing sign-out routes for FR-008). The Android origin is already the POS host. The iOS origin
`capacitor://localhost` is **not** a trusted origin today: ADR-0027 requires exact configured POS origins, and that
origin is shared by every Capacitor iOS app. Trusting it is `TODO(spec)` — it needs an ADR-0027 addendum agreed with
the web manager (issue #549, next to #536 for passkeys) **before** plan step O-1b adds it to `AUTH_TRUSTED_ORIGINS` and
the API CORS origins on staging (plan O-1b). Until then the iOS session checks of M-1c cannot run; the Android ones
need no origin change. For the link (APP-Q9: link and QR), two things are needed, both for the **POS host** the manager's link
uses (`pos.pospay.systems`, `pos.staging.pospay.systems`), never the passkey relying-party host of O-4: the native
projects declare the link (iOS Associated Domains entitlement `applinks:<pos host>`; Android a verified
`intent-filter` with `autoVerify` for `https://<pos host>/personal`), the Android one built in M-1a and the iOS one in M-1b (it needs an Xcode project edit checked on the macOS runner); and the POS host serves the
matching association files (`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`), plan step
O-6, an operations step of its own. Those files need the Apple Team ID and the Play App Signing certificate
fingerprint, which exist only once the company's accounts and signing keys do (O-2, O-3), so a tapped link opens the
app only from M-2 on; until then the employee connects through the «عندي لينك» paste.

### Permissions

No new permission string. Device pairing keeps the manager approval it has today; staff and personal sessions keep
ADR-0019 and ADR-0027. Phone-level permissions the app asks for: the camera (QR attendance, Android, when used) and,
on iOS, nothing else in M-1.

### Events

None published, none consumed.

### Test plan

- **Domain unit**: none (no business arithmetic; `packages/domain` is not touched).
- **UI tests** (`apps/pos`, Vitest + Testing Library, each asserting what is on screen, `CLAUDE.md` §9):
  `MOB-T01` start screen shows both choices on first launch · `MOB-T02` a stored choice opens its flow directly ·
  `MOB-T03` employee flow with no remembered business shows the connect instruction and no identifier field (the paste box for the whole link is allowed) ·
  `MOB-T04` employee flow with a remembered business shows the personal sign-in · `MOB-T05` passkey and attendance controls absent when
  the port reports them off, and the APP-Q17 line with its link to the web app shown · `MOB-T06` Web Push control absent on native ·
  `MOB-T07` the web build renders the same screens unchanged · `MOB-T08` role change signs out, clears forms and shows the
  start screen, the server sign-out was called for each open session, and the remembered business is gone from device
  storage · `MOB-T10` with no network the role change is refused with its message and nothing is cleared · `MOB-T09` counter role change asks for
  confirmation, and only after it the pairing credentials are gone from device storage (cancel keeps them) ·
  `MOB-T11` a valid manager link on a cold start opens the employee flow with the business remembered · `MOB-T12` the
  same link while the app runs does the same · `MOB-T13` a link with a foreign host, a wrong path or invalid ids
  changes nothing and shows the «ask your manager» message · `MOB-T14` a link on a counter-role device offers the role
  change and switches nothing by itself · `MOB-T15` pasting a valid manager link in «عندي لينك» connects the business
  like an opened link · `MOB-T16` a link for a different business while a personal session is open signs out at the
  server first, after the confirmation, and only then remembers the new business (cancelling the confirmation keeps
  the current one) · `MOB-T17` the same link with no network is refused with its
  message and changes nothing · `MOB-T18` a role change counts the explicit «no session to end» result as done and
  continues, and treats a plain 401 as a failure that stops it · `MOB-T19` one sign-out done and the other failing:
  the first session's private forms are already cleared, the role, the pairing and the remembered business are still
  there after the success and after the failure, and only a new, confirmed change that finishes removes them ·
  `MOB-T20` a valid QR scanned in the app connects the business like the link, and where the camera port is off the
  scan option is hidden with the FR-007 line · `MOB-T21` first launch with the phone in Arabic shows Arabic, with the
  phone in any other language shows English, and the language switch still changes it · `MOB-T22` the start screen,
  the counter flow and the personal flow render without cut-off controls in both orientations (tablet and phone
  viewports) · `MOB-T23` with the role signal present the «لوحة الإدارة على الويب» line and its link show, without it
  they do not.
- **Build checks** (M-1a): the `native` build output registers no service worker; the web build output still does; a
  staging and a production debug build carry different app ids and their own API origin; the Android manifest and the
  iOS project exclude the app's storage from cloud backup and device transfer (FR-013: `allowBackup`,
  `dataExtractionRules` and `fullBackupContent` all present); the Android project carries the
  verified `intent-filter` (link verification itself is O-6, in M-2). **Build checks** (M-1b): the iOS project
  carries the Associated Domains entitlement in its entitlements file (an unsigned simulator build cannot embed it).
- **Device checks** (M-1c, recorded in [plan.md](plan.md)): (a) pairing, (b) staff PIN session, (c) personal OTP
  session, each surviving a restart; (d) attendance QR camera; (e) passkey behaviour. Android on a real phone; iOS
  (a)–(c) on the simulator, (d)–(e) on the first real iPhone (M-1c-ii).
- **RLS negative**: not applicable (no tenant table).
- **Queries**: not applicable (no `queries/` file).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a paired Android tablet, the app opens to the paired-device screen within 3 seconds with no network.
- **SC-002**: A staff PIN session and a personal session each survive an app restart on Android and on the iOS
  simulator (M-1c).
- **SC-003**: No screen of the native build offers a working-looking control for a capability the platform port
  reports as off.
- **SC-004**: The web build's behaviour is unchanged: every existing `apps/pos` UI test passes without edits.
- **SC-005**: A role change leaves no session, phone number or code on the device.

## Assumptions

- The start screen's wording and the place of «تغيير نوع الجهاز» (a settings entry) are UI details decided in M-1a
  with the `packages/ui` components; who may use it is APP-Q16.
- A personal phone may not be both an employee phone and a counter device at the same time (BR-001). If the owners
  later want one phone to do both, that is a new decision.
- On iOS all attendance stays hidden until M-1c-ii passes on a real iPhone, and passkey attendance also until #536 and
  O-4 are done; the employee uses the PWA or the counter device's card clock meanwhile.
- Web Push stays the PWA's channel until native push (MOB-19); the app shows no push control.
- The cashier selling screens are not in the PWA yet; when they land (MOB-18) they appear in the counter flow with no
  change to this shell.
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
