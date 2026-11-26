# Implementation Plan: Email & WhatsApp OTP Recovery + Unified Email Layout & Lovable Brand / Business Logos (`spec 077` → `docs/specs/079-auth-otp-recovery-and-brand-logo`)

**Date**: 2026-11-26  
**Spec**: [`spec.md`](./spec.md) · **Owner Decisions**: [`owner-questions.ar.md`](./owner-questions.ar.md)  
**Baseline**: `origin/main@6487c6ec0` (includes `PP-277` review gate and `075-C1b+C2` email activation `#1321`)  
**Status**: Approved by Project Manager (2026-11-26 09:21 Kuwait) — `PR-a` active (`PR-b` and `PR-c` start sequentially after `PR-a` merges).

---

## Summary

Deliver three small, well-bounded pull requests (`≤1,500` production lines each, at most `1` database migration per PR) building the unified email HTML/text layout with Lovable's Sadu `P` mark, displaying the active business's uploaded logo dynamically in the Admin dashboard header (with PosPay fallback), enabling self-service 6-digit Email OTP password recovery for back-office credential accounts (owners/managers, excluding staff accounts), and adding self-service Email/WhatsApp OTP PIN recovery for employees on paired branch POS devices by reusing the `ADR-0019` / `ADR-0003 §2.1` auth OTP ledger.

---

## Technical Context

**Language/Version**: TypeScript 5.x (ESM / Node 24), React 19 / Next.js 15 App Router (`apps/admin`), Vite React (`apps/pos`), NestJS + Fastify (`apps/api`), BullMQ worker (`apps/worker`)  
**Primary Dependencies**: Better Auth 1.7.5 (pinned per `ADR-0009`), Drizzle ORM + `postgres`, `ioredis`, `bullmq`, Zod (`packages/contracts`), `@pospay/ui` (`Souk Tiles`, `ADR-0059`/`ADR-0060`)  
**Storage**: PostgreSQL (`pospay_auth` for global identity tables under `ADR-0003 §2.1`; `pospay_notifications` for `platform_email_*`; `pospay_app` under `withTenant` RLS for tenant settings/pins/outbox), Redis (rate limits, cooldowns, BullMQ)  
**Testing**: Vitest (`pnpm test`), integration specs against isolated ephemeral Postgres/Redis lanes, HTTP stub for Resend, UI tests asserting visible user state (`PP-7.2`)  
**Constraints**: `≤1,500` production lines per PR (`PP-273`/`PP-274`); max 1 migration per PR; no email/OTP secrets or plaintext OTPs persisted or logged anywhere; no direct Resend HTTP calls from `apps/api`; preserve `two_factor` after reset and `076 D8` / `AC-F1-7` staff isolation.

---

## Review Gate (`PP-277` — `origin/main@6487c6ec0`, mandatory on every PR)

Per Waleed's decision **`PP-277`** (`docs/owner-decisions.ar.md`, 2026-11-26 ~09:10 Kuwait, `CLAUDE.md` PP-273/PP-274):

1. **Implementer Local Guards (`PP-198`) — every PR (`PR-a`, `PR-b`, `PR-c`):**
   - Run `clean-code-guard` and `test-guard` after tests pass.
   - `/waleed-ui-restructure` is **removed** from the review gate across all PRs (`PP-277` item 2 — UI is reviewed through the PosPay Addendum instead).
