# Feature Specification: Explicit, idempotent staff sign-out (and the personal session's back-office signal)

**Feature Branch**: `docs/spec-auth-explicit-signout` (spec); code sub-PRs below

**Created**: 2026-10-23

**Status**: Draft. Part A needs no owner answer. Part B waits on SO-Q1 ([owner-questions.ar.md](owner-questions.ar.md)).

**Input**: Issue #554 items 2 and 4, raised by the reviews of #548 and #558 on `docs/specs/065-mob-app-shell/spec.md`.
Item 2: both staff sign-out routes need an explicit, idempotent «no session to end» result, because spec 065 FR-008
(the device role change) must not count a plain 401 as signed out. Item 4: FR-017's «لوحة الإدارة على الويب» line
needs a role signal that the personal session does not carry today.

**Roadmap**: MOB-14 («PosPay Business» app). Owner of the code: the web manager (`packages/auth`, identity). This spec
is the dependency spec 065 FR-008 and FR-017 point at (`TODO(spec)` there).

**Governing documents**: `CLAUDE.md` §5 (authentication exception), §6 (guards, PP-7.1, PP-7.2), §8;
`docs/adr/0003-auth-rls-boundary.md`; `docs/adr/0019-staff-otp-login.md` §1; `docs/adr/0027-personal-staff-session.md`;
`docs/adr/0055-store-apps-capacitor-shell.md`. The ADR changes this spec needs are drafted in the same PR as
addenda to ADR-0019 and ADR-0027 (status Proposed until sub-PR 067-1 merges).

## What is broken today (checked on `main`, 2026-10-23)

The sign-out functions in `packages/auth` are already idempotent: `createStaffSessions(...).signOut` and
`createPersonalSessions(...).signOut` read the signed cookie, delete the row if there is one, and always return an
expiring cookie. The problem sits one layer above, in the guard:

| Route | Handler | Guard path today | No live session gives |
|---|---|---|---|
| `POST /v1/devices/me/staff-session/sign-out` | `StaffOtpController.signOut` | `@Authenticated()` + `STAFF_ROUTE = 'staff'` → `SessionGuard#staff`: device token, then a live `STAFF_POS` session, then `StaffAuthentication.eligible` | 401 `UNAUTHENTICATED` |
| `POST /v1/staff/personal-session/sign-out` | `PersonalOtpController.signOut` | `@Authenticated()` + `PERSONAL_ROUTE = true` → `personalSessionRequest`: origin, no `Authorization`, a live `STAFF_PERSONAL` session, then the employee eligibility read | 401 `UNAUTHENTICATED` |

The same 401 also answers a wrong origin (personal), an unknown, revoked or closed-company device token (staff), a user
who lost eligibility, and an API without auth configured. A caller cannot tell «nothing to end» from «refused», so spec
065 FR-008 rightly refuses to count it. Three consequences follow:

- A session that already ended (deadline, replacement, earlier sign-out) can never be confirmed as ended.
- A user who lost eligibility (membership ended, employee deleted) cannot end her own still-stored session row; it
  stays until its 8-hour deadline.
- A **revoked** counter device can never finish the role change: `RevokeDevice` sets `REVOKED` for good and deletes no
  staff session, and the guard refuses a revoked token exactly like an unknown one (ADR-0019 §6), so the staff
  sign-out answers 401 forever.

So the change is a guard policy, a response body and a small return-shape change in `packages/auth`, not a new auth
mechanism.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Changing the device's role finishes even when a session already ended (Priority: P1)

At «الأميرة», Sara's phone was her personal phone; her 8-hour session ended yesterday. The manager now makes it the
counter phone: «تغيير نوع الجهاز». The app asks the server to end the personal session. The server answers clearly
«there was no session to end», the app counts it as done, and the role changes.

**Why this priority**: without it spec 065 FR-008 cannot complete in the most common case (the session already ended).

**Independent Test**: call each sign-out route with no cookie, with an expired session's cookie and with a live one;
check the three answers and that a repeat answers the same «nothing to end».

**Acceptance Scenarios**:

1. **Given** a live personal session, **When** the personal sign-out is called from the POS origin, **Then** it answers
   «signed out», the session no longer resolves, and the cookie is cleared.
