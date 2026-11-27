# Feature Specification: Email & WhatsApp OTP Recovery (Password Reset + Self-Service PIN Reset), Unified Email Layout & Lovable Brand / Business Logos

**Spec Reference**: Manager Assignment `spec 077` (`docs/specs/079-auth-otp-recovery-and-brand-logo` — sequential after existing `077-admin-create-company-screen` and `078-admin-first-business-and-branch` on `origin/main@6487c6ec0`)  
**Feature Branches**:
- `PR-a`: `feat/079a-email-layout-and-brand-logos` (0 migrations)
- `PR-b`: `feat/079b-forgot-password-email-otp` (1 expand migration)
- `PR-c1`: `feat/079c1-employee-email-and-forgot-pin-otp` (1 expand migration: single optional `recovery_email` column on `employees` only; zero schema/grant changes on `"user"` / `pospay_auth`)
- `PR-c2`: `feat/079c2-staff-welcome-and-invitation-emails` (0 migrations: F1 welcome email with 24h temporary PIN via encrypted/token envelope + G1 invitation email to invitee & owner)

**Created**: 2026-11-26  
**Status**: Approved by Project Manager (2026-11-26 09:21, 14:00 & 14:21 Kuwait) — `PR-a` (`PR #1333`, `455110a02`) **MERGED**; `PR-b` active next; `PR-c1` Option (أ) conditions recorded; **`spec 080` (`PR-Q9`)** draft authored separately.  
**Owner Decisions**: [`owner-questions.ar.md`](./owner-questions.ar.md) (verbatim cards from Waleed, 2026-11-26 ~08:55, ~08:57, ~09:00, ~09:20, and ~09:30 Kuwait; `TQ-1..TQ-3` and `PR-Q6..PR-Q9` recorded). Product/access decisions **PR-Q2**, **PR-Q5**, **TQ-1**, and **PR-Q6..PR-Q9** are queued for the next decisions-page batch for Abu Salem (`PENDING`); work follows Waleed's choices meanwhile.  
**Governing ADRs & Docs**:
- [`ADR-0003`](../../adr/0003-auth-rls-boundary.md) §2.1 & §3 (`pospay_auth` global identity tables, `platform_audit_log`, no tenant RLS on identity tables)
- [`ADR-0014`](../../adr/0014-email-provider.md) (Resend email provider, suppression gate, webhook feedback reconciliation)
- [`ADR-0018`](../../adr/0018-notification-delivery.md) §7 (execution fence & worker derivation)
- [`ADR-0019`](../../adr/0019-staff-otp-login.md) (`auth_otp_challenges`, `auth_notification_attempts`, Redis rate caps, HMAC-derived 6-digit OTP & keyed verification MAC)
- [`ADR-0046`](../../adr/0046-business-identity-settings-reads-and-logo-lifecycle.md) (per-business identity settings & `logo_file_id` lifecycle)
- [`ADR-0059`](../../adr/0059-souk-tiles-design-system.md) (Souk Tiles design system from `lovable-pospay`)
- [`ADR-0063`](../../adr/0063-staff-access-and-invitations.md) (`D8` staff user isolation, synthetic emails, temporary PIN policy `076 AC-ACT-9`, owner notice `076 AC-F2-3`)

---

## 1. Logo Audit: Current PosPay Code vs. Lovable Design System Source

1. **Current PosPay logo in the codebase:**
   - `packages/ui/src/brand-mark.tsx` (lines 6–20) renders an inline custom SVG (`#FF6421` orange rounded square with `#0D1522` P shape and `#F7F1E8` dot).
   - `packages/ui/src/brand-lockup.tsx` (lines 13–32) composes `BrandMark` (`size-14`) beside `BrandWordmark` (`PosPay` / `بوس باي`).
   - Mounted today in:
     - **Admin auth pages (`GuestFrame`):** `apps/admin/src/session/ui/guest-frame.tsx:23` (used by `/login` in `login-page.tsx:17`, `/login/two-factor`, and `/set-password` in `set-password-page.tsx:32`).
     - **Admin dashboard frame:** `apps/admin/app/(dashboard)/_frame/frames/style-a-frame.tsx:48,60` renders `<BrandLockup tone="sidebar">` and mobile `<BrandMark>`. (`StyleBFrame` and `StyleCFrame` in `style-b-frame.tsx` and `style-c-frame.tsx` currently render no brand logo in their top bars/rails.)
     - **POS frame:** `apps/pos/src/shared/frame/app-frame.tsx:22` renders `<BrandLockup>`.
2. **Source of the PosPay logo in Lovable Design System:**
   - Repository `F:\Dev\Projects\lovable-pospay` (`lolotam/lovable-pospay@main`) contains `public/brand/logo-mark-simple-tile.png` (9,909 bytes — the Sadu-patterned orange/ink/teal/cream `P` on a rounded Pearl Sand tile), referenced in `src/modules/permissions/ui/area-shell.tsx:40` (`<img src="/brand/logo-mark-simple-tile.png" alt="" width={36} height={36} className="size-9 shrink-0 rounded-[0.625rem]" />`). This matches the Sadu P icon family already used in `apps/admin/public/android-chrome-192x192.png`.