2. **Independent Reviewer (`claudeAgent / claude-opus-5-5`) — every PR:**
   - Runs **`/waleed_general_reviewer`** (replacing `/engineering:code-review`, which is no longer used).
   - **Mandatory PosPay Addendum (`ملحق PosPay` from `docs/owner-decisions.ar.md` §PP-277 item 5)** included verbatim in every reviewer brief and evaluated like any lens:
     - **الأداء:** مفيش N+1. كل query جديدة ليها index في نفس الـ migration. كل ملف `queries/` ليه اختبار شكل النتيجة واختبار `EXPLAIN ANALYZE`. أي حاجة متوقع تعدي 200ms تبقى job في الـ worker. اختبارات الأداء نسبة للكود القديم بس، ≤2× (`PP-165`).
     - **الفلوس:** `bigint` mills أو `Money`، ومفيش `number`. الحسابات في `domain/` بس.
     - **الـ tenant:** كل وصول من خلال `withTenant`، ومفيش raw Drizzle client. كل جدول جديد ليه policy واختبار عزل سلبي. المفتاح `(company_id, id)`.
     - **الـ use case:** مفيش `drizzle` ولا `sql` ولا `fetch` ولا حسابات. `Clock` و`IdGenerator` بيتحقنوا.
     - **الـ events:** الـ outbox جوه نفس الـ transaction. `Idempotency-Key` على أي endpoint فيه أثر فلوس أو مخزون.
     - **التوثيق:** JSDoc عربي على `domain/**` و`ports/**` و`events/published.ts`. مفيش `FIXME`/`HACK` ولا كود متعلّق.
     - **الواجهة:** النصوص من `packages/i18n`. CSS منطقي (RTL)، ومفيش `left`/`right`. المكونات من `packages/ui`. اختبار الواجهة بيتأكد من اللي المستخدم بيشوفه (`PP-7.2`).
3. **Per-PR Reviewer Effort & Lenses:**
   - **`PR-a` (Logo & Email Layout):** `claude-opus-5-5`, **`effort: "medium"`** + `/waleed_general_reviewer` + PosPay Addendum (including the **الواجهة** UI lens; no `/waleed-ui-restructure`).
   - **`PR-b` (Forgot Password Email OTP + migration):** `claude-opus-5-5`, **`effort: "high"`** (auth/OTP + migration) + `/waleed_general_reviewer` + PosPay Addendum — the **Security lens runs Focused automatically** (no separate `waleed-security-reviewer` call needed per `PP-277` item 1) + DB/RLS & `الواجهة` lenses.
   - **`PR-c` (Employee Forgot PIN Email/WhatsApp OTP):** `claude-opus-5-5`, **`effort: "high"`** (auth/OTP) + `/waleed_general_reviewer` + PosPay Addendum — **Focused Security lens automatic** + `الواجهة` lens.
4. **Severity & CI Gate:** Blocker (`P0`/`P1`) blocks merge; `Should fix` (`P2`) resolved in consolidated batch; exact-head `ci-gate` 31/31 green; CodeRabbit optional/advisory (`PP-208`).

---

## PR Split & Line Estimates (`≤1,500` production lines/PR, ≤1 migration/PR)

| PR | Order | Scope | Migrations | Prod + Config + Docs | Tests | Total | Cap (`≤1,500` prod) | Review Gate (`PP-277`) |
|---|---|---|---|---|---|---|---|---|
| **PR-a** | 1 | Unified Email HTML/Text Layout (`renderEmailLayout` + update `document_expiring`), Lovable `logo-mark-simple-tile.png` asset in `apps/admin/public/brand/` & `apps/pos/public/brand/`, updated `BrandMark` on auth screens + POS, dynamic `DashboardBrandLogo` across Admin Styles A/B/C (with PosPay fallback) | **0** | ~340 | ~280 | ~620 | 680 prod (`≤1,500`) | `clean-code-guard` + `test-guard`; Opus `effort: "medium"` `/waleed_general_reviewer` + PosPay Addendum (no `/waleed-ui-restructure`) |
| **PR-b** | 2 | Forgot Password via 6-Digit Email OTP (Owners/Managers): expand `auth_otp_challenges` & `auth_notification_attempts` (`ADR-0003`/`ADR-0019` addendum) + `platform_email_is_suppressed` grant; `POST /v1/auth/password-reset/otp/request` & `/reset`; Redis rate limits (`5/20`, cooldown `60s`, `25/100`); `password_reset_otp` template + worker send via `ResendChannel` + auth-tag support in `resend-retrieval.ts` & `ReconcileEmailFeedback`; `platform_audit_log`; Admin 3-step Forgot Password UI | **1** | ~680 | ~540 | ~1,220 | 1,360 prod (`≤1,500`) | `clean-code-guard` + `test-guard`; Opus **`effort: "high"`** `/waleed_general_reviewer` + PosPay Addendum (automatic Focused Security lens) |
| **PR-c** | 3 | Employee Self-Service Forgot PIN via Email or WhatsApp OTP: `1` expand migration adding optional `recovery_email` (`TQ-2`, negative RLS test + contract email format check; synthetic `user.email` stays isolated, PII never logged/masked in reports); `POST /v1/devices/me/staff-pin/otp/request` & `/reset` reusing `ADR-0019` challenge/ledger + Redis rate caps; independent Email vs WhatsApp readiness gating; `staff_pin_reset_otp` Email & WhatsApp templates; permanent PIN rotation (`temporary = false`, `076 AC-ACT-9`) + owner in-app bell notice without PIN (`TQ-3` / `076 AC-F2-3`) + audit; POS channel-selector UI | **1** (`recovery_email`) | ~640 | ~510 | ~1,150 | 1,280 prod (`≤1,500`) | `clean-code-guard` + `test-guard`; Opus **`effort: "high"`** `/waleed_general_reviewer` + PosPay Addendum (automatic Focused Security lens) |