2. **Given** the same browser right after (it no longer holds the cookie), **When** the sign-out is called again,
   **Then** it answers «no session to end» and sends no `Set-Cookie` (D-6).
   A request that still carries the old cookie (another tab's copy of the request) also answers «no session to end»,
   with the clearing header.
3. **Given** no cookie, an expired session or a session replaced by a sign-in on another phone, **When** the personal
   sign-out is called, **Then** it answers «no session to end».
4. **Given** a live staff (counter operator) session, **When** the staff sign-out is called, **Then** it answers
   «signed out» and the device stays paired.

---

### User Story 2 - A revoked counter tablet can still be handed to someone else (Priority: P1)

The manager revoked the old counter tablet from the back office yesterday; it still holds a staff cookie. Today she
picks «تغيير نوع الجهاز» on it. The staff sign-out ends whatever session the cookie names and answers clearly, so the
role change completes. The answer is the same whether the tablet's pairing is revoked or not.

**Why this priority**: otherwise the tablet is stuck until its app data is wiped.

**Independent Test**: revoke a device that has a live staff session; call the staff sign-out with its revoked token and
its cookie; then with no cookie.

**Acceptance Scenarios**:

1. **Given** a revoked device with a live staff cookie, **When** the staff sign-out is called, **Then** it answers
   «signed out» and the row is gone.
2. **Given** a revoked device with no staff cookie, **When** the staff sign-out is called, **Then** it answers «no
   session to end», exactly as an active device with no staff cookie does.

---

### User Story 3 - A refused request is never mistaken for «signed out» (Priority: P1)

A page on another site, or the back-office site, tries to call the sign-out. The server refuses with a clear refusal,
not with «no session», and the session stays alive.

**Why this priority**: FR-008 must stop on a refusal; confusing the two would let a role change drop a live session's
caches while the session still lives at the server.

**Acceptance Scenarios**:

1. **Given** a live session, **When** a sign-out arrives with any `Origin` other than the configured POS origin,
   **Then** the answer is 403 `FORBIDDEN` and the session still resolves afterwards.
2. **Given** a live personal session, **When** the personal sign-out carries an `Authorization` header, **Then** the
   answer is 403 `FORBIDDEN` and the session still resolves.

---

### User Story 4 - An owner sees the back-office line in the app (Priority: P3, Part B)

Huda owns «الأميرة» and also has an employee record there. She signs in on «حسابي كموظفة». The personal session read
tells the app that she is someone the back office is for, so the app shows «لوحة الإدارة على الويب» (spec 065 FR-017).
Sara, a stylist, does not see it. Who counts is SO-Q1.

**Acceptance Scenarios**:

1. **Given** a personal session of a user who counts under SO-Q1 in the session's business, **When** the app reads the
   session, **Then** `back_office` is `true`.
2. **Given** the same user after her qualifying membership ended while another active membership still covers the
   session (so the personal guard still accepts her, ADR-0027), **When** the app reads the session again, **Then**
   `back_office` is `false`, with no new sign-in. If no covering membership remains, the guard refuses the read with
   401 as today and no flag is returned.
3. **Given** any personal session, **When** `back_office` is `true`, **Then** no personal route accepts anything it did
   not accept before (the flag grants nothing).

### Edge Cases

- **Two sign-outs at once** (two tabs): the staff one serializes on the device lock (`retireStaffSession`), the
  personal one on the row delete; one answers «signed out», the other «no session to end». Both count as done.
- **Sign-out racing a new sign-in on the same counter device**: the replacement and the retirement take the same
  advisory lock (`staffDeviceSessionLockKey`); sign-out ends only the row its own cookie names, never the new operator's.
  **The cookie is a known limitation (D-6):** if the sign-out response reaches the browser after the new sign-in's
  response, its cookie-clearing header erases the new cookie. The new row survives; the user signs in again.
- **An expired or malformed row** (deadline passed, context not well-formed): deleted as cleanup, answered «no session
  to end», because no request could have used it. A `STAFF_POS` row whose `staffDeviceContext.deviceId` is not a UUID
  is deleted by its id and purpose without the device lock (D-2).
- **The staff cookie names a session of another device** (the browser was re-paired under a new device id): the row is
  retired under its own device's lock and the answer is «signed out»; the current device token plays no part.
- **A personal cookie sent to the staff route, or the reverse**: each route reads only its own cookie name
  (`STAFF_COOKIE`, `PERSONAL_COOKIE`) and its own purpose; the other cookie is ignored; answer «no session to end».
- **A user who lost eligibility, or whose approved phone changed**: the row is still deleted; eligibility and
  `bindingValid` are not consulted to end a session.
- **Rate limit reached**: 429 `TOO_MANY_REQUESTS`; nothing changed; the app retries later (FR-008 treats it as a stop).
- **Auth not configured** on that API (tests, a misconfigured environment: the route's sessions, its POS origin
  setting or the rate limiter not wired): 503 `NOT_READY`, checked before the `Origin` header, never 401 or 403.
- **Database failure** while ending the session: 5xx; the caller must not count it as done.

## Requirements *(mandatory)*

### Functional Requirements — Part A (sign-out)

- **FR-001**: Each sign-out route MUST answer 200 in exactly two cases: «signed out» when this request ended a live
  session of its kind, and «no session to end» otherwise. Both clear that route's cookie when the request carried
  it (D-6).
- **FR-002**: Calling a sign-out again MUST be safe and MUST answer «no session to end» once the session is gone.
- **FR-003**: A sign-out MUST NOT answer 401 for any reason it controls. A refused request (wrong origin, an
  `Authorization` header on the personal route) MUST get 403; missing configuration (sessions, POS origin setting or
  rate limiter not wired) MUST get 503, checked first; rate limit 429.
- **FR-004**: The authority to end a session MUST be possession of that session's server-signed cookie, from the
  configured POS origin, and nothing else. The staff route MUST NOT read the device token at all, so its answer can
  never depend on whether the device is active, revoked, unknown or of a closed company.
- **FR-005**: Ending a session MUST NOT depend on the user's eligibility, membership or phone binding.
- **FR-006**: Ending the staff session MUST keep the device pairing and MUST go through the existing retirement path,
  so everything ADR-0019 ties to the end of a session follows unchanged (including, once sub-PR 57-1 builds it, the
  private-view window of the ADR-0019 addendum of 2026-10-21).
- **FR-007**: The answer MUST depend only on the cookie the caller sent; it MUST NOT reveal anything about the device,
  the company, the user's eligibility or any other session.

### Functional Requirements — Part B (back-office signal)

- **FR-008**: The personal session read (`GET /v1/staff/personal-session`) and the personal sign-in answer
  (`POST /v1/staff/personal-otp/verify`) MUST carry one boolean, `back_office`, true when the signed-in user counts
  under SO-Q1 in the session's business at that moment.
- **FR-009**: `back_office` MUST NOT grant anything: no personal route, guard or query may read it to allow an action.
- **FR-010**: It MUST be computed on the server on each read, from the user's own memberships in the session's company
  only, and never accepted from the client.

### Key Entities

- **Sign-out result**: `SIGNED_OUT` or `NO_SESSION`.
- **Back-office signal**: one boolean on the personal session view; no new stored data.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: Possession of a session's signed cookie is enough to end that session (ending only ever removes access).
- **BR-002**: A session is «live» for the answer when its row exists with the route's purpose (`STAFF_POS` /
  `STAFF_PERSONAL`), a well-formed context and an absolute deadline still ahead. Eligibility and phone binding are not
  part of it: a row that fails them now could pass again later in its 8 hours (eligibility is rechecked per request),
  so deleting it is a real sign-out.