3. **Distribution & single asset rule:**
   - Place `logo-mark-simple-tile.png` in `apps/admin/public/brand/logo-mark-simple-tile.png` (copied into the standalone admin image by `deploy/Dockerfile.admin:24`) and export/reference the PosPay logo through `packages/ui` (`BrandMark` / `BrandLockup`) so auth screens and fallback headers render the same asset, and operational/auth emails link to it via HTTPS at `${EMAIL_ADMIN_ORIGIN}/brand/logo-mark-simple-tile.png` (never as an email attachment).

---

## 2. User Scenarios & Testing *(mandatory)*

### User Story 1 — Unified Email HTML Layout & PosPay / Business Brand Logos (`PR-a`, Priority: P1)

As an owner, manager, or staff member, I want every email sent by PosPay to use a clean, branded RTL/LTR HTML layout with a plain-text fallback and HTTPS logo, and I want Admin login pages to show the PosPay logo while the Admin dashboard header displays the active business's uploaded logo (changing dynamically when I switch businesses or upload/remove a logo, and falling back to the PosPay logo when none is set).

**Why this priority**: Shared foundation required before sending OTP emails in `PR-b` and `PR-c`, and directly fulfills Waleed's branding requirements for auth, emails, and dashboard header.

**Independent Test**: Render `document_expiring` and layout tests in `@pospay/notifications`; render Admin `GuestFrame` (`/login`, `/set-password`) and Dashboard Frames (Styles A, B, C) while switching active businesses and updating/removing a business logo on `/business-identity`.

**Acceptance Scenarios**:

1. **Given** any email rendered by `@pospay/notifications` in `ar` or `en`, **When** `renderOperationalEmail` produces output, **Then** HTML uses a single shared responsive table layout with inline CSS only, `dir="rtl"` for `ar` and `dir="ltr"` for `en`, a header containing `<img src="${adminOrigin}/brand/logo-mark-simple-tile.png" ... />` (HTTPS, zero attachments), a clean footer, and a matching plain-text `text` body.
2. **Given** an unauthenticated visitor on `/login`, `/login/two-factor`, `/set-password`, or the Forgot Password screen (`GuestFrame`), **When** the page renders, **Then** the Lovable PosPay logo (`logo-mark-simple-tile.png`) is displayed alongside the brand lockup; no tenant logo is queried or displayed.
3. **Given** an authenticated user in the Admin dashboard across any navigation style (`A`, `B`, or `C`), **When** the active business has a `logo_file_id` from Business Identity (`/business-identity`), **Then** the dashboard header renders that business's logo (with flexible aspect ratio — no 1:1 crop/requirement enforced).
4. **Given** the user switches to a different business in `WorkspaceSwitcher`, or uploads/replaces/removes the logo on `/business-identity`, **When** the active workspace or `business-identity` cache updates, **Then** the dashboard header immediately updates to show the newly selected business's logo, or falls back to the Lovable PosPay logo if the active business has no logo.

---

### User Story 2 — Admin "Forgot Password" via 6-Digit Email OTP (`PR-b`, Priority: P1)

As a business owner or back-office manager (email + password account) who forgot my password, I want to request a 6-digit OTP to my email on the Admin login screen, verify the OTP, and set a new password so that my old sessions are revoked while my 2FA protection remains enforced on next sign-in.

**Why this priority**: First live email producer requested by Waleed after email channel activation (`PR #1321`), unblocking self-service admin recovery on staging and production.

**Independent Test**: Request OTP for an existing owner email (`202`), confirm neutral `202` for unknown or staff synthetic emails with zero emails sent, fail 5 times and prove lockout (`EXHAUSTED`), submit valid 6-digit OTP + new password, verify all existing sessions are deleted and next login succeeds (requiring 2FA if enabled), and verify Resend webhook delivery/bounce reconciliation updates the feedback inbox & suppressions.

**Acceptance Scenarios**:

1. **Given** a visitor clicks «نسيت كلمة المرور؟» on `/login`, **When** they enter an email and submit `POST /v1/auth/password-reset/otp/request`, **Then** whether the email belongs to an active owner/manager, a staff user (`staff-<op>@staff.pospay.invalid`), a suppressed email, or does not exist at all, the API enforces Redis rate limits/cooldown and returns the same `202 Accepted` response `{ status: 'ACCEPTED', challenge_id, expires_in: 600, retry_after: 60 }` within a bounded constant window (~200ms).
2. **Given** the email belongs to an eligible non-staff user and is not globally suppressed in `platform_email_suppressions`, **When** the request commits `auth_otp_challenges` + `auth_notification_attempts`, **Then** the worker `notifications` module materializes the 6-digit HMAC-derived OTP, sends the bilingual HTML+text email using `ResendChannel` with correlation tags and `EMAIL_ADMIN_ORIGIN` logo URL, and clears transient memory immediately.
3. **Given** a 6-digit OTP was issued, **When** `now >= created_at + 10 minutes` OR 5 wrong OTPs have been submitted via `POST /v1/auth/password-reset/otp/reset`, **Then** the challenge transitions terminally (`EXPIRED` / `EXHAUSTED`), `code_mac` is cleared to `NULL`, and further attempts fail with `401 OTP_INVALID` (or `429` if rate limit exceeded).
4. **Given** a valid active challenge, correct 6-digit code, and valid new password (`8..128` characters), **When** `POST /v1/auth/password-reset/otp/reset` succeeds, **Then** the challenge transitions atomically to `CONSUMED` (`code_mac = NULL`), the credential `account.password` hash is updated, **all existing `session` rows for `user_id` are deleted**, all pending `reset-password:*` `verification` tokens for that user are deleted, `platform_audit_log` records the reset, and the user is **not** auto-logged-in (must sign in with the new password and complete `two_factor` TOTP if enabled).
5. **Given** Resend delivers a webhook (`email.delivered`, `email.bounced`, `email.complained`, etc.) for the sent OTP email, **When** `POST /v1/webhooks/resend` stores the scrubbed event and the worker runs `ReconcileEmailFeedback`, **Then** `ReconcileEmailFeedback` matches the auth-ledger tags (`auth_challenge_id`, `attempt_id`, `execution_id`) against `auth_notification_attempts`, marks the feedback inbox row resolved, and writes global email suppression + audit on permanent bounce or complaint.