---

## Detailed File & Component Plan per PR

### PR-a — Unified Email Layout + Lovable PosPay Logo + Dynamic Dashboard Business Logo (`0` migrations, ~340 prod lines)

1. **Brand Assets (single HTTPS source for UI & email):**
   - Copy `F:\Dev\Projects\lovable-pospay\public\brand\logo-mark-simple-tile.png` to:
     - `apps/admin/public/brand/logo-mark-simple-tile.png` (served by Admin web app at `/brand/logo-mark-simple-tile.png` AND via `${EMAIL_ADMIN_ORIGIN}/brand/logo-mark-simple-tile.png` in Resend emails; copied automatically by `deploy/Dockerfile.admin:24`)
     - `apps/pos/public/brand/logo-mark-simple-tile.png`
   - Update `packages/ui/src/brand-mark.tsx` so `BrandMark` renders the Lovable `logo-mark-simple-tile.png` mark cleanly (keeping accessible `alt` / `aria-label`, default sizing, and `BrandLockup` composition for auth pages, POS panel, and fallback header).
2. **Unified Email HTML + Text Layout (`packages/notifications`):**
   - Add `packages/notifications/src/templates/email-layout.ts` (`renderEmailLayout`): table-based HTML container, inline CSS only, Souk Tiles neutrals/accents (`#0D1522`, `#FF6421`, `#F7F1E8`), `dir="rtl"` for `ar` / `dir="ltr"` for `en`, header with `<img src="${adminOrigin}/brand/logo-mark-simple-tile.png" width="48" height="48" alt="PosPay" ... />`, structured body slot, footer, plus plain-text formatter.
   - Refactor `packages/notifications/src/templates/email-operational.ts` so `document_expiring` renders inside `renderEmailLayout`.
   - Keep `packages/notifications/src/email-configuration.ts` & `ResendChannel` startup self-check working with the updated `renderOperationalEmail`.
3. **Admin Dashboard Dynamic Business Logo (`apps/admin` & pending `TQ-1` API):**
   - Add `apps/admin/app/(dashboard)/_frame/frames/dashboard-brand-logo.tsx`:
     - Reads active `{ company, business }` from `useWorkspace()`.
     - Reads the active business's `logo_file_id` (reacting automatically to `WorkspaceSwitcher` changes and `['business-identity', companyId, userId, businessId]` invalidations from `useBusinessLogo`), requests a signed download URL when `logo_file_id` is present (`useLogoDownload`), and displays `<img className="h-9 w-auto max-w-[9rem] object-contain" ... />` (flexible ratio — no `1:1` requirement).
     - Falls back immediately to `BrandMark` / `BrandLockup` (Lovable PosPay logo) when `logo_file_id === null`, no business is selected, or the user lacks read access.
   - Mount `DashboardBrandLogo` consistently in:
     - `apps/admin/app/(dashboard)/_frame/frames/style-a-frame.tsx` (replacing static `BrandLockup`/`BrandMark`)
     - `apps/admin/app/(dashboard)/_frame/frames/style-b-frame.tsx` (start of `TopNav` bar)
     - `apps/admin/app/(dashboard)/_frame/frames/style-c-frame.tsx` (`FrameTopBar` / `PanelToolbar` or rail header)
   - **`TQ-1` Option A (approved 2026-11-26):** Any active member whose membership covers the business reads `logo_file_id` (via `GET /v1/me/workspaces`) and can download the currently bound business logo file via `POST /v1/files/:id/download` (verified against `business_settings.logo_file_id` and covering business membership); uploading/replacing/deleting logos, unbound settings files, and `/business-identity` stay strictly restricted to `manage:business-identity:business`. Includes `ADR-0046` addendum (and queued alongside `PR-Q2` and `PR-Q5` for the next decisions-page batch for Abu Salem).