- **BR-003** (Part B): who counts for `back_office` is SO-Q1. `TODO(spec)` until answered; sub-PR 067-2 does not
  start before.

### Technical decisions (no owner question)

**D-1. One guard policy for both routes, kept under `@Authenticated()`.** `SessionGuard` gains one session-optional
policy for sign-out (proposed: a `SIGN_OUT_ROUTE` metadata value `'staff' | 'personal'`, set by a decorator next to
`AllowClosedCompanyDeviceOtp`, which is the precedent for a per-handler guard variant). The guard reads it **before**
the `PERSONAL_ROUTE` and `STAFF_ROUTE` branches; the two sign-out handlers drop their `STAFF_ROUTE` / `PERSONAL_ROUTE`
markers. The branch, in this order:

0. wiring: the route's sessions (`StaffSessions` / `PersonalAuthentication.sessions`), its POS origin setting and the
   `RATE_LIMITER` must be wired; otherwise 503 `NOT_READY`. For staff that means `StaffSessions` or the
   `STAFF_POS_ORIGIN` binding is null, the same condition under which no staff sign-in works at all; whether OTP is
   enabled is never consulted. A missing origin **setting** is configuration, not a refusal;
1. the request's `Origin` header must equal that setting: for staff the `STAFF_OTP_POS_ORIGIN` environment variable
   (injected as the `STAFF_POS_ORIGIN` token, the value the staff OTP routes compare today). Despite its name it is
   not an OTP-only setting: the composition root binds it whether or not OTP is enabled (`apps/api/src/main.ts`,
   `staff.origin: process.env['STAFF_OTP_POS_ORIGIN'] || null`, next to `api: otp ?? null`; provided as
   `STAFF_POS_ORIGIN` in `apps/api/src/modules/identity/identity.module.ts`), staging always sets it
   (`deploy/docker-compose.staging-shared.yml`: `STAFF_OTP_POS_ORIGIN: ${STAFF_OTP_POS_ORIGIN:-https://${POS_STAGING_HOST:?}}`),
   and the staff PIN sign-in (`StaffPinController`), the staff leave guard and the card clock refuse every request
   when it is unset, so no staff session can exist without it. OTP being off changes nothing here; for personal
   `PersonalAuthentication.origin`; a missing or different header → 403 `FORBIDDEN`;