---

### User Story 3 — Employee Optional Recovery Email & Self-Service "Forgot PIN" via Email or WhatsApp OTP (`PR-c1`, Priority: P2)

As an owner/manager registering an employee and as an employee with active staff access on a paired branch POS device who forgot my cashier/staff PIN, I want an optional `recovery_email` field on the employee profile (for communication, first-login email, and recovery) and a self-service «نسيت الرقم السري؟» flow on the branch POS to choose Email or WhatsApp, receive a 6-digit OTP, and set a new 4-digit PIN without waiting for a manager.

**Why this priority**: Completes Waleed's ~09:00 & ~09:30 expansions (`PR-Q5`, `PR-Q6`) with a single `recovery_email` column on `employees` while keeping each PR cleanly under the 1,500-line production cap (`PP-273`).

**Independent Test**: Validate optional `recovery_email` input format on employee create/edit/grant-access screens (`@pospay/contracts` + negative RLS isolation test on `employees.recovery_email`); on a paired POS branch device with `STAFF_ACCESS_ROUTES=on`, verify channel selection (`email` vs `whatsapp`), verify `503 OTP_UNAVAILABLE` when choosing `whatsapp` while WhatsApp/Staff OTP is disabled (`TENANT_WHATSAPP = LIVE_NOT_AUTHORIZED` / `STAFF_LOGIN = DISABLED`), verify Email recovery works independently when `EMAIL = READY` using optional `recovery_email`, confirm identical `202` response for unknown/unbound identifiers, and confirm setting a new 4-digit PIN saves `temporary = false`, invalidates old proofs, and raises an owner in-app bell notice without exposing the PIN (`TQ-3` / `076 AC-F2-3`).

**Acceptance Scenarios**:

1. **Given** an authorized manager creating or editing an employee or granting staff access in Admin, **When** `recovery_email` is provided (or omitted as optional/recommended), **Then** `@pospay/contracts` validates email format cleanly, `employees.recovery_email` stores the single employee email (no column added to `"user"` / `pospay_auth`; auth/worker read it via a narrow `withTenant` port verified against `recipient_hash` while synthetic `user.email` remains isolated under `076 D8`), a partial **unique** index `(company_id, lower(recovery_email)) WHERE recovery_email IS NOT NULL AND deleted_at IS NULL` enforces per-company uniqueness (rejecting duplicates on save with `EMPLOYEE_RECOVERY_EMAIL_TAKEN` and failing closed during OTP lookup by returning the uniform `202` response and sending nothing if >1 row matches), full emails are never printed in logs and are masked in reports, and tenant RLS isolates `recovery_email` across companies.
2. **Given** a paired branch POS device in `PinForm`, **When** the employee opens «نسيت الرقم السري؟», **Then** she can choose **Email** or **WhatsApp** and enter the matching identifier to request a 6-digit OTP valid for 10 minutes (max 5 failed attempts, 60s cooldown, 5/recipient/hr & 20/IP/hr request caps, 25/challenge/hr & 100/IP/hr verify caps).
3. **Given** the employee chooses **WhatsApp** while `STAFF_OTP_ENABLED` / `NOTIFICATIONS_MODE=live` / approved template is disabled, **Then** the request fails cleanly with `503 OTP_UNAVAILABLE` without breaking the **Email** recovery option, which succeeds whenever `EMAIL = READY` (and `STAFF_ACCESS_ROUTES=on`).
4. **Given** the employee submits the identifier of an existing/eligible employee OR a non-existent address OR an employee who is suspended, inactive, or deleted, or an unbound channel, closed company, inactive `employee_staff_access` record, or suppressed recipient, **When** the requested channel capability is ready, **Then** the API returns the exact same `202 Accepted` body (`{ status: 'ACCEPTED', challenge_id, expires_in: 600, retry_after: 60 }`) and comparable constant timing (~200ms) across every case, creating no challenge and sending no message when ineligible/non-existent/suspended.
5. **Given** a valid 6-digit OTP and a new well-formed 4-digit PIN are submitted to `POST /v1/devices/me/staff-pin/otp/reset`, **When** verification succeeds under challenge and user/PIN locks, **Then** `cashier_pins` is updated atomically with a new `id` (`pinRevision`), **`temporary = false`**, `expires_at = NULL`, `set_by = NULL` (respecting `076 AC-ACT-9` and invalidating any prior `staff_pin_change_proofs`), all prior failed PIN attempts are cleared, `audit_log` and `platform_audit_log` record the action without secrets or PINs, and (`TQ-3`) an in-app bell notice is emitted to the company owner without the PIN (`076 AC-F2-3`).