4. **Tests (~280 lines):** `email-layout.spec.ts`, `brand-lockup.spec.tsx`, `dashboard-brand-logo.spec.tsx` (testing switch business, upload/remove invalidation, non-1:1 aspect, fallback to PosPay logo, auth pages always showing PosPay logo), plus API integration coverage for non-owner covering member logo read & bound-only download vs unbound denial (`TQ-1`).

---

### PR-b — "Forgot Password" via 6-Digit Email OTP for Owners & Managers (`1` migration, ~680 prod lines)

1. **Migration & `ADR-0003 §2.1` + `ADR-0019` Addendum (`1` expand-only migration `0266` — reserve lane before numbering):**
   - **Mandatory in the same PR (`CLAUDE.md` §5):** Update `docs/adr/0003-auth-rls-boundary.md` §2.1 notes (amendment) and `docs/adr/0019-staff-otp-login.md` addendum documenting `pospay_auth` `EXECUTE` grant on `platform_email_is_suppressed(bytea)` and reuse/expanded CHECK constraints on `auth_otp_challenges` + `auth_notification_attempts` for `PASSWORD_RESET` and `STAFF_PIN_RESET`.
   - Expand CHECK constraints in PostgreSQL + `packages/db/schema/identity-staff-otp.ts`:
     - `auth_otp_challenges_expiry`: `(device_context->>'purpose' IN ('PASSWORD_RESET','STAFF_PIN_RESET') AND expires_at = created_at + interval '600 seconds') OR ((device_context->>'purpose' IS NULL OR device_context->>'purpose' = 'STAFF_PERSONAL') AND expires_at = created_at + interval '300 seconds')`.
     - `auth_otp_challenges_context`: allow `{"purpose":"PASSWORD_RESET"}` alongside existing `STAFF_POS`, `STAFF_PERSONAL`, and `STAFF_PIN_RESET` shapes.
     - `auth_notification_attempts_template`: allow `channel IN ('WHATSAPP','EMAIL')` with `template_key IN ('staff_otp','password_reset_otp','staff_pin_reset_otp')`, `template_revision = 1`, `locale IN ('ar','en')`.
     - `auth_notification_attempts_deadline`: match `600 seconds` for reset templates and `300 seconds` for `staff_otp`.
   - Grant `EXECUTE ON FUNCTION public.platform_email_is_suppressed(bytea) TO pospay_auth;` and update `packages/db/src/staff-otp-inventory.ts` + `packages/db/test/*grants*.ts`.