2. personal only: an `Authorization` header → 403 `FORBIDDEN` (ADR-0027: device credentials cannot upgrade or stand
   in for the personal purpose);
3. the per-IP rate limit (D-5);
4. set no principal, return true (D-7 lists every reader of `request.principal` on these routes).

Rejected alternatives:

- **`@Public()` with checks in the handler.** It would work (device register/claim and the personal OTP routes are
  public writes), but it takes both routes out of the PP-7.1 declaration list, which only covers `@Authenticated()`
  writes, and puts trust checks in a controller. Keeping them `@Authenticated()` keeps them in `AUTHENTICATED_WRITES`.
- **Keep device authentication on the staff route.** Simpler, but a revoked counter device then gets 401 forever and
  spec 065 FR-008 can never finish on it (see «What is broken today»). Making the answer depend on the token would
  also add a revoked-vs-unknown signal that ADR-0019 §6 forbids.
- **A device-wide sign-out route** ending both kinds in one call. Rejected: the two sessions have different cookies,
  purposes and ADRs (ADR-0019 vs ADR-0027 keeps them separate on purpose); one route would need a composite answer for
  a partial failure anyway, which FR-008 already handles per kind; and #554 item 4 asks for no new endpoint unless
  agreed. The app calls the two existing routes, one per session kind it may hold.

**D-2. `packages/auth` return shape.** `StaffSessions.signOut(headers)` drops its `device` parameter and returns
`{ cookie, ended }`; `PersonalSessions.signOut(headers)` returns the same shape. Staff: verify the cookie
(`verifiedToken` with `STAFF_COOKIE`), find the row, and when its purpose is `STAFF_POS` and its
`staffDeviceContext.deviceId` is a UUID, retire it with `retireStaffSession(authDatabase, row.id, deviceId)` using
the row's **own** device id (server-written, immutable). A `STAFF_POS` row whose context is malformed (no
`staffDeviceContext` object, or a `deviceId` that is not a UUID, which `retireStaffSession` silently skips) is deleted
by a second auth operation, `DELETE FROM session WHERE id = … AND purpose = 'STAFF_POS'`, without the device lock: no
device can resolve such a row, so nothing can race it. Personal: as today, remove the row when its purpose is
`STAFF_PERSONAL`. `ended` is true only when the deleted row was live under BR-002. The doc comments on both interface
methods change in the same commit (`CLAUDE.md` §3.1).

**D-3. Two 200 statuses, not one.** The app needs to know the session is gone; it does not strictly need to know
whether it was live. One status would hide even that. Two statuses are kept because spec 065 MOB-T18 tests the
explicit «no session to end» result and because they make logs and tests precise; the Security section shows they
reveal nothing new.