---

### User Story 4 — First-Login Staff Welcome Email (`F1` 24h Temporary PIN) & Member Invitation Link Email (`G1`) (`PR-c2`, Priority: P2)

As an owner or manager granting staff access (`076-F1`) or inviting a company member (`076-G1`), I want the initial 24-hour temporary PIN welcome email sent automatically to both the employee's `recovery_email` (if set) and the creating manager's email (`PR-Q7`, `PR-Q8`), and I want the member invitation password-setup link emailed to both the invitee and the inviting owner via the unified `PR-b` email layout.

**Why this priority**: Completes Waleed's ~09:30 onboarding-email decisions (`PR-Q7`, `PR-Q8`) after the unified layout + Resend delivery pipeline (`PR-b`) and `recovery_email` (`PR-c1`) are live, without exceeding `PP-273` (`≤1,500` prod lines per PR).

**Independent Test**: Grant staff access (`POST .../staff-access`) with and without `employees.recovery_email` while checking outbox/notification rows & logs for zero plaintext PIN; verify worker decrypts/resolves the ephemeral token in memory only and delivers unified-layout emails (`PR-b`) to the creator manager (and employee when present) containing the 24h forced-change temporary PIN. Invite a member (`076-G1`) and verify unified-layout setup-link emails are sent to both the invitee and the inviting owner with zero raw token leakage in logs.

**Acceptance Scenarios**:

1. **Given** a manager completes «إعطاء دخول» (`076-F1`) and a 24h mandatory-change temporary PIN is issued, **When** the transaction commits, **Then** the outbox/ledger contains only an encrypted cipher blob or short-lived single-use server token reference (never a plaintext PIN in outbox payloads, notification rows, or logs), and when processed by the worker using the unified email layout (`PR-b`), delivers the temporary-PIN welcome email (`PR-Q8`) to both the creating manager's email and the employee's `recovery_email` if present (`PR-Q7`).
2. **Given** an owner creates a member invitation (`076-G1`) with a password-setup link, **When** the invitation commits, **Then** the worker sends unified-layout emails carrying the setup link to both the invited member's email and the inviting owner's email (rather than displaying the link only in the UI), without logging raw tokens or full recipient emails.

*(Out of scope for `079`: `PR-Q9` multi-branch/multi-business/extra-roles/inline-permission-exception user creation workflow — deferred to **`spec 080`**, to be specified after `PR-a` merges.)*

---

### Edge Cases

- **Concurrency / double submission on verify/reset:** Two concurrent `reset` requests with the same valid `challenge_id` and `code` serialize on the in-process gate and Postgres row locks (`recipient_hash` advisory lock + `auth_otp_challenges FOR UPDATE` + `user FOR UPDATE`); the first consumes the challenge and commits, and the second observes `CONSUMED` and returns `401 OTP_INVALID` without hashing twice or writing twice.
- **Account converted to staff user mid-flight (`076 D8`):** `auth_otp_challenges` re-checks `user.staffAccessOperationId === null` inside the locked `PASSWORD_RESET` consumption transaction; if converted, refuses without consuming into a credential write.
- **Email changed or user deleted before worker send:** Worker materialization recomputes the canonical email hash from global `user` and verifies equality with `auth_otp_challenges.recipient_hash`; on mismatch or missing user, terminates the attempt without sending.
- **Provider webhook arrives before worker marks `SENT` (`PROVIDER_ACCEPTED`):** Because `ReconcileEmailFeedback` matches `auth_challenge_id`, `attempt_id`, `execution_id`, and recipient hash on `auth_notification_attempts`, it safely binds `provider_message_digest` / settles without requiring `SENT` to have committed first, and never resets the execution fence.
- **Redis rate-limiter or queue failure:** If Redis is unreachable before lookup, the API fails closed with `503 OTP_UNAVAILABLE` (never exposing whether an email exists). If BullMQ enqueue fails after challenge preparation commits, preparation is marked failed within the 200ms window and the API still returns `202 Accepted` (matching `ADR-0019` anti-enumeration).
- **Dashboard header logo when unset / error:** If the active business has no `logo_file_id` or download fails, `DashboardBrandLogo` degrades cleanly to the Lovable PosPay logo with no crash or broken image icon. Under `TQ-1`, any active member whose membership covers the business can read `logo_file_id` and download the currently bound logo file, whereas upload/replacement/deletion stay restricted to `manage:business-identity:business`.

---