2. **`packages/db` (`password-reset-otp-database.ts` / extend `staff-otp-database`):**
   - Global `pospay_auth` facade only:
     - `lookupCredentialUserByEmail(email)`: returns `{ id, email, staffAccessOperationId }` (or `null`); caller refuses `staffAccessOperationId !== null`.
     - `prepareEmailResetChallenge`: acquires `pg_advisory_xact_lock(emailLockKey(hash))`, calls `public.platform_email_is_suppressed(hash)`, supersedes earlier `ACTIVE` `PASSWORD_RESET` challenges for that `recipient_hash`, inserts `auth_otp_challenges` + `auth_notification_attempts` (`PREPARED`, `expires_at = created_at + 600s`, `channel = 'EMAIL'`, `template_key = 'password_reset_otp'`), writes `platform_audit_log` when prepared/suppressed.
     - `release` / `claim` / `materializeEmail` / `finish` for worker execution (reusing `auth_notification_attempts` execution fence, resolving destination from `user.email` and asserting hash match + `staffAccessOperationId === null`).
     - `consumeAndResetPassword`: inside `pg_advisory_xact_lock(recipient_hash)` + `auth_otp_challenges FOR UPDATE` + `user FOR UPDATE`:
       - Validates `ACTIVE`, `purpose = 'PASSWORD_RESET'`, `now < expires_at`, `staffAccessOperationId === null`, current `user.email` hash equals `recipient_hash`.
       - Compares `code_mac` (`timingSafeEqual`); wrong code increments `failed_attempts` and sets `EXHAUSTED` (`code_mac = NULL`) at `5` + `platform_audit_log`.
       - On match: marks `CONSUMED` (`code_mac = NULL`, `consumed_at = now`), updates/inserts `account` (`providerId = 'credential'`) password hash (pre-computed outside lock after live pre-check), **deletes all rows in `session` WHERE `user_id = owner.id`**, deletes `verification` rows `LIKE 'reset-password:%'` for `owner.id`, and writes `platform_audit_log`.
3. **`packages/auth` (`password-reset-otp/` module & plugin endpoints in `auth-service.ts`):**
   - Context domain tag `'pospay:password-reset-otp:context:v1'` using `createOtpCrypto`.
   - Redis rate-limit adapter reusing `redisOtpRates` Lua script: `5/email/hr`, `20/IP/hr`, `60s` cooldown on request; `25/challenge/hr`, `100/IP/hr` on reset.
   - 200ms constant-time window + dummy MAC compare; endpoints `/v1/auth/password-reset/otp/request` and `/v1/auth/password-reset/otp/reset`; reuses `OtpSender.enqueue({ challengeId, attemptId }, deadline)` on `notifications-otp`.
   - Preserves Better Auth `twoFactor` plugin untouched so `two_factor` accounts still require TOTP after password reset.
4. **Notification Pipeline & Resend Webhook Reconciliation (`packages/notifications` + `apps/worker`):**
   - `packages/notifications/src/templates/password-reset-otp.ts` + register `'password_reset_otp'` (`revision: 1`, `ar`/`en`, `safe_parameters: [code]` inside worker memory only) in `renderOperationalEmail` (rendered inside `renderEmailLayout` from `PR-a`) — note: reject `'password_reset_otp'` in tenant `AuthorizeNotification` so tenant business events can never forge OTP emails!
   - Extend `apps/worker/src/modules/notifications/otp.module.ts` & `use-cases/send-staff-otp/send-staff-otp.ts` (or sibling worker processor on `notifications-otp`) so attempts with `channel === 'EMAIL'` send through `ResendChannel` using auth correlation tags `{ auth_challenge_id, attempt_id, execution_id }`.
   - Extend `packages/notifications/src/adapters/resend-retrieval.ts` and `apps/worker/src/modules/notifications/use-cases/reconcile-email-feedback/` so retrieved Resend emails carrying `{ auth_challenge_id, attempt_id, execution_id }` reconcile against `auth_notification_attempts`, verify recipient hash, resolve `platform_email_feedback_inbox`, and write `platform_email_suppressions` + `platform_email_audit` on permanent bounce/complaint without failing with `TAGS_INVALID`.
5. **Contracts, API Wiring & Admin UI (`packages/contracts`, `apps/api`, `packages/i18n`, `apps/admin`):**
   - Strict Zod schemas + OpenAPI paths for the two auth endpoints (`@PosPay/contracts`, regenerated `schema.d.ts` where needed).
   - Mount `passwordResetOtp` rate limiter & sender in `apps/api` composition root (enabled whenever `EMAIL = READY` + `REDIS` + `AUTH_DATABASE_URL`, independent of WhatsApp/Staff OTP).
   - Admin `/login` (`apps/admin/src/session/`): «نسيت كلمة المرور؟» link in `LoginForm` switching cleanly in `GuestFrame` through `request` -> `verify code (6 digits, 60s resend timer)` -> `new password + confirm` -> `done (go to /login)`.