**D-4. No audit row, no event.** Sign-out is not in the `CLAUDE.md` §8 audit list and emits no event today; this does
not change. No `Idempotency-Key`: there is no money or stock effect, and the route is idempotent by itself.

**D-5. Rate limit.** Because the route may run with no principal, each sign-out route gets a per-IP limit through the
existing `RATE_LIMITER` port, as `DevicesController` does for its public routes: 30 requests per 60 seconds per IP per
route (key `sign-out:<staff|personal>:<ip>`). The limit is higher than the devices routes' 10 because a salon's phones
often share one public IP and many staff leave at the same hour. Without a wired limiter the route answers 503
`NOT_READY`, as `DevicesController` does.

**D-6. The cookie race is a recorded limitation.** The advisory lock orders the database changes, not the HTTP
responses. If one tab's sign-out response reaches the browser after another tab's new sign-in response, the
sign-out's `Set-Cookie` (an expired cookie of the same name, `Path=/v1`) erases the new cookie. HTTP gives the server no
clean way to prevent it: a `Set-Cookie` cannot be made conditional on the value the browser holds when the response
arrives, and avoiding it would need a different cookie name per session, while ADR-0019 and ADR-0027 fix one name per
purpose. One narrowing is required, and the rest is accepted:

- the server sends the clearing header only when the request carried a cookie of that route's name; a request with no
  such cookie gets `NO_SESSION` with no `Set-Cookie`, so a stray sign-out from a tab that never held a session cannot
  erase anything.

No cross-tab lock between sign-in and sign-out is added. Such a lock would need an owner tab, a release on every
terminal path and recovery when that tab crashes or closes; a lock that outlives its tab blocks every sign-in on the
device, which is worse than the race it prevents. Clients keep today's behaviour (a sign-out clears the private state
in every tab, ADR-0019 §1, ADR-0027).

When the race happens (rare: it needs a sign-out and a sign-in of the same kind in two tabs at the same moment), the
effect is availability only: the person signs in again; the orphaned row can no longer be used by that browser, the
next sign-in on that device (staff) or for that user (personal) replaces it, and in any case it expires within its
8 hours. No session is extended, revived or exposed. An optional client-side mitigation is tracked for spec 065 in issue
#581; this spec adds no synchronization mechanism.

**D-7. Readers of `request.principal` on these two routes.** `SessionGuard` documents `principal` as «absent only on
@Public() routes»; these become the two `@Authenticated()` routes where it is absent too. Every reader in
`apps/api/src`:

- global guards, in order: `SessionGuard` (sets it; the new branch does not), `AccessGuard` (returns early for
  `AUTHENTICATED_ONLY` before reading it; its `@RequirePlatform` branch does not apply), `FeatureGuard` (reads
  `principal?.companyId` only when a feature flag is declared; these routes declare none);
- per-controller guards that read it (`SelectedCompanyGuard`, the orders `session-access.guard.ts`, the settings
  `identity-capability-company.guard.ts`, the staff `attendance-report-company.guard.ts`) are not applied to
  `StaffOtpController` or `PersonalOtpController`;
- `actorOf` (`apps/api/src/shared/actor.ts`) is called by handlers only; the sign-out handlers do not call it;
- the exception filter (`EnvelopeExceptionFilter`) and the `onRequest` / `onResponse` hooks in `app.ts` do not read
  `principal`; no interceptor is registered globally;
- the rate-limit key is the IP (D-5), not the principal.

Sub-PR 067-1 updates the `principal` doc comment in `session.guard.ts` to name the sign-out exception (`CLAUDE.md`
§3.1) and adds a test that both routes answer without a principal.

### Schema changes

None. No table, column, RLS policy, grant or index changes. The `session` table stays reachable only from
`packages/auth` on `pospay_auth` (ADR-0003); Part A reaches no tenant data. Part B reads `memberships` in the tenant
under `withTenant` on `pospay_app`, as the personal eligibility reader already does.

### API contract

Paths and methods do not change. Bodies are new Zod schemas in `packages/contracts`, published in OpenAPI.

**Part A — both sign-out routes**