## 3. Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (Unified Email Layout — `PR-a`)**: System MUST provide a shared bilingual (`ar` RTL, `en` LTR) email layout helper in `packages/notifications` with inline CSS, header containing `<img src="${EMAIL_ADMIN_ORIGIN}/brand/logo-mark-simple-tile.png">`, body slot, footer, and plain-text companion; all email templates (`document_expiring`, `password_reset_otp`, `staff_pin_reset_otp`) MUST render through this layout.
- **FR-002 (PosPay Brand Assets & Auth Pages — `PR-a`)**: System MUST replace the legacy inline SVG mark in `packages/ui/src/brand-mark.tsx` with the Lovable design system logo (`logo-mark-simple-tile.png`), served as a static HTTPS asset from `apps/admin/public/brand/logo-mark-simple-tile.png` (reused identically for UI and email `<img>`). Auth screens (`/login`, `/login/two-factor`, `/set-password`, and Forgot Password) MUST always show the PosPay logo.
- **FR-003 (Dynamic Active-Business Logo in Dashboard Header — `PR-a`)**: Admin dashboard frames (`StyleAFrame`, `StyleBFrame`, `StyleCFrame`) MUST render a shared header brand component that displays the active business's uploaded logo from Business Identity (`27h`) with flexible aspect ratio (no `1:1` rule), refreshes automatically when switching business or updating/removing the logo, and falls back to the Lovable PosPay logo when no business logo is available.
- **FR-004 (Forgot Password Endpoints — `PR-b`)**: `packages/auth` MUST expose `POST /v1/auth/password-reset/otp/request` and `POST /v1/auth/password-reset/otp/reset` restricted to credentialed (non-staff) back-office accounts (`user.staffAccessOperationId === null` and `!isStaffSyntheticEmail(user.email)`).
- **FR-005 (OTP Lifetime, Attempts, Storage & Anti-Enumeration — `PR-b` & `PR-c`)**: Both `PASSWORD_RESET` and `STAFF_PIN_RESET` OTPs MUST be 6-digit decimal codes, valid for **10 minutes (`600s`)**, max **5 failed attempts** (`EXHAUSTED` on the 5th failure), store **only a 32-byte keyed MAC (`code_mac`)** in `auth_otp_challenges` (cleared to `NULL` on every terminal state), never log or persist plaintext codes or full addresses/phones outside `user`, and return identical `202` responses and timing whether or not the account exists, is eligible, or is suppressed.
- **FR-006 (Redis Rate Limits & Cooldown — `PR-b` & `PR-c`)**: Before any DB lookup, Redis Lua scripts MUST enforce **5 requests / recipient-hash / hour**, **20 requests / IP-hash / hour**, and a **60-second cooldown** per recipient-hash on `request`; and **25 attempts / challenge-recipient-hash / hour** and **100 attempts / IP-hash / hour** on `reset` (`429 TOO_MANY_REQUESTS` with `Retry-After`).
- **FR-007 (Session Revocation & 2FA Preservation — `PR-b`)**: Successful password reset via OTP MUST delete **all** rows in `session` and all `reset-password:*` rows in `verification` for `user_id` inside the atomic transaction (or immediately after commit cleanly under failure guard), MUST NOT issue a session, and MUST leave `two_factor` enforcement intact on subsequent sign-in.
- **FR-008 (Notification Pipeline & Webhook Reconciliation — `PR-b`, `PR-c1` & `PR-c2`)**: Email/WhatsApp OTP delivery MUST flow through the API-root `OtpSender` (`BullMQ` `notifications-otp` queue) -> `apps/worker/src/modules/notifications` -> `ResendChannel` / `WhatsAppChannel` using the new `packages/notifications` templates (`password_reset_otp`, `staff_pin_reset_otp`, `staff_welcome_pin`, `member_invitation`) and never call Resend from `apps/api`. `ReconcileEmailFeedback` MUST reconcile Resend webhooks for auth-ledger tags (`auth_challenge_id`, `attempt_id`, `execution_id`) against `auth_notification_attempts`, resolving deliveries and suppressing hard bounces/complaints in `platform_email_suppressions`.
- **FR-009 (Audit Trail — `PR-b`, `PR-c1` & `PR-c2`)**: Password reset requests/exhaustions/completions MUST write secret-free entries to `platform_audit_log`. Self-service PIN recovery MUST write secret-free entries to both `platform_audit_log` and tenant `audit_log` (plus owner in-app notice per `TQ-3` / `076 AC-F2-3`).
- **FR-010 (Admin & POS UIs — `PR-b` & `PR-c1`)**: Admin login MUST include a 3-step Forgot Password flow («نسيت كلمة المرور؟» -> 6-digit code -> new password + confirmation). Admin employee create/edit/grant-access forms MUST include optional recommended `recovery_email` (`PR-Q6`). POS staff PIN login MUST include a channel-selectable Forgot PIN flow (`Email` | `WhatsApp` -> 6-digit code -> new 4-digit PIN + confirmation), respecting independent WhatsApp/Email readiness, `packages/i18n`, `packages/ui`, and logical RTL CSS.
- **FR-011 (Single Optional Employee `recovery_email` & PII Protection — `PR-c1`)**: `employees.recovery_email` MUST be the sole optional employee email column (`recovery_email` lives **only** on tenant `employees`, with no new column or `pospay_auth` grant on global `"user"`; auth/worker read it via a narrow `withTenant` port/callback verified against `recipient_hash` while synthetic `user.email` stays untouched), validated for email format in `@pospay/contracts`, protected by `employees` tenant RLS with a negative isolation test, never printed in logs, and masked in reports.
- **FR-012 (Staff Welcome & Member Invitation Emails — `PR-c2`)**: Granting staff access (`076-F1`) MUST email the 24h forced-change temporary PIN (`PR-Q8`) via the unified `PR-b` email layout to both the employee (`recovery_email` when set) and the creating manager (`PR-Q7`), carrying only an encrypted/short-lived token reference in outbox (zero plaintext PIN in outbox, notification tables, or logs). Member invitations (`076-G1`) MUST email the password-setup link to both the invitee and the inviting owner via the unified `PR-b` layout.