6. **Tests (~540 lines):** Crypto/domain specs, DB constraint/grant/EXPLAIN specs, API anti-enumeration + rate-limit + concurrency + session-revocation + 2FA preservation specs, worker stub-Resend + webhook feedback reconciliation specs, Admin UI tests.

---

### PR-c — Employee Self-Service "Forgot PIN" via Email or WhatsApp OTP (`1` migration, ~640 prod lines)

1. **Optional `recovery_email` Field (`TQ-2` Option A — approved 2026-11-26, 1 expand migration):**
   - Add nullable `recovery_email` on `"user"` (`pospay_auth`, isolated under `076 D8` — can never log into Better Auth admin or receive password resets) and optional `recovery_email` on tenant `employees` (email format CHECK + contract validation in `@pospay/contracts` + negative RLS isolation test covering the new column on `employees` + zero logging, masked in reports).
   - Sync optional `recovery_email` from employee create/edit/grant-access via `identity` -> `packages/auth` so `packages/auth` looks up staff Email OTP targets via `recovery_email` (falling back to non-synthetic `user.email` where applicable).
2. **Backend Endpoints & Reuse of `ADR-0019` Infrastructure (`packages/contracts`, `packages/auth`, `apps/api`):**
   - `POST /v1/devices/me/staff-pin/otp/request` and `POST /v1/devices/me/staff-pin/otp/reset` in `StaffPinController` / `StaffOtpController` (paired branch device auth, `STAFF_POS_ORIGIN`, behind `STAFF_ACCESS_ROUTES` gate).
   - Channel selection: `{ channel: 'EMAIL' | 'WHATSAPP', identifier, locale }`:
     - **`WHATSAPP`**: checks existing WhatsApp OTP capability readiness (`STAFF_OTP_ENABLED=true`, `NOTIFICATIONS_MODE=live`, approved `staff_pin_reset_otp` WhatsApp template); returns `503 OTP_UNAVAILABLE` while WhatsApp is unconfigured/disabled on staging.
     - **`EMAIL`**: checks `EMAIL` capability readiness independently — works immediately even while `TENANT_WHATSAPP = LIVE_NOT_AUTHORIZED` and `STAFF_LOGIN = DISABLED`!
   - Eligibility under device tenant (`withTenant(device.companyId)`): employee has `ACTIVE` `employee_staff_access`, active branch-covering membership with `login:staff:branch`, and matching bound phone (for `WHATSAPP`) or bound recovery email (for `EMAIL`). Same `202` anti-enumeration response & 200ms window regardless of outcome.
   - Uses `auth_otp_challenges` (`purpose: 'STAFF_PIN_RESET'`, `expires_at = created_at + 600s`) and `auth_notification_attempts` (`template_key: 'staff_pin_reset_otp'`), plus `redisOtpRates` (`5/20` + `60s` cooldown on request, `25/100` on reset).
   - Atomic PIN reset on verified OTP: verifies `isWellFormedCashierPin(pin)`, hashes PIN via `PinHasher`, rotates `cashier_pins` under user lock (`temporary = false`, `expires_at = NULL`, `set_by = NULL`, new `id` revoking any old `staff_pin_change_proofs`, respecting `076 AC-ACT-9`), clears Redis PIN lockout counters, writes `audit_log` + `platform_audit_log`, and (`TQ-3` Option A) emits owner in-app bell notice (`StaffPinRecovered` / `076 AC-F2-3`, without the PIN or email).
3. **Templates & Worker (`packages/notifications`, `apps/worker`):**
   - Add `staff_pin_reset_otp` (`revision: 1`, `ar`/`en`, bilingual email via `renderEmailLayout` + WhatsApp preparation stub awaiting Meta template approval).
4. **POS UI (`apps/pos/src/staff-login/`):**
   - Add «نسيت الرقم السري؟» in `PinForm` leading to channel selection (`Email` / `WhatsApp`) -> identifier input -> 6-digit OTP input -> new 4-digit PIN + confirmation -> return to PIN sign-in with confirmation alert.
