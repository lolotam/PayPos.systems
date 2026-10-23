# Feature Specification: «PosPay Business» app shell (MOB M-1)

**Feature Branch**: `claude/mob-m1-0-spec`

**Created**: 2026-10-23

**Status**: Draft (M-1·0)

**Input**: Track MOB, plan row M-1·0 ([plan.md](plan.md)). Wrap the existing `apps/pos` build in a Capacitor shell for
iOS and Android, as decided in `docs/adr/0055-store-apps-capacitor-shell.md`. Owner decisions: APP-Q1 … APP-Q8
([owner-questions.ar.md](owner-questions.ar.md)); new questions APP-Q9 … APP-Q18 (PENDING), asked in one batch so
M-1a … M-1f need no further owner question.

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
   never a field to type an identifier (ADR-0027: «the UI does not ask staff to type identifiers»).

---

### User Story 3 - What the app cannot do yet is hidden, not broken (Priority: P3)

On the iPhone app, Sara does not see the passkey enrolment or passkey attendance, and the Web Push control is absent on
both platforms; a short line tells her to use the web app for those, instead of a button that fails.

**Why this priority**: a store build must never show a control that cannot work (passkeys on iOS wait for #536 and
O-4; Web Push does not exist inside a WebView; native push is MOB-19).

**Independent Test**: render the personal screens with the platform port reporting each capability off and check what
is on screen.

**Acceptance Scenarios**:

1. **Given** the native build on iOS, **When** the personal area opens, **Then** passkey enrolment and passkey
   attendance are absent and the «use the web app» line is visible.
2. **Given** the native build on either platform, **When** any screen that would offer Web Push renders, **Then** the
   control is absent.
3. **Given** the web build (PWA), **When** the same screens render, **Then** they behave exactly as before.

---

### User Story 4 - Changing the phone's role (Priority: P3)

The manager hands a tablet that was an employee's phone to the counter. In the app settings she picks «تغيير نوع
الجهاز»; the app signs out every session on it, clears private forms, forgets the remembered business, and shows the
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
- **FR-006**: A single platform port MUST report, per capability, whether it is available: Web Push (never on native),
  passkeys (off on iOS until #536 and O-4 are done; on Android per M-1c's result), camera (per M-1c). Screens read the
  port; no screen tests the platform itself.
- **FR-007**: A capability that is off MUST hide its control; what replaces it is [NEEDS CLARIFICATION: APP-Q17 — ⭐ a
  line pointing to the web app with a link].
- **FR-008**: Who may change the device's role: [NEEDS CLARIFICATION: APP-Q16 — ⭐ anyone holding the device, after a
  clear confirmation]. Changing it MUST sign out every session on the device, clear private forms and caches,
  forget the remembered business, and, for a counter device, remove the local pairing only after confirmation.
- **FR-009**: Nothing new is stored about the person: no phone number, code or session token is persisted by the app
  beyond what the PWA already does (ADR-0019 online-only rule).
- **FR-010**: Every string MUST come from `packages/i18n` in Arabic and English; Arabic and RTL first; logical CSS only.
- **FR-011**: How the app learns the employee's business on first use: [NEEDS CLARIFICATION: APP-Q9 — the manager's
  link opens the app (⭐ recommended), a QR code in the back office scanned in the app, or both].

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
- **BR-004**: How the business is learned on first use: [NEEDS CLARIFICATION: APP-Q9].

### Owner decisions this spec waits on (all PENDING, one batch)

| Question | Decides | Needed by |
|---|---|---|
| APP-Q9 | how the employee connects the app to her business the first time | M-1a (employee connect step) |
| APP-Q10 | app icon and colours | M-1e |
| APP-Q11 | splash screen | M-1e |
| APP-Q12 | language on first launch | M-1a |
| APP-Q13 | how the staging flavour is marked | M-1e |
| APP-Q14 | screen rotation on tablets and phones | M-1a |
| APP-Q15 | what an owner or manager sees in the app before MOB-15 | M-1a |
| APP-Q16 | who may change the device's role | M-1a |
| APP-Q17 | what replaces a control that is off on native | M-1d |
| APP-Q18 | when an update is forced (M-1f's policy) | M-1f |

Not asked, because already decided: card attendance on the counter device is online-only
(`apps/pos/src/attendance/api/clock-by-card.ts`), and what the cashier does offline is set by `CLAUDE.md` §7 (the
POS is local-first) and §8 (payment state only from the server) for the selling slices of MOB-18.

### Schema changes

None. No table, column, RLS policy or index changes. The app stores the device role and the remembered business in
the browser storage of the native build (the same IndexedDB layer the PWA uses), never in Postgres.

### API contract

No new endpoint. The app calls the existing routes of the PWA (device pairing, staff PIN/OTP, personal OTP,
attendance). Environment changes on staging, done by the web manager (plan O-1): add `capacitor://localhost` to
`AUTH_TRUSTED_ORIGINS` and the API CORS origins; the Android origin is already the POS host. If APP-Q9 picks the link,
the POS host also serves the app-link association files (iOS `applinks:`, Android App Links), an operations step
listed with O-4.

### Permissions

No new permission string. Device pairing keeps the manager approval it has today; staff and personal sessions keep
ADR-0019 and ADR-0027. Phone-level permissions the app asks for: the camera (QR attendance, Android, when used) and,
on iOS, nothing else in M-1.

### Events

None published, none consumed.

### Test plan

- **Domain unit**: none (no business arithmetic; `packages/domain` is not touched).
- **UI tests** (`apps/pos`, Vitest + Testing Library, each asserting what is on screen, `CLAUDE.md` §9):
  `MOB-01` start screen shows both choices on first launch · `MOB-02` a stored choice opens its flow directly ·
  `MOB-03` employee flow with no remembered business shows the connect instruction and no identifier field ·
  `MOB-04` employee flow with a remembered business shows the personal sign-in · `MOB-05` passkey controls absent and
  the web-app line visible when the port reports passkeys off · `MOB-06` Web Push control absent on native ·
  `MOB-07` the web build renders the same screens unchanged · `MOB-08` role change signs out, clears forms and shows the
  start screen · `MOB-09` counter role change asks for confirmation before removing the pairing.
- **Build checks** (M-1a): the `native` build output registers no service worker; the web build output still does; a
  staging and a production debug build carry different app ids and their own API origin.
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
- **SC-003**: No screen of the native build shows a control for a capability the platform port reports as off.
- **SC-004**: The web build's behaviour is unchanged: every existing `apps/pos` UI test passes without edits.
- **SC-005**: A role change leaves no session, phone number or code on the device.

## Assumptions

- The start screen's wording and the place of «تغيير نوع الجهاز» (a settings entry) are UI details decided in M-1a
  with the `packages/ui` components; who may use it is APP-Q16.
- A personal phone may not be both an employee phone and a counter device at the same time (BR-001). If the owners
  later want one phone to do both, that is a new decision.
- Attendance by passkey on iOS stays hidden until issue #536 and O-4 are done; the employee uses the PWA or the counter
  device's card clock meanwhile.
- Web Push stays the PWA's channel until native push (MOB-19); the app shows no push control.
- The cashier selling screens are not in the PWA yet; when they land (MOB-18) they appear in the counter flow with no
  change to this shell.
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