---

## 4. Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: A 6-digit OTP expires strictly at `created_at + 600s` (10 minutes) and locks permanently (`EXHAUSTED`) after 5 wrong comparisons. Queue/delivery delays never extend expiry.
- **BR-002**: Only owners, managers, and accountants (non-staff credential accounts) may reset passwords via Email OTP (`076 AC-F1-7` / `D8` enforced under `user FOR UPDATE`). Employees with synthetic staff accounts (`staffAccessOperationId !== null`) use self-service Forgot PIN (`PR-c`) instead.
- **BR-003**: Self-service Forgot PIN sets `cashier_pins.temporary = false` (because the employee proved channel ownership via OTP, respecting `076 AC-ACT-9`) and rotates `cashier_pins.id` so any prior manager-issued `staff_pin_change_proofs` is invalidated.
- **BR-004**: WhatsApp OTP capability and Email OTP capability are gated independently: `EMAIL = READY` enables email OTP recovery even when `STAFF_OTP_ENABLED` / `TENANT_WHATSAPP` is off.
- **BR-005**: `employees.recovery_email` is the single optional employee email used for communication, F1 welcome email, and Forgot PIN email OTP (`PR-Q6`); synthetic `user.email` remains untouched under `076 D8` and cannot sign into Admin.
- **BR-006**: F1 first-login emails send the 24h forced-change temporary PIN to both creator manager and employee (`recovery_email` if present), never persisting plaintext PINs in `outbox`, notification tables, or logs (`PR-Q7`, `PR-Q8`). Member invitations (`076-G1`) email the password-setup link to both invitee and inviting owner.

### Schema changes & ADR-0003 / ADR-0019 Classification

Every table touched by `PR-b` (`auth_otp_challenges`, `auth_notification_attempts`) stays classified under **`ADR-0003 §2.1 Global identity`** (no `company_id`, no tenant RLS, migration-owned by `pospay_owner`, reached only through `packages/auth` on `pospay_auth` via restricted facades). No parallel challenge table is created. Any change in `pospay_auth` grants (`EXECUTE` on `platform_email_is_suppressed`) or auth table constraints in `PR-b` MUST amend `ADR-0003 §2.1` (and add an addendum to `ADR-0019`) in the same PR (`CLAUDE.md` §5).

| Table / Object | PR | Columns / Constraints / Grants Changed | Classification & RLS | Indexes | FKs |
|---|---|---|---|---|---|
| `auth_otp_challenges` | `PR-b` | Expand-only CHECK constraints: widen `auth_otp_challenges_expiry` (`300s` for `STAFF_POS`/`STAFF_PERSONAL`, `600s` for `PASSWORD_RESET`/`STAFF_PIN_RESET`); widen `auth_otp_challenges_context` to accept `{"purpose":"PASSWORD_RESET"}` and `{"purpose":"STAFF_PIN_RESET","companyId":...,"businessId":...,"branchId":...,"deviceId":...,"channel":"EMAIL"\|"WHATSAPP"}` | `ADR-0003 §2.1` Global identity (no RLS, `pospay_auth` only; `ADR-0003` + `ADR-0019` updated in PR) | Existing indexes on `(recipient_hash, status, created_at, id)`, `(user_id)`, `(expires_at, id)` cover queries | Existing `user_id -> user(id)` |
| `auth_notification_attempts` | `PR-b` | Expand-only CHECK constraints: widen `auth_notification_attempts_template` to allow `(channel='EMAIL', template_key IN ('password_reset_otp','staff_pin_reset_otp'), revision=1, locale IN ('ar','en'))` and `(channel='WHATSAPP', template_key IN ('staff_otp','staff_pin_reset_otp'), revision=1, locale IN ('ar','en'))`; widen `auth_notification_attempts_deadline` for `300s` or `600s` | `ADR-0003 §2.1` Global identity (no RLS, `pospay_auth` only; `ADR-0003` + `ADR-0019` updated in PR) | Existing indexes on `(challenge_id, status, created_at, id)`, `(user_id)`, `(send_deadline, id)` | Existing `challenge_id -> auth_otp_challenges(id)` |
| `platform_email_is_suppressed(bytea)` | `PR-b` | `GRANT EXECUTE ON FUNCTION public.platform_email_is_suppressed(bytea) TO pospay_auth` (symmetric to `0032` WhatsApp grant) | Reader-owned `SECURITY DEFINER` (`ADR-0014` / `075`; `ADR-0003 §2.1` amended in PR) | — | — |
| `employees` (`TQ-2` / `PR-Q6`, **Option (أ)**) | `PR-c1` | Single expand migration adding optional nullable `recovery_email text` column on tenant `employees` only (single employee email column for communication, welcome email & recovery) with email format CHECK; **no column or grant changes on global `"user"` / `pospay_auth`**; read by auth/worker via narrow `withTenant(companyId)` port verified against `recipient_hash` (duplicate save rejected with `EMPLOYEE_RECOVERY_EMAIL_TAKEN`, fail-closed uniform `202` + send nothing on ambiguous OTP lookup); zero plaintext logging, masked in reports | Existing `employees` tenant RLS (`withTenant`, `pospay_app`) with negative isolation test covering `recovery_email` in `PR-c1` | Partial **UNIQUE** index `employees_company_recovery_email_uidx` on `employees (company_id, lower(recovery_email)) WHERE recovery_email IS NOT NULL AND deleted_at IS NULL` | — |