| Case | Status | Body | `Set-Cookie` |
|---|---|---|---|
| Sessions, the POS origin setting or the limiter not wired (checked first) | 503 | `NOT_READY` envelope | none |
| `Origin` header missing or not the configured POS origin | 403 | `FORBIDDEN` envelope | none |
| Personal route with an `Authorization` header | 403 | `FORBIDDEN` envelope | none |
| Rate limit reached | 429 | `TOO_MANY_REQUESTS` envelope | none |
| The request ended a live session (BR-002) | 200 | `{ "status": "SIGNED_OUT" }` | clears the route's cookie |
| A cookie of the route's name was sent, but with a bad signature, an unknown or already-deleted row, another purpose, a passed deadline or a malformed context | 200 | `{ "status": "NO_SESSION" }` | clears the route's cookie |
| No cookie of the route's name was sent | 200 | `{ "status": "NO_SESSION" }` | none (D-6) |
| Repeat after either 200 | 200 | `{ "status": "NO_SESSION" }` | as the two rows above |
| Database or other infrastructure failure | 5xx | error envelope | none |

Staff route specifics: the `Authorization: device …` header is not read; a revoked, unknown, closed-company or absent
device token changes nothing in the table above. There is no 401 row on either route.

- Schema: `signOutResult = z.strictObject({ status: z.enum(['SIGNED_OUT', 'NO_SESSION']) })`, meta id
  `SignOutResult`, next to `staffSessionContext` in `packages/contracts/src/identity/staff-otp.ts`.
- OpenAPI: the `signOutStaff` operation in `packages/contracts/src/identity/staff-sign-in-openapi.ts` and the
  `signOutPersonalStaff` operation in `packages/contracts/src/staff/passkeys-openapi.ts` both return `SignOutResult`
  on 200. The generated POS client (`apps/pos/src/shared/api/schema.d.ts`) is regenerated.
- Callers today: `signOutStaff` in `apps/pos/src/staff-login/api/staff-calls.ts` and `personalCalls.signOut` in
  `apps/pos/src/personal-staff/api/personal-calls.ts` only test `response.ok`. Both 200 statuses keep them working; a
  PWA tap on «sign out» after the session expired now succeeds instead of failing. The native app (spec 065 FR-008)
  reads `status`.

**Part B — back-office signal**

- `personalSessionContext` (`packages/contracts/src/staff/passkeys.ts`, a `strictObject`) gains `back_office:
  z.boolean()`. Both `getPersonalSession` and `verifyPersonalOtp` return it; their handlers build the same shape
  today and keep doing so.
- **One reader, one transaction** (`CLAUDE.md` §6 connection budget). The personal eligibility read that already runs
  in one `withTenant` transaction on every personal request (`personalEmployee` in
  `apps/api/src/modules/staff/persistence/personal-employee.ts`, through `personalMemberships` in
  `apps/api/src/modules/identity/persistence/personal-membership.ts`) also returns the raw facts the rule needs: the
  `role_id` (and owner key) of each membership active now whose scope covers the session's business (that company,
  that business, or a branch of it). No second transaction is opened, in the guard or in the handlers: the guard
  (`personalSessionRequest`) keeps those raw rows on the request next to `personalEmployeeId`, and the verify handler
  gets them from the same eligibility call it makes today. Every SO-Q1 option is a list of stable system-role ids
  (`SYSTEM_ROLES` in `packages/db/src/access-catalog.ts`), so the rule needs no permission evaluation: no join on
  `role_permissions`, no overrides. A company-specific role counts under no option; counting one later would need the
  existing effective-access evaluation (`AuthorizeRequest`: DENY wins, time windows apply) and its own spec change.
- **The rule outside `queries/` and `persistence/`.** The SO-Q1 decision is a pure function in
  `apps/api/src/modules/identity/domain/` (proposed `backOfficeFor(memberships)`), exported through the identity
  `index.ts` and applied by the two handlers to the raw rows. The reader returns rows only and imports no `domain/`
  code (`CLAUDE.md` §6). No `queries/` file is added.

### Permissions