5. **Tests (~510 lines):** Channel independence tests (Email works while WhatsApp returns 503), negative RLS isolation test covering `employees.recovery_email`, anti-enumeration, rate limits, permanent PIN (`temporary = false`) + stale-proof invalidation (`076 AC-ACT-9`), owner bell notice without PIN (`076 AC-F2-3`), zero PII logging, and POS UI interaction tests.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Auth-ledger OTP emails hitting `TAGS_INVALID` quarantine in `ReconcileEmailFeedback`** | High — every Password Reset email webhook (`email.delivered` / `email.bounced`) would quarantine instead of resolving/suppressing (`spec 075`) | Explicitly extend `resend-retrieval.ts` and `ReconcileEmailFeedback` in `PR-b` to accept `{ auth_challenge_id, attempt_id, execution_id }` tags alongside tenant tags and settle against `auth_notification_attempts` on `pospay_auth` + `platform_email_suppressions` on `pospay_notifications`. |
| **Bypass of `two_factor` or leaked session on Forgot Password** | Critical (`P0`) | Follow Waleed decision PR-Q2: `PASSWORD_RESET` never creates a session; it atomically deletes all `session` rows and `reset-password:*` tokens for `user_id`. Normal sign-in + `two_factor` TOTP remains mandatory afterward. |
| **Crossing the `076 D8` / `AC-F1-7` boundary (staff user gaining password or admin session)** | Critical (`P0`) | Enforce `user.staffAccessOperationId === null && !isStaffSyntheticEmail(email)` on lookup **and** again under `user FOR UPDATE` before consuming `PASSWORD_RESET`, keeping Better Auth `staffUserD8Hooks` intact. Keep optional `recovery_email` (`TQ-2`) strictly separate from credential login, validated in contract, never logged, and masked in reports. |
| **`PR-b` approaching the 1,500-line production cap** | Medium (`PP-273` size gate) | Reuse existing `auth_otp_challenges`, `auth_notification_attempts`, `createOtpCrypto`, `redisOtpRates`, and `BullmqOtpSender` rather than duplicating infra; estimated ~680 prod lines (~45% of cap). Split Admin Forgot Password UI cleanly to its own small PR only if needed during implementation. |
| **Broken image / missing asset or relative logo URL in emails** | Medium | Require `EMAIL_ADMIN_ORIGIN` (`https://app.staging.pospay.systems` or `https://app.pospay.systems`), verify the file exists at `apps/admin/public/brand/logo-mark-simple-tile.png` (copied into runner image by `Dockerfile.admin:24`), and test full HTTPS URL generation + HTTP 200 reachability on staging. |
| **Exposing unbound settings files when opening logo reads to business members (`TQ-1`)** | Medium (Security) | In `IssueDownload`, grant active business-covering member access **only** when `file.ownerModule === 'settings'` AND `file.id === business_settings.logo_file_id` for `file.businessId`. Any unbound/retired `settings` file still requires `manage:business-identity:business`. |

---

## Settled Technical Decisions (Waleed, 2026-11-26 ~09:20 Kuwait)

1. **`TQ-1` (`PR-a`):** **Option A (`«أي عضو في النشاط (المقترح)»`)** — Any active member whose membership covers the business reads `logo_file_id` and downloads the bound business logo file, while upload/replacement/deletion stay restricted to `manage:business-identity:business`. Flagged alongside `PR-Q2` and `PR-Q5` for the next decisions-page batch for Abu Salem (`PENDING`).
2. **`TQ-2` (`PR-c`):** **Option A (`«خانة «إيميل الاستعادة» اختيارية (المقترح)»`)** — Single expand migration adding optional `recovery_email` (on `"user"` + `employees` with tenant RLS & negative isolation test and contract format validation), keeping synthetic `user.email` isolated under `076 D8`, never printed in any log, and masked in reports.
3. **`TQ-3` (`PR-c`):** **Option A (`«إشعار جرس + سجل (المقترح)»`)** — Permanent PIN (`temporary = false`), in-app owner bell notice without the PIN, and audit.