### API contract

- **`[PR-a, TQ-1]` Business Logo Read for Active Business Members**:
  - `workspaceBusiness` (`GET /v1/me/workspaces`) exposes optional `logo_file_id: id.nullable().optional()` for each business the member covers, and `POST /v1/files/:id/download` permits any active member covering `file.businessId` to download a `settings`-owned file **currently bound** as `business_settings.logo_file_id`. Uploading, replacing, deleting, unbound `settings` files, and `GET /v1/businesses/:businessId/settings/identity` remain restricted to `manage:business-identity:business`. (`ADR-0046` addendum included in `PR-a`.)
- **`[PR-b]` `POST /v1/auth/password-reset/otp/request`** (`@Public()` / Better Auth endpoint in `packages/auth`, trusted origin + Redis rate limit before lookup, `1024 B` body cap):
  - Request: `{ email: canonicalEmail, locale: z.enum(['ar', 'en']) }` (`.strict()`, `packages/contracts/src/identity/password-reset-otp.ts`)
  - `202`: `{ status: 'ACCEPTED', challenge_id: id, expires_in: 600, retry_after: 60 }` (constant-time ~200ms regardless of user existence/type/suppression)
  - `429`: `TOO_MANY_REQUESTS` (`retry-after` header) · `503`: `OTP_UNAVAILABLE`
- **`[PR-b]` `POST /v1/auth/password-reset/otp/reset`** (`@Public()` / Better Auth endpoint in `packages/auth`, `1024 B` body cap):
  - Request: `{ challenge_id: id, code: z.string().regex(/^\d{6}$/), new_password: z.string().min(8).max(128) }` (`.strict()`)
  - `200`: `{ status: 'RESET' }`
  - `401`: `OTP_INVALID` · `400`: `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG` (request validation) · `403`: `FORBIDDEN` (untrusted origin) · `429`: `TOO_MANY_REQUESTS` · `503`: `OTP_UNAVAILABLE`
- **`[PR-c1]` `POST /v1/devices/me/staff-pin/otp/request` & `POST /v1/devices/me/staff-pin/otp/reset`** (`@Authenticated()`, `@SetMetadata(STAFF_ROUTE, 'device')`, gated on `STAFF_ACCESS_ROUTES` + independent Email / WhatsApp capability readiness) + optional `recovery_email` added to employee create/edit/grant-access contracts (`@pospay/contracts`):
  - Request `/request`: `{ channel: z.enum(['EMAIL', 'WHATSAPP']), identifier: z.string().min(3).max(254), locale: z.enum(['ar', 'en']) }` (`.strict()`; Email identifier validated cleanly in contract without leaking user existence) -> `202 { status: 'ACCEPTED', challenge_id, expires_in: 600, retry_after: 60 }`
  - Request `/reset`: `{ challenge_id: id, code: z.string().regex(/^\d{6}$/), pin: z.string().regex(/^\d{4}$/) }` (`.strict()`) -> `204 No Content`
  - Errors: `OTP_INVALID` (`401`), `TOO_MANY_REQUESTS` (`429`), `OTP_UNAVAILABLE` (`503`), `FORBIDDEN` (`403`)
- **`[PR-c2]` F1 Temporary PIN Welcome Email & G1 Member Invitation Email**: Uses existing `076-F1` and `076-G1` endpoints; server-side outbox/transport carries only encrypted/tokenized payload (never plaintext PIN or unmasked email) for unified-layout delivery after `PR-b`.

### Permissions

- **Password Reset OTP (`PR-b`)**: Unauthenticated public recovery flow protected by trusted-origin check, per-IP and per-email-hash Redis rate limits/cooldown, and strict eligibility filtering (`user.staffAccessOperationId === null`, `!isStaffSyntheticEmail`). Existing `two_factor` requirement stays enforced on subsequent sign-in.
- **Self-Service Staff PIN Reset OTP (`PR-c1`)**: Device-authenticated flow (`Authorization: Device ...` from active paired device on company/business/branch + `STAFF_POS_ORIGIN`), requiring active `employee_staff_access`, active membership covering the device's branch, and `login:staff:branch` permission. Synthetic `user.email` (`staff-<op>@staff.pospay.invalid`) remains isolated under `076 D8`; single optional `employees.recovery_email` is validated in `@pospay/contracts` and never logged.
- **Welcome & Invitation Emails (`PR-c2`)**: Triggered strictly inside existing authorized `076-F1` (`grant:staff-access` authority) and `076-G1` (`owner` invitation authority) transactions.
- **Dashboard Logo Read (`PR-a`, `TQ-1`)**: Any active member covering the business (`COMPANY`, `BUSINESS`, or child `BRANCH` scope) may read `logo_file_id` and download the currently bound business logo file (`POST /v1/files/:id/download`). Uploading/replacing/removing logos and reading `/business-identity` screen remain restricted to `manage:business-identity:business`.