- No new permission string; no new grant.
- Part A: both handlers stay `@Authenticated()` and stay in `AUTHENTICATED_WRITES`
  (`apps/api/src/modules/identity/http/authenticated-writes.ts`) as `PERSONAL` (each ends only the caller's own
  session). Their `checkedIn` moves to the new guard branch (proposed `apps/api/src/shared/session.guard.ts##signOut`).
  The PP-7.1 startup check (`assertAuthenticatedWritesDeclared`) and the test «every allowlist key is a mounted
  @Authenticated write» keep covering them. `ROUTE_MARKERS` in
  `apps/api/src/modules/identity/__tests__/route-declarations.spec.ts` replaces their `staff` / `personal` markers with
  the new sign-out marker.
- `CLAUDE.md` §6: «no endpoint without a guard» holds; the alternative it names (`@Authenticated()` deciding on the
  caller, declared) is the shape used. §5: no fifth way to reach tenant data; Part A touches only the global `session`
  table, through `packages/auth`.
- Part B: the personal purpose gains no capability (ADR-0027 addendum in this PR). The flag is a display hint.

### Security

- **No new existence oracle.** The only thing that becomes distinguishable is whether the cookie the caller itself
  sent named a live session. That cookie is HttpOnly, host-only on the API host, `Path=/v1`, `SameSite=Lax` and
  HMAC-signed (`verifiedToken`), so no other site can send it on a POST, the same-site back-office origin is stopped by
  the exact `Origin` check, and it cannot be forged. `GET /v1/staff/personal-session` and
  `GET /v1/devices/me/staff-session` already answer the same liveness question for the same cookie. The answer never
  depends on the device token, the company's state, the user's eligibility or another session (FR-007).
- **The one cost, weighed.** Someone who stole a staff cookie and has no device token can now end that session and
  learn it was live; before, the cookie alone did nothing. Accepted: ending a session only removes access (the
  operator signs in again with her PIN), the cookie cannot be read by page code or sent cross-site, and a holder of a
  stolen cookie plus the device token could already do far more.
- **Revoked vs unknown device stays hidden**: the staff route never reads the token (FR-004).
- **CSRF**: the exact `Origin` check runs before anything else; a refused request changes nothing and sets no cookie.
- **Rate limit**: D-5, before any database read. Without a valid signature no database read happens at all.
- **Logs**: one line per sign-out with the result and, for `SIGNED_OUT`, the `user_id`; never the cookie, the token or
  the device token (`CLAUDE.md` §8).
- **Part B**: `back_office` is computed from the signed-in user's own memberships after proof, in the session's company
  only; it reveals nothing about anyone else and nothing before sign-in. ADR-0027's «never return employee/account
  information» is about the pre-proof eligibility read; after proof the session already returns `employee_id`.

### Events

None published, none consumed.

### Test plan

- **Domain unit**: none for Part A (no business arithmetic). Part B: the SO-Q1 function in
  `apps/api/src/modules/identity/domain/` with exhaustive unit tests (every system role, a company role, each scope).
- **`packages/auth` unit** (`packages/auth/src/__tests__/staff-session.spec.ts`, `personal-session.spec.ts`): `ended`
  true for a live row; false for no cookie, bad signature, unknown token, other purpose, passed deadline, malformed
  context; the staff row is retired under its own device id's lock; the personal sign-out never touches a `STAFF_POS`
  row and the reverse.
- **Integration** (`apps/api/src/modules/identity/__tests__/`, T2 compose Postgres, ADR-0006):
  `SO-01` live personal → 200 `SIGNED_OUT`, session no longer resolves, cookie cleared ·
  `SO-02` repeat → 200 `NO_SESSION` ·
  `SO-03` personal: no cookie / expired / replaced by a sign-in on another phone → 200 `NO_SESSION` ·
  `SO-04` personal user who lost eligibility → 200 `SIGNED_OUT`, row gone ·
  `SO-05` live staff → 200 `SIGNED_OUT`, device still paired (and, if 57-1 has merged, its private-view window gone) ·
  `SO-06` staff with a revoked device token and a live cookie → 200 `SIGNED_OUT` ·
  `SO-07` staff with a revoked token and no cookie, and with an active token and no cookie → identical 200 `NO_SESSION`
  bodies and headers ·
  `SO-08` staff cookie bound to device X sent with device Y's token → 200 `SIGNED_OUT`, retired under X's lock ·
  `SO-09` wrong or missing `Origin` → 403, and the live session still resolves afterwards (both routes) ·
  `SO-10` personal route with an `Authorization` header → 403, session still resolves ·
  `SO-11` personal cookie sent to the staff route (and the reverse) → 200 `NO_SESSION`, the other session untouched ·
  `SO-12` two concurrent sign-outs of one session → one `SIGNED_OUT`, one `NO_SESSION` ·
  `SO-13` sign-out racing a PIN sign-in on the same device, with the sign-out response delayed until after the
  sign-in's → the new operator's row survives and resolves with the new cookie, and the test records that the late
  clearing header names the same cookie (the D-6 limitation) ·
  `SO-13b` a request carrying no cookie of the route's name → `NO_SESSION` with no `Set-Cookie` ·
  `SO-13c` a malformed `STAFF_POS` row (no device context, or a non-UUID `deviceId`) named by a valid cookie → row
  deleted, `NO_SESSION` ·
  `SO-14` 31st request in 60 s from one IP → 429, nothing changed ·
  `SO-15` sessions, the POS origin setting or the limiter not wired → 503 `NOT_READY`, even with a wrong `Origin`
  header (wiring is checked first) ·
  `SO-15b` both routes answer with no `request.principal` set (D-7) ·
  `SO-16` no response of either route is ever 401 (the matrix above, both routes).
- **Route declarations**: `route-declarations.spec.ts` asserts both handlers carry the sign-out marker and neither
  `STAFF_ROUTE` nor `PERSONAL_ROUTE`; `AUTHENTICATED_WRITES` matches the mounted writes.
- **Contracts**: `SignOutResult` accepts the two statuses only; the OpenAPI snapshot shows it on both operations.
- **POS** (Vitest): the PWA sign-out paths still clear local state on both 200 statuses (visible signed-out screen,
  `CLAUDE.md` §9).
- **Part B integration**: `SO-20` qualifying user → `back_office: true` on both reads · `SO-21` non-qualifying user →
  `false` · `SO-22` qualifying membership ended while another membership still covers the session → `false` on the
  next read; with no covering membership left → 401 from the guard, as today · `SO-23` a membership in another company
  or another business of the same company does not count · `SO-24` no personal route changes its answer when the flag
  is true · `SO-25` a personal request opens exactly one tenant transaction, as before (connection budget). **Reader**:
  the extended eligibility SQL keeps its result-shape test and gets an `EXPLAIN ANALYZE` index assertion for the added
  role columns.
- **RLS negative**: no new table. `SO-23` covers cross-tenant reads for Part B.

### Sub-PR split

| Sub-PR | Content | Waits on |
|---|---|---|
| 067-1 | Part A: guard policy, `packages/auth` return shape, both handlers, contracts and OpenAPI, POS client regeneration, tests `SO-01…SO-16`, ADR addenda flipped to Accepted | nothing; it changes auth, so `pospay-pipeline` §3 step 2 design advice applies |
| 067-2 | Part B: the eligibility reader returns the covering memberships' roles, the SO-Q1 domain function, `back_office` on both reads, contract, tests `SO-20…SO-25` | SO-Q1 |

The app side (counting the statuses in FR-008, showing the FR-017 line) stays in spec 065's sub-PRs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every case in the Part A table, both routes give the listed status and body, and never 401
  (`SO-16`).
- **SC-002**: A role change on a device whose sessions already ended, or whose pairing was revoked, completes on the
  first try with the network on.
- **SC-003**: A refused sign-out leaves the session resolvable in 100 % of the refusal tests.
- **SC-004** (Part B): the back-office line shows for exactly the users SO-Q1 names, and no personal route's decision
  changes with the flag.

## Assumptions

- The POS origin configuration (`STAFF_OTP_POS_ORIGIN`) and the personal origin stay exact-match as ADR-0027 requires;
  trusting the iOS `capacitor://localhost` origin is a separate ADR-0027 addendum (issue #549), not this spec.
- Spec 065 FR-008 and FR-017 will be repointed from `TODO(spec)` to this spec by the MOB lane after it merges; this PR
  does not edit spec 065 (PR #575 is open on it).