### Events

- **`PR-b`**: Uses global auth notification ledger (`auth_notification_attempts` + `BullMQ` `notifications-otp` queue) — no tenant outbox (pre-login has no tenant).
- **`PR-c1` (`TQ-3`)**: Emits `StaffPinRecovered` in-app owner bell notice event via outbox inside the tenant PIN update transaction, consumed by notifications to notify the company owner (employee/branch/channel/time only — never PIN, code, or `recovery_email`).
- **`PR-c2`**: Emits ephemeral encrypted/tokenized welcome/invitation email dispatch requests using unified `PR-b` layout (zero plaintext PIN in outbox or notification tables; Opus `effort: "high"` review required).

### Test plan

- **Domain / Package unit (`@pospay/notifications`, `@pospay/auth`, `@pospay/ui`)**:
  - Email layout snapshot/DOM assertions (`ar` RTL, `en` LTR, HTTPS logo URL, inline CSS, no attachments, all templates rendered via layout).
  - Unbiased 6-digit OTP derivation & MAC verification for `PASSWORD_RESET` and `STAFF_PIN_RESET` contexts; 10-minute (`600s`) lifetime & 5-attempt boundary; timing-safe comparison & dummy work.
  - Admin `BrandMark` & `DashboardBrandLogo` rendering (auth fallback to PosPay logo, active business switch, upload/remove invalidation, non-1:1 aspect ratio, error fallback).
- **Integration (`apps/api`, `apps/worker`, `packages/db`)**:
  - `PR-a` (`TQ-1`): Active non-owner business member reads `logo_file_id` in `/v1/me/workspaces` and downloads the currently bound business logo file; unbound settings files and foreign-business/company members are denied (`404`/`403`) + `file_access_audit` recorded.
  - Privilege & constraint tests on expanded `auth_otp_challenges` & `auth_notification_attempts` (`pospay_app` denied, `pospay_auth` allowed only `EXECUTE` on `platform_email_is_suppressed`).
  - `EXPLAIN ANALYZE` on any new/modified queries (e.g., `recovery_email` lookup or auth-attempt reconciliation) and negative RLS isolation test covering `employees.recovery_email`.
  - Anti-enumeration tests: identical `202` response/body for unknown email, staff synthetic email, suppressed email, and eligible owner/manager; Redis rate limits (`5/hr`, `20/hr`, `60s` cooldown) & verification (`25/hr`, `100/hr`).
  - Atomic reset tests: concurrent resets serialize cleanly, 5 wrong codes exhaust challenge & clear `code_mac`, expired at `600s` refused, successful reset deletes all user `session` rows + `reset-password:*` rows, `two_factor` still prompted on next login.
  - Worker end-to-end with stub Resend server + webhook feedback reconciliation (`email.delivered` -> resolved; permanent bounce -> `platform_email_suppressions` -> subsequent OTP request suppressed silently with `202` and zero provider calls).
  - `PR-c1`: Independent Email vs WhatsApp readiness gating, permanent PIN write (`temporary = false`, `076 AC-ACT-9`), old temporary-PIN proof invalidation, owner bell notice without PIN (`TQ-3` / `076 AC-F2-3`), and audit/log checks proving zero secrets/codes/PINs/full emails.
  - `PR-c2`: Encrypted/tokenized temporary PIN handoff verified (zero plaintext PIN in outbox, notification tables, or logs), unified email delivery to both creator manager and employee (`recovery_email` when set), and G1 invitation link delivery to both invitee and owner.
- **UI tests (`apps/admin`, `apps/pos`)**:
  - Assert visible headings, error alerts (`role="alert"`), cooldown countdown, step transitions, optional `recovery_email` input validation, logo `src`/`alt` attributes, and accessible button/field states (no mock-only assertions per `CLAUDE.md` §9).

---

## 5. Success Criteria *(mandatory)*

- **SC-001**: 100% of operational and auth emails render through the shared RTL/LTR HTML layout with valid HTTPS Lovable PosPay logo links and plain-text fallbacks.
- **SC-002**: 100% of Admin auth pages show the Lovable PosPay logo, and 100% of Admin dashboard styles (`A`, `B`, `C`) display the active business logo and update within the same client session on business switch or logo mutation.
- **SC-003**: Forgot Password OTP flow achieves zero account-enumeration leakage (identical HTTP status and response shape across unknown, staff, suppressed, and eligible emails) and invalidates 100% of prior user sessions on reset while preserving 2FA.
- **SC-004**: Staging proof after `PR-b`: at least one real Forgot Password OTP email sent from staging to Waleed's controlled address via Resend, with `email.delivered` received at `/v1/webhooks/resend` and reconciled cleanly on `auth_notification_attempts` with zero secrets or full addresses in logs.
- **SC-005**: Employee Forgot PIN flow operates independently on Email OTP when WhatsApp is disabled, refuses WhatsApp cleanly (`503 OTP_UNAVAILABLE`) until activated, and leaves `temporary = false` + owner notice on completion.
- **SC-006**: F1 staff welcome emails (carrying the 24h temporary PIN via encrypted/token envelope with zero plaintext PIN stored in outbox/notifications/logs) and G1 member invitation emails deliver cleanly through the unified layout to both recipient and creator/inviter.
